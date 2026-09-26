import asyncio
import base64
import json
from io import BytesIO
from PIL import Image
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from google.genai import types
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app import live
from app.live import Relay, Start, decode_media
from app.main import app
from app.models import Analysis


def location():
    return Start(type="start", latitude=45.5, longitude=-73.5)


def photo_base64():
    output = BytesIO()
    Image.new("RGB", (20, 20), "gray").save(output, "JPEG")
    return base64.b64encode(output.getvalue()).decode()


def make_relay():
    ws = SimpleNamespace(app=app, send_json=AsyncMock())
    relay = Relay(ws, location())
    relay.transcript = "There is a pothole in the road."
    relay.frames_sent = 1
    async def capture(event):
        if event["type"] == "capture_photo":
            relay.photo.set_result(photo_base64())
    ws.send_json.side_effect = capture
    return relay, ws


def call(**changes):
    return types.FunctionCall(id="call-1", name="submit_report", args={"video_transcription": "A hole in the asphalt."} | changes)


def test_submission_uses_server_transcript_and_gps_and_only_runs_once():
    async def scenario():
        relay, ws = make_relay()
        relay.post_report = AsyncMock(return_value=httpx.Response(201, json={"status": "success"}))
        session = SimpleNamespace(send_tool_response=AsyncMock())
        assert await relay.tool(session, call())
        assert not await relay.tool(session, call())
        report = relay.post_report.call_args.args[0]
        assert report.audio_transcription == relay.transcript
        assert report.video_transcription == "A hole in the asphalt."
        assert (report.latitude, report.longitude) == (45.5, -73.5)
        relay.post_report.assert_awaited_once()
        assert [item.args[0]["type"] for item in ws.send_json.call_args_list] == ["capture_photo", "submitting", "success"]
    asyncio.run(scenario())


@pytest.mark.parametrize("speech,frames,args", [("", 1, {}), ("spoken", 0, {}), ("spoken", 1, {"latitude": 90}),
                                                 ("spoken", 1, {"video_transcription": " "})])
def test_incomplete_or_invalid_evidence_requests_follow_up(speech, frames, args):
    async def scenario():
        relay, ws = make_relay()
        relay.transcript, relay.frames_sent = speech, frames
        relay.post_report = AsyncMock()
        session = SimpleNamespace(send_tool_response=AsyncMock())
        assert not await relay.tool(session, call(**args))
        relay.post_report.assert_not_called()
        session.send_tool_response.assert_awaited_once()
        ws.send_json.assert_not_called()
    asyncio.run(scenario())


@pytest.mark.parametrize("status", [422, 502, 503])
def test_rejected_post_never_emits_success(status):
    async def scenario():
        relay, ws = make_relay()
        relay.post_report = AsyncMock(return_value=httpx.Response(status, json={"detail": "failed"}))
        assert await relay.tool(SimpleNamespace(send_tool_response=AsyncMock()), call())
        event = ws.send_json.call_args.args[0]
        assert event["type"] == "error" and event["unknown"] is False
    asyncio.run(scenario())


def test_google_tool_response_failure_does_not_hide_committed_success():
    async def scenario():
        relay, ws = make_relay()
        relay.post_report = AsyncMock(return_value=httpx.Response(201, json={"status": "success"}))
        session = SimpleNamespace(send_tool_response=AsyncMock(side_effect=RuntimeError()))
        await relay.tool(session, call())
        assert ws.send_json.call_args.args[0]["type"] == "success"
    asyncio.run(scenario())


def test_internal_post_executes_existing_pipeline_and_commit():
    async def scenario():
        relay, _ = make_relay()
        pipeline, repository = Mock(), Mock()
        pipeline.process.return_value = ("Pothole", Analysis(issue="Pothole", severity_score=5,
            ai_confidence=.8, cost_roi_value="Medium", tag="roads"))
        old_pipeline = getattr(app.state, "pipeline", None)
        old_repository = getattr(app.state, "repository", None)
        old_bucket = getattr(app.state, "gcs_bucket_name", None)
        app.state.gcs_bucket_name = "test-bucket"
        app.state.pipeline, app.state.repository = pipeline, repository
        try:
            await relay.tool(SimpleNamespace(send_tool_response=AsyncMock()), call())
            pipeline.process.assert_called_once()
            repository.save.assert_called_once()
        finally:
            app.state.pipeline, app.state.repository = old_pipeline, old_repository
            app.state.gcs_bucket_name = old_bucket
    asyncio.run(scenario())


