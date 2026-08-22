import logging
import os
import secrets
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import SessionLocal, init_db
from app.routes import router
from app.security import get_auth_token
from app.seed import seed_demo_workspace

logger = logging.getLogger(__name__)


def _setup_file_logging() -> None:
    """(#9 错误排查) Rotating file log under the data dir: the backend used to
    run with zero logging, so silent failures (RAG, backup, usage recording)
    left no trace. 2MB × 3 backups; the export zip skips the logs/ folder."""
    from app.database import DATA_DIR
    try:
        log_dir = Path(DATA_DIR) / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            log_dir / "mojing.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root = logging.getLogger()
        if not any(isinstance(h, RotatingFileHandler) for h in root.handlers):
            root.addHandler(handler)
    except OSError:
        logger.warning("file logging unavailable (data dir not writable)", exc_info=True)

# Loopback origins we trust: the Vite dev server, and the packaged desktop
# shell (file:// loads report origin "null"). Everything else — including a
# random web page the user has open — is rejected.
_TRUSTED_ORIGINS = {"http://127.0.0.1:5175", "http://localhost:5175", "null"}
# In dev we additionally accept an explicit override (e.g. a different port).
_DEV_ORIGIN = os.getenv("MOJING_DEV_ORIGIN")
if _DEV_ORIGIN:
    _TRUSTED_ORIGINS.add(_DEV_ORIGIN)

# Paths that never require a token (so the shell can bootstrap before it has one,
# and so the readiness check used by Electron stays cheap).
_OPEN_PATHS = {"/api/health"}

# True when the backend runs from unpackaged source (python main.py). The frozen
# PyInstaller exe sets sys.frozen, so this distinguishes "dev / source run" from
# "packaged install". In source mode we relax the token check for trusted dev
# origins so a browser tab pointing at the Vite server works without a token.
_IS_DEV_BUILD = not getattr(sys, "frozen", False)
# Dev mode is active if running from source OR an explicit override is set.
_DEV_MODE = _IS_DEV_BUILD or os.getenv("MOJING_DEV") == "1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    _setup_file_logging()
    init_db()
    # Force-generate + persist the token before serving: the desktop shell now
    # reads it straight from storage.json (the /api/health endpoint no longer
    # hands it out), so the file must exist by the time the probe succeeds.
    get_auth_token()
    with SessionLocal() as database:
        seed_demo_workspace(database)
        # Import AI provider config from root .env (key encrypted at rest), so
        # the user can keep API credentials in an env file instead of the UI.
        from app.ai_env import import_env_config
        try:
            import_env_config(database)
        except Exception:
            # a malformed .env must never block startup — but leave a trace.
            logger.warning("import .env AI config failed", exc_info=True)
    yield


app = FastAPI(title="Mojing Local API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_TRUSTED_ORIGINS),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """Reject any request that doesn't carry the local bearer token.

    Dev compromise: when running outside the packaged shell (MOJING_DEV_ORIGIN
    or the default Vite origin), requests from the trusted dev origin are
    accepted without a token, since a plain browser tab can't be injected with
    one via preload. Packaged (app://) requests must always present the token."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in _OPEN_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        expected = f"Bearer {get_auth_token()}"

        # Constant-time compare: a plain == leaks how many leading bytes of the
        # token matched through timing, however marginal that is locally.
        if secrets.compare_digest(auth, expected):
            return await call_next(request)

        # Dev compromise: a plain browser tab talking to the Vite dev server
        # can't be injected with a token via preload (only the packaged shell
        # can), and same-origin GET fetches don't even send an Origin header.
        # So in source/dev mode we trust loopback without a token; the token is
        # still mandatory for the packaged shell (origin "null") in production.
        if _DEV_MODE:
            origin = (request.headers.get("origin") or "").rstrip("/")
            client = request.client.host if request.client else ""
            # Allow same-origin dev (no Origin) + the Vite origin on loopback.
            if client in ("127.0.0.1", "::1", "localhost") and (
                not origin or (origin in _TRUSTED_ORIGINS and origin != "null")
            ):
                return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "未授权：缺少本地令牌。请通过墨境桌面端访问。"},
        )


app.add_middleware(TokenAuthMiddleware)
app.include_router(router)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    # Pass the app object directly (not the "main:app" string) so the frozen
    # PyInstaller build — where sys.path/imports differ — boots reliably.
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False, log_level="warning")
