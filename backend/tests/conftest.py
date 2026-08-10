"""Shared pytest fixtures: point the backend at a throwaway temp data dir so the
real user DB is never touched by tests.

The database module builds its engine once at import time bound to DATA_DIR.
Tests get a fresh temp dir per test, so we must rebind engine + SessionLocal and
re-attach the foreign-keys listener for each test — otherwise sessions would
keep hitting the real (or a stale) database file.
"""
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    data_dir = tmp_path / "mojing-test-data"
    data_dir.mkdir()
    db_path = data_dir / "mojing.db"
    config_path = data_dir / "storage.json"

    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker
    from app import database as db_mod
    from app import security as sec

    # Rebind every module-level path + the engine to the temp dir.
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk(dbapi_connection, _record):
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    monkeypatch.setattr(db_mod, "DATA_DIR", data_dir, raising=False)
    monkeypatch.setattr(db_mod, "DATABASE_PATH", db_path, raising=False)
    monkeypatch.setattr(db_mod, "CONFIG_PATH", config_path, raising=False)
    monkeypatch.setattr(db_mod, "engine", engine, raising=False)
    monkeypatch.setattr(db_mod, "SessionLocal", sessionmaker(bind=engine, autoflush=False, expire_on_commit=False), raising=False)
    # security caches the token + reads CONFIG_PATH at module level.
    monkeypatch.setattr(sec, "CONFIG_PATH", config_path, raising=False)
    monkeypatch.setattr(sec, "_token_cache", None, raising=False)

    yield data_dir
    engine.dispose()