def test_pcm_and_frame_validation():
    assert decode_media({"type": "audio", "data": "AAA="}) == b"\x00\x00"
    for message in [{"type": "audio", "data": "AA=="}, {"type": "audio", "data": "!"},
                    {"type": "audio", "data": "AAA=", "sampleRate": 1},
                    {"type": "video", "data": "AAA="}]:
        with pytest.raises(ValueError):
            decode_media(message)
    with pytest.raises(ValidationError):
        Start(type="start", latitude=float("nan"), longitude=0)


def test_receiver_retains_latest_frame_and_cancel_cleans_tasks():
    async def scenario():
        relay, ws = make_relay()
        relay.frames_sent = 0
        jpeg = base64.b64encode(b"\xff\xd8camera").decode()
        ws.receive_text = AsyncMock(side_effect=[json.dumps({"type": "video", "data": jpeg}),
            json.dumps({"type": "audio", "data": "AAA="}), json.dumps({"type": "cancel"})])
        session = SimpleNamespace(send_client_content=AsyncMock(), send_realtime_input=AsyncMock())
        async def outgoing(_):
            await asyncio.Event().wait()
        relay.outgoing = outgoing
        await relay.run(session)
        assert ws.receive_text.await_count == 3
    asyncio.run(scenario())


def test_disconnect_waits_for_dispatched_post():
    async def scenario():
        relay, _ = make_relay()
        dispatched, finish = asyncio.Event(), asyncio.Event()
        committed = []
        async def post(report):
            dispatched.set()
            await finish.wait()
            committed.append(report)
            return httpx.Response(201, json={"status": "success"})
        async def incoming():
            await dispatched.wait()
            finish.set()
            raise WebSocketDisconnect()
        async def outgoing(session):
            await relay.tool(session, call())
        relay.post_report, relay.incoming, relay.outgoing = post, incoming, outgoing
        session = SimpleNamespace(send_client_content=AsyncMock(), send_tool_response=AsyncMock(), send_realtime_input=AsyncMock())
        with pytest.raises(WebSocketDisconnect):
            await relay.run(session)
        assert len(committed) == 1
    asyncio.run(scenario())


def test_outgoing_transcription_audio_and_tool_flow():
    async def scenario():
        relay, ws = make_relay()
        relay.transcript = ""
        relay.post_report = AsyncMock(return_value=httpx.Response(201, json={"status": "success"}))
        events = [types.LiveServerMessage(server_content=types.LiveServerContent(
            input_transcription=types.Transcription(text="There is a pothole."),
            output_transcription=types.Transcription(text="I see it."),
            model_turn=types.Content(parts=[types.Part(inline_data=types.Blob(data=b"\x00\x00", mime_type="audio/pcm;rate=24000"))]),
            turn_complete=True)),
            types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=[call()]))]
        async def receive():
            for event in events:
                yield event
        await relay.outgoing(SimpleNamespace(receive=receive, send_tool_response=AsyncMock()))
        kinds = [entry.args[0]["type"] for entry in ws.send_json.call_args_list]
        assert kinds == ["transcript", "transcript", "audio", "turn_complete", "capture_photo", "submitting", "success"]
        assert relay.post_report.call_args.args[0].audio_transcription == "There is a pothole."
    asyncio.run(scenario())


def test_forward_sends_pcm_and_jpeg_with_expected_mime():
    async def scenario():
        relay, _ = make_relay()
        relay.frame = b"\xff\xd8camera"
        relay.audio.put_nowait((b"\x00\x00", 16000))
        sent = []
        async def send(**values):
            sent.append(values)
            if len(sent) == 2:
                raise RuntimeError("finished")
        with pytest.raises(RuntimeError):
            await relay.forward(SimpleNamespace(send_realtime_input=send))
        assert sent[0]["video"].mime_type == "image/jpeg"
        assert sent[1]["audio"].mime_type == "audio/pcm;rate=16000"
    asyncio.run(scenario())


