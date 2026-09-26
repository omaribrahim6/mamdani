from contextlib import asynccontextmanager
import logging
from typing import Annotated

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout
from starlette.concurrency import run_in_threadpool

from .body_limit import BodyLimitMiddleware
from .live import router as live_router
from .auth import require_auth
from .config import get_settings
from .database import Repository
from .models import ReportInput, ReportResponse, SuccessResponse, Tag
from .pipeline import AIUnavailable, InvalidAIOutput, Pipeline
from .startup import check_api_services, check_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    repository = Repository(settings.connection_url())
    pipeline = Pipeline(settings)
    app.state.repository = repository
    app.state.pipeline = pipeline
    app.state.gcs_bucket_name = settings.gcs_bucket_name
    try:
        await run_in_threadpool(repository.open)
        await run_in_threadpool(check_database, repository)
        await run_in_threadpool(check_api_services, settings)
        yield
    finally:
        await run_in_threadpool(repository.close)
        await run_in_threadpool(pipeline.close)


app = FastAPI(title="Municipal reporting API", lifespan=lifespan)
app.include_router(live_router)
app.add_middleware(BodyLimitMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "municipal-reporting-api"}


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # FastAPI's default validation response echoes rejected input, including transcripts.
    return JSONResponse(status_code=422, content={"detail": "Invalid request data"})


@app.post("/api/v1/reports", status_code=201, response_model=SuccessResponse)
def submit_report(report: ReportInput, request: Request):
    bucket = getattr(request.app.state, "gcs_bucket_name", None)
    if report.photo_bytes is not None and not bucket:
        raise HTTPException(503, "Photo storage is not configured")
    try:
        summary, analysis = request.app.state.pipeline.process(report)
        if report.photo_bytes is None:
            request.app.state.repository.save(report, summary, analysis)
        else:
            request.app.state.repository.save(report, summary, analysis, bucket_name=bucket)
    except AIUnavailable:
        raise HTTPException(503, "Analysis service unavailable") from None
    except InvalidAIOutput:
        raise HTTPException(502, "Analysis service returned an unusable response") from None
    except (psycopg.Error, PoolTimeout):
        raise HTTPException(503, "Report storage unavailable") from None
    return SuccessResponse()


@app.get("/api/v1/reports", response_model=list[ReportResponse], dependencies=[Depends(require_auth)])
def list_reports(
    request: Request, tag: Tag | None = None,
    min_severity: Annotated[int | None, Query(ge=1, le=10)] = None,
):
    try:
        return request.app.state.repository.list(tag, min_severity)
    except (psycopg.Error, PoolTimeout):
        raise HTTPException(503, "Report storage unavailable") from None
