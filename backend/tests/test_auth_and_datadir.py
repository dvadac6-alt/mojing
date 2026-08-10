"""Tests for the token auth middleware (#1 core) and data-dir switching.

Auth: a request without the token is rejected in "packaged" mode but accepted
from a trusted dev origin in dev mode (the documented compromise).

set_data_dir: switching brings the DB along and reports whether an existing DB
was mounted instead of copied (the #8 conflict-detection flag).
"""
import pytest


def _make_app(monkeypatch, dev_mode=True):
    """Build a fresh app instance with controllable dev/packaged mode."""
    import sys
    monkeypatch.setattr(sys, "frozen", not dev_mode, raising=False)
    monkeypatch.setenv("MOJING_DEV", "1" if dev_mode else "0")
    from app.database import init_db, SessionLocal
    from app.seed import seed_demo_workspace
    init_db()
    with SessionLocal() as db:
        seed_demo_workspace(db)
    # Import after env is set so _DEV_MODE picks it up.
    import importlib
    import main as main_mod
    importlib.reload(main_mod)
    return main_mod.app


def test_health_is_open(monkeypatch):
    from fastapi.testclient import TestClient
    app = _make_app(monkeypatch, dev_mode=True)
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["app"] == "mojing"


def test_dev_mode_allows_trusted_origin_without_token(monkeypatch):
    """In dev mode a trusted-origin loopback request is accepted without a token.
    Drives the middleware directly with a fake loopback request (TestClient's
    client host is "testclient", not loopback, so it can't exercise this path)."""
    import asyncio
    import sys
    from app.database import init_db
    init_db()
    # Dev mode = running from source (sys.frozen absent).
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setenv("MOJING_DEV", "1")
    import importlib
    import main as main_mod
    importlib.reload(main_mod)

    class FakeRequest:
        class U:
            path = "/api/workspace"
        url = U()
        method = "GET"

        class _H(dict):
            def get(self, k, d=""):
                return super().get(k, d)
        headers = _H({"origin": "http://127.0.0.1:5175"})

        class _C:
            host = "127.0.0.1"
        client = _C()

    async def call_next(req):
        class Resp:
            status_code = 200
        return Resp()

    mw = main_mod.TokenAuthMiddleware(app=None)
    resp = asyncio.new_event_loop().run_until_complete(mw.dispatch(FakeRequest(), call_next))
    assert resp.status_code == 200
    asyncio.new_event_loop().close()


def test_packaged_mode_rejects_missing_token(monkeypatch):
    from fastapi.testclient import TestClient
    app = _make_app(monkeypatch, dev_mode=False)
    client = TestClient(app)
    # In packaged mode, no token + origin "null" → 401.
    r = client.get("/api/workspace", headers={"origin": "null"})
    assert r.status_code == 401


def test_packaged_mode_accepts_correct_token(monkeypatch):
    from fastapi.testclient import TestClient
    from app.security import get_auth_token
    app = _make_app(monkeypatch, dev_mode=False)
    client = TestClient(app)
    token = get_auth_token()
    r = client.get("/api/workspace", headers={"Authorization": f"Bearer {token}", "origin": "null"})
    assert r.status_code == 200


def test_set_data_dir_reports_mounted_existing(monkeypatch, tmp_path):
    """Switching to a dir that already has a mojing.db reports mounted_existing=True (#8)."""
    import sqlite3
    from app.database import init_db, set_data_dir
    init_db()
    # A target dir with a pre-existing valid (empty) SQLite DB.
    target = tmp_path / "has-old-db"
    target.mkdir()
    sqlite3.connect(str(target / "mojing.db")).close()
    info = set_data_dir(target)
    assert info["mounted_existing"] is True
    # Switching to an empty dir copies the current DB → not mounted_existing.
    empty = tmp_path / "empty-dir"
    info2 = set_data_dir(empty)
    assert info2["mounted_existing"] is False