def test_websocket_rejects_invalid_start_without_external_calls():
    with TestClient(app).websocket_connect("/api/v1/live") as ws:
        ws.send_json({"type": "start", "latitude": 91, "longitude": 0})
        assert ws.receive_json()["type"] == "error"


def test_websocket_end_to_end_with_fake_google_and_real_post(monkeypatch):
    """Exercise the socket protocol, SDK context lifetime, relay and actual POST route."""
    from contextlib import asynccontextmanager
    pipeline, repository = Mock(), Mock()
    pipeline.process.return_value = ("Road damage", Analysis(issue="Pothole", severity_score=5,
        ai_confidence=.8, cost_roi_value="Medium", tag="roads"))
    monkeypatch.setattr(app.state, "gcs_bucket_name", "test-bucket", raising=False)
    monkeypatch.setattr(app.state, "pipeline", pipeline, raising=False)
    monkeypatch.setattr(app.state, "repository", repository, raising=False)
    monkeypatch.setattr(live, "get_settings", lambda: SimpleNamespace(genai_options=lambda: {"vertexai": True, "project": "test-project", "location": "us-central1"}, gemini_live_model="test-live"))
    closed = []

    class FakeSession:
        def __init__(self):
            self.evidence = asyncio.Event()
            self.media = set()

        async def send_client_content(self, **kwargs):
            pass

        async def send_realtime_input(self, **kwargs):
            self.media.update(kwargs)
            if self.media == {"audio", "video"}:
                self.evidence.set()

        async def receive(self):
            await self.evidence.wait()
            yield types.LiveServerMessage(server_content=types.LiveServerContent(
                input_transcription=types.Transcription(text="There is a pothole."), turn_complete=True))
            yield types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=[call()]))

        async def send_tool_response(self, **kwargs):
            pass

    @asynccontextmanager
    async def connect(**kwargs):
        assert kwargs["model"] == "test-live"
        try:
            yield FakeSession()
        finally:
            closed.append(True)

    @asynccontextmanager
    async def aio():
        yield SimpleNamespace(live=SimpleNamespace(connect=connect))

    monkeypatch.setattr(app.state, "live_client_factory", lambda **kwargs: SimpleNamespace(aio=aio()), raising=False)
    with TestClient(app).websocket_connect("/api/v1/live") as ws:
        ws.send_json({"type": "start", "latitude": 45.5, "longitude": -73.5})
        assert ws.receive_json() == {"type": "ready"}
        ws.send_json({"type": "audio", "data": "AAA=", "sampleRate": 16000})
        ws.send_json({"type": "video", "data": base64.b64encode(b"\xff\xd8frame").decode()})
        events = []
        while True:
            event = ws.receive_json()
            events.append(event["type"])
            if event["type"] == "capture_photo":
                ws.send_json({"type": "photo", "data": photo_base64()})
            if event["type"] in {"success", "error"}:
                break
        assert events == ["transcript", "turn_complete", "capture_photo", "submitting", "success"]
    repository.save.assert_called_once()
    saved_report = repository.save.call_args.args[0]
    assert saved_report.audio_transcription == "There is a pothole."
    assert saved_report.latitude == 45.5
    assert closed == [True]


def test_no_photo_timeout_does_not_post(monkeypatch):
    monkeypatch.setattr(live, "PHOTO_TIMEOUT", .01)
    async def scenario():
        relay, ws = make_relay()
        ws.send_json.side_effect = None  # No camera response.
        relay.post_report = AsyncMock()
        with pytest.raises(TimeoutError):
            await relay.tool(SimpleNamespace(send_tool_response=AsyncMock()), call())
        relay.post_report.assert_not_called()
        assert not relay.submission_started
    asyncio.run(scenario())


def test_duplicate_call_during_capture_does_not_request_another_photo():
    async def scenario():
        relay, ws = make_relay()
        relay.capture_pending = True
        assert not await relay.tool(SimpleNamespace(send_tool_response=AsyncMock()), call())
        ws.send_json.assert_not_called()
    asyncio.run(scenario())


def test_unsolicited_photo_is_rejected_before_submission():
    async def scenario():
        relay, ws = make_relay()
        ws.receive_text = AsyncMock(return_value=json.dumps({"type": "photo", "data": photo_base64()}))
        with pytest.raises(ValueError, match="Unexpected photo"):
            await relay.incoming()
    asyncio.run(scenario())
