"""Resurrect API: FastAPI on Lambda via Mangum."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from mangum import Mangum
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import badge, config, logs, service, statemachine, store
from .errors import ApiException
from .models import TERMINAL_STATUSES, LogsResponse
from .timeutil import iso, now_utc

logger = logging.getLogger()
logger.setLevel(logging.INFO)

app = FastAPI(title="Resurrect API", docs_url=None, redoc_url=None, openapi_url=None)


def error_response(exc: ApiException) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(ApiException)
async def _api_exception(_: Request, exc: ApiException):
    return error_response(exc)


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, __: RequestValidationError):
    return error_response(ApiException("invalid_url", "Send a JSON body like {\"repo_url\": \"https://github.com/owner/repo\"}."))


@app.exception_handler(StarletteHTTPException)
async def _http(_: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return error_response(ApiException("not_found", "Nothing here."))
    return error_response(ApiException("internal", "That request is not supported.", status=exc.status_code))


@app.middleware("http")
async def _catch_all(request: Request, call_next):
    try:
        return await call_next(request)
    except ApiException as exc:
        return error_response(exc)
    except Exception:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return error_response(ApiException("internal", "Something went wrong on our side. Please try again."))


def client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    event = request.scope.get("aws.event") or {}
    return ((event.get("requestContext") or {}).get("http") or {}).get("sourceIp")


def api_url(request: Request) -> str:
    event = request.scope.get("aws.event") or {}
    host = request.headers.get("host") or (event.get("requestContext") or {}).get("domainName") or ""
    proto = request.headers.get("x-forwarded-proto", "https").split(",")[0].strip()
    return f"{proto}://{host}"


def respond(rec, status_code: int = 200) -> JSONResponse:
    return JSONResponse(rec.to_api(iso(now_utc())), status_code=status_code)


def load(rec_id: str):
    rec = store.get(rec_id)
    if rec is None:
        raise ApiException("not_found", "We can't find that resurrection.")
    return rec


@app.post("/resurrections")
async def create_resurrection(request: Request):
    try:
        body = await request.json()
        repo_url = body.get("repo_url") if isinstance(body, dict) else None
    except ValueError:
        repo_url = None
    if not isinstance(repo_url, str):
        raise ApiException("invalid_url", "Send a JSON body like {\"repo_url\": \"https://github.com/owner/repo\"}.")
    rec = service.create(repo_url, client_ip(request), request.headers.get("x-resurrect-admin"))
    return respond(rec, 201)


@app.get("/resurrections/{rec_id}")
def get_resurrection(rec_id: str, request: Request):
    rec = load(rec_id)
    if statemachine.advance(rec, api_url(request)):
        try:
            store.save(rec)
        except store.ConflictError:
            rec = load(rec_id)  # another poll advanced it first; return theirs
    return respond(rec)


@app.get("/resurrections/{rec_id}/logs")
def get_logs(rec_id: str, cursor: Optional[str] = None):
    rec = load(rec_id)
    page = logs.fetch(rec, cursor)
    if (page.phase_message and rec.res.status in ("summoning", "building")
            and rec.res.phase_message != page.phase_message):
        rec.res.phase_message = page.phase_message
        try:
            store.save(rec)
        except store.ConflictError:
            pass  # lost the race: skip the write, the lines are still valid
    done = rec.res.status in TERMINAL_STATUSES and not page.new_events
    return JSONResponse(LogsResponse(lines=page.lines, cursor=page.cursor, done=done).model_dump(mode="json"))


@app.post("/resurrections/{rec_id}/retry")
def retry_resurrection(rec_id: str, request: Request):
    rec = service.retry(rec_id, client_ip(request), request.headers.get("x-resurrect-admin"))
    return respond(rec)


@app.get("/health")
def health():
    return {"ok": True, "resurrections_enabled": config.settings().resurrections_enabled}


@app.get("/badge/{rec_id}.svg")
def get_badge(rec_id: str):
    rec = store.get(rec_id)
    alive = bool(rec and rec.res.status == "alive")
    text = "alive" if alive else ("expired" if rec and rec.res.status == "expired" else "unknown")
    svg = badge.render(text if rec else "unknown", alive)
    return Response(svg, status_code=200 if rec else 404, media_type="image/svg+xml",
                    headers={"Cache-Control": "no-cache"})


handler = Mangum(app, lifespan="off")
