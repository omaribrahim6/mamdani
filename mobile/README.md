# Mamdani mobile

`npm start`, `npm run ios`, and `npm run android` validate the environment and
check the backend `/health` endpoint first. Start the API before Expo. Run
`npm run check:env` to repeat the check; it uses Expo's dotenv loading and shell overrides.

Local Xcode 26.2 / Swift 6.2 builds use a persistent `patch-package` fix for
`expo-modules-jsi@57.1.1`. It removes unsupported constructor ownership
annotations and wraps callback-scoped pointers for Swift's actor checks. The
callbacks remain synchronous; the pointers must never escape to another thread.
`npm install` and `npm ci` apply the patch automatically and fail if it no longer
matches. Review/remove the patch when upgrading Expo to a version with an
upstream fix. Preserve the existing Xcode signing settings when rebuilding.

For one-command local startup, see [DEV.md](../DEV.md):
`npm run dev:mobile -- --ios` from the repository root.

Expo / React Native app for iOS and Android. This uses native PCM audio streaming,
so it needs a **development build**, not Expo Go.

The live conversation starts by asking what the problem is and waits for the
resident's explanation. Before capture/submission, the agent says "Okay, sending
the report!". Microphone capture pauses while queued speech finishes; then the
phone shows the hold-steady photo cue. Cancelling during that announcement does
not send a report. Success is still shown only after the backend commits it.

## Run locally

Start the existing backend first (see `../backend/README.md`). From `backend/`,
install its updated dependencies with `pip install -e '.[test]'`, configure `.env`,
apply `schema.sql` if needed, and run:

```sh
uvicorn app.main:app --host 0.0.0.0 --port 8000 --ws-max-size 8388608
```

Then, from this directory:

```sh
npm install
cp .env.example .env
```

Set `EXPO_PUBLIC_BACKEND_URL` to your computer's LAN address, e.g.
`http://192.168.1.100:8000`. The phone and computer need to be on the same network.
`localhost` on a phone points at the phone, not your backend.

```sh
npm run ios -- --device
# Or, with an Android device / emulator connected:
npm run android
```

These commands compile/install the native app and start Metro. Subsequent JS-only
changes can use `npm start`. iOS builds require Xcode and CocoaPods; Android builds
require an Android SDK/JDK. Use a physical phone to exercise camera and GPS.

The app config permits cleartext networking only when the configured backend URL
uses `http://`. For deployments use `https://` (the app selects WSS automatically).
After changing native dependencies, plugins, or the URL from HTTP to HTTPS, run
`npx expo prebuild` and rebuild the development app. Generated `ios/` and `android/`
directories are ignored; `app.config.ts` is their source of truth.

## Portrait

Place the photo at `assets/mamdani.png` and change `src/portrait.ts` to:

```ts
export const portrait = require('../assets/mamdani.png');
```

The same image appears on the landing page and in the speaking avatar. Until then,
the app uses an explicitly labeled M placeholder. The avatar tilts with audio
playback, not transcript events.

## Flow

Tap **Report issue**, grant camera/microphone/location access, and wait for
“Hey, what's the problem?” Point the rear camera at the issue and describe it.
The assistant asks short follow-up questions when necessary, then submits
automatically. Once it recognizes the issue, the app shows “Hold steady—taking a
photo,” waits one second, captures a fresh still, and shows a thumbnail while
saving. No shutter or confirmation tap is required. Voice transmission pauses
during capture. The backend waits up to 20 seconds for the photo; one failed camera
capture is retried automatically. Success is shown only after the backend commits
the report and its durable photo-upload job. Cloud compression/upload runs afterward
in the separate worker described in `../backend/README.md`. Cancel ends the conversation. An already-dispatched POST can
still save after cancellation or a disconnect.

Raw microphone PCM and resized JPEGs pass through the backend to Google Gemini
Live. Preview frames and live audio are not retained; temporary camera files are
deleted after each capture. A separate report still is transferred to the report
POST API, staged durably in PostgreSQL, then compressed and stored in your private
Google Cloud Storage bucket. Successful uploads remove the staged image bytes;
failed uploads retain them for retry. Google's processing is governed by the configured
Gemini account. The backend stores the speech transcript and visual description
through the existing report API. There is no fabricated demo submission.

To prevent speaker echo from being transcribed as user speech, the microphone
sends silence during assistant playback and for a brief interval afterward. Wait
until the assistant finishes to reply. Sessions last up to three minutes before
submission. A report submission can take over two minutes with analysis retries.
No automatic POST retries occur. “Submission status unknown” means a disconnected
request may have saved; starting another report could create a duplicate.

## Configuration

- Mobile: `EXPO_PUBLIC_BACKEND_URL` only. Never put a Google API key in Expo env vars.
- Backend: existing settings plus `GEMINI_LIVE_MODEL=gemini-live-2.5-flash-native-audio` (override with a
  compatible audio/video/function-calling Live model available to your account).
- Backend photo storage: configure `GCS_BUCKET_NAME`, apply the photo migration, and
  run `python -m app.photo_worker` with Google storage credentials. Otherwise photo
  submissions fail (the mobile flow now always attaches a photo).
- The Live endpoint is public, like report ingestion. Deploy behind a gateway
  with appropriate request/concurrent-session limits when exposing it publicly.
- No login, background capture, custom voice, report history, or media uploads to
  storage are included.

## Verification

```sh
npm run typecheck
npm test
npx expo export --platform ios --platform android
```

Backend tests run with `pytest -q` from `backend/` and mock Google/database services.
Physical-device acceptance: permissions denied/recovery, spoken greeting, clear
speaker playback, camera observations, GPS, follow-up conversation, automatic POST,
one-second photo cue, thumbnail, success only after report/job commit, cancellation, backgrounding, and network loss during
capture/submission. Bundling and unit tests do not verify native audio/camera
behavior or a real Gemini connection.

## WebSocket protocol

Endpoint: `/api/v1/live`. JSON messages; maximum message 8 MiB for the report
photo, with existing 700 KB limits for live preview media:

| Direction | Type | Fields |
| --- | --- | --- |
| App → backend | `start` | `latitude`, `longitude` (numbers; first message) |
| App → backend | `audio` | `data` (signed PCM16 little endian, mono), `sampleRate` |
| App → backend | `video` | `data` (JPEG; at most 1 frame/second) |
| App → backend | `photo` | `data` (base64 JPEG, at most 4 MiB decoded; only after request) |
| App → backend | `cancel` | None |
| Backend → app | `ready` | None |
| Backend → app | `capture_photo` | None; begin the automatic one-second capture cue |
| Backend → app | `audio` | `data` (PCM16), `sampleRate` (24000) |
| Backend → app | `transcript` | `role` (`user` / `assistant`), `text` (incremental) |
| Backend → app | `interrupted`, `turn_complete`, `submitting`, `success` | None |
| Backend → app | `error` | `message`, `unknown` (whether submission outcome is uncertain) |

`submit_report` is a Gemini tool handled on the backend. Only its
`video_transcription` comes from tool arguments. Accumulated speech and validated
GPS come from session state. The backend requests and waits for a fresh report
photo before sending the full body, including `photo_base64`, to the existing
`POST /api/v1/reports` through an internal ASGI HTTP request.
