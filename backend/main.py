"""Scam Gym backend: optional extras around a frontend that works without it.

Routes: health, scenarios, optional rephrasing, the consent-based study, and the static app.
CORS: none is configured on purpose. The frontend is served from this same origin, so
browsers block cross-origin calls by default (no wildcard, no extra origins).
"""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, study
from .config import FRONTEND_DIR, SCENARIOS_PATH, Settings, get_settings
from .rephrase import Generator, Rephraser
from .schemas import RephraseRequest, RephraseResponse, StoredResponse, StudySession, StudySummary

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
    "X-Frame-Options": "DENY",
}
NO_CACHE_PATHS = {"/", "/index.html", "/sw.js", "/manifest.webmanifest"}


class RateLimiter:
    """Simple in-memory sliding window. IPs live in memory only and are never stored."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        if len(self.hits) > 10_000:  # bound memory
            for k in [k for k, v in self.hits.items() if not v]:
                del self.hits[k]
        return True


def load_scenarios(path: Path = SCENARIOS_PATH) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def create_app(settings: Settings | None = None, generator: Generator | None = None) -> FastAPI:
    settings = settings or get_settings()
    scenarios = load_scenarios()
    scenario_index = {s["id"]: s for s in scenarios["scenarios"]}
    # Unknown routes get index.html with a <base> so its relative asset paths still resolve.
    fallback_html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8").replace(
        "<head>", '<head>\n  <base href="/">', 1
    )
    rephraser = Rephraser(settings, generator)
    limiter = RateLimiter(settings.rate_limit_per_minute)
    db.init_db(settings.database_path)

    app = FastAPI(title="Scam Gym", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.method == "POST" and request.url.path.startswith("/api/"):
            ip = request.client.host if request.client else "unknown"
            if not limiter.allow(ip):
                response = JSONResponse({"detail": "Too many requests. Please wait a minute."}, status_code=429)
                response.headers.update(SECURITY_HEADERS)
                return response
        response = await call_next(request)
        response.headers.update(SECURITY_HEADERS)
        if request.url.path in NO_CACHE_PATHS:
            response.headers["Cache-Control"] = "no-cache"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        # Never echo submitted values back (or into logs): field locations only.
        fields = [".".join(str(p) for p in e.get("loc", ()) if p != "body") for e in exc.errors()]
        return JSONResponse({"detail": "Invalid request.", "fields": fields}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def not_found(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404 and not request.url.path.startswith("/api/") and request.method == "GET":
            return HTMLResponse(fallback_html)
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "llm_enabled": rephraser.enabled}

    @app.get("/api/scenarios")
    def get_scenarios():
        return scenarios

    @app.post("/api/rephrase", response_model=RephraseResponse)
    async def rephrase(body: RephraseRequest):
        scenario = scenario_index.get(body.scenario_id)
        node = scenario["nodes"].get(body.node_id) if scenario else None
        if not node:
            raise HTTPException(status_code=404, detail="Unknown scenario or node.")
        say, source = await rephraser.rephrase(body.scenario_id, body.node_id, node["say"])
        return RephraseResponse(say=say, source=source)

    @app.post("/api/study/session", response_model=StoredResponse, status_code=201)
    def study_session(body: StudySession):
        study.store_session(settings.database_path, body, set(scenario_index))
        return StoredResponse(stored=True)

    @app.get("/api/study/summary", response_model=StudySummary)
    def study_summary():
        return study.summarize(db.all_sessions(settings.database_path))

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_not_found(path: str):
        raise HTTPException(status_code=404, detail="Not found.")

    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    return app


app = create_app()
