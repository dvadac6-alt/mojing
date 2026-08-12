import json
import os
import shutil
import sqlite3
import threading
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]          # new/backend
NEW_ROOT = BACKEND_DIR.parent                               # new/
DEFAULT_DATA_DIR = NEW_ROOT / "墨境数据"                    # dedicated data folder inside new/
LEGACY_DB = BACKEND_DIR / "data" / "mojing.db"             # pre-feature storage location
DB_FILENAME = "mojing.db"


def _resolve_config_path() -> Path:
    """Where storage.json (the auth token + data-dir override) lives.

    Dev: beside the backend source so it's stable and inspectable.
    Packaged: the frozen exe's __file__ points at a throwaway _MEIPASS temp dir,
    so we anchor to a persistent, writable location — the parent of the data dir
    the Electron shell points us at (MOJING_DATA_DIR), or %APPDATA% as a final
    fallback — otherwise the token & encryption secret would regenerate every
    launch and every prior install's keys would become unreadable."""
    env_data_dir = os.getenv("MOJING_DATA_DIR")
    env_config = os.getenv("MOJING_CONFIG_PATH")
    if env_config:
        return Path(env_config)
    if env_data_dir:
        # userData/data -> userData/storage.json (parent keeps it out of the
        # user-pickable data folder so moving that folder doesn't strand auth).
        return Path(env_data_dir).parent / "storage.json"
    return BACKEND_DIR / "storage.json"


CONFIG_PATH = _resolve_config_path()


class _ReadersWriterLock:
    """A simple RW lock. DB request handlers acquire the read lock (many can
    hold it concurrently); ``set_data_dir`` acquires the write lock and blocks
    until every in-flight request has released its session, so no request can
    write to a disposed/old engine after a data-directory switch."""

    def __init__(self) -> None:
        self._readers = 0
        self._cond = threading.Condition()

    @property
    def active_readers(self) -> int:
        return self._readers

    def acquire_read(self) -> None:
        with self._cond:
            while self._readers < 0:  # a writer holds the lock
                self._cond.wait()
            self._readers += 1

    def release_read(self) -> None:
        with self._cond:
            self._readers -= 1
            if self._readers == 0:
                self._cond.notify_all()

    def acquire_write(self) -> None:
        with self._cond:
            while self._readers != 0:
                self._cond.wait()
            self._readers = -1  # mark writer-held

    def release_write(self) -> None:
        with self._cond:
            self._readers = 0
            self._cond.notify_all()

    def read(self):
        lock = self

        class _ReadCtx:
            def __enter__(self_inner):
                lock.acquire_read()
                return None

            def __exit__(self_inner, *_exc):
                lock.release_read()
                return False

        return _ReadCtx()

    def write(self):
        lock = self

        class _WriteCtx:
            def __enter__(self_inner):
                lock.acquire_write()
                return None

            def __exit__(self_inner, *_exc):
                lock.release_write()
                return False

        return _WriteCtx()


_db_lock = _ReadersWriterLock()


class Base(DeclarativeBase):
    pass


def _read_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _write_config(data_dir: Path) -> None:
    CONFIG_PATH.write_text(
        json.dumps({"data_dir": str(data_dir)}, ensure_ascii=False), encoding="utf-8"
    )


def configured_data_dir() -> Path:
    """Resolve order: user override (storage.json) > packaged-app env > default new/墨境数据."""
    override = _read_config().get("data_dir")
    if override:
        try:
            path = Path(override)
            path.mkdir(parents=True, exist_ok=True)
            return path
        except Exception:
            pass
    env_dir = os.getenv("MOJING_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    return DEFAULT_DATA_DIR


DATA_DIR = configured_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = DATA_DIR / DB_FILENAME

engine = create_engine(
    f"sqlite:///{DATABASE_PATH.as_posix()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(engine, "connect")
def _enable_foreign_keys(dbapi_connection, _connection_record):
    """SQLite ships with foreign keys OFF; the ORM cascade masks most cases but
    bypassing it (raw SQL / migrations) would leave orphans. Enforce at the DB
    layer on every fresh connection. Also enable WAL mode for better concurrent
    read/write performance (the backup job + AI usage writes can otherwise block
    reads)."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def get_db():
    # Hold the read lock for the whole request so a concurrent set_data_dir
    # (write lock) blocks until this session is closed and the connection
    # returned to the pool — disposing the engine can no longer race an
    # in-flight write.
    with _db_lock.read():
        database = SessionLocal()
        try:
            yield database
        finally:
            database.close()


def _copy_db(source: Path, target: Path) -> None:
    """Copy a SQLite DB safely even while another connection has it open.
    Uses the online backup API: src.backup(dst) writes source pages into dst."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    try:
        src = sqlite3.connect(str(source))
        dst = sqlite3.connect(str(target))
        with dst:
            src.backup(dst)  # writes source's main DB into dst
        src.close()
        dst.close()
    except Exception:
        try:
            shutil.copy2(source, target)
        except Exception:
            pass


def _migrate_legacy_db(target: Path) -> None:
    """First run in a new data dir: carry over the previous DB so work isn't lost."""
    if target.exists() or not LEGACY_DB.exists():
        return
    _copy_db(LEGACY_DB, target)


def init_db() -> None:
    from . import models  # noqa: F401
    from .backup import backup_once

    _migrate_legacy_db(DATABASE_PATH)
    Base.metadata.create_all(bind=engine)
    _migrate_legacy_columns()
    # (#2) Snapshot the DB on every launch — guards against file-level loss
    # that chapter_versions cannot (disk fault, accidental delete, sync corruption).
    backup_once()


def _migrate_legacy_columns() -> None:
    """In-place column additions for tables created before a schema change."""
    additions = {
        "chapter_versions": [("label", "VARCHAR(40) DEFAULT 'auto' NOT NULL")],
        "ai_config": [("context_length", "INTEGER")],
        "locations": [("map_id", "VARCHAR(36) REFERENCES story_maps(id) ON DELETE SET NULL")],
    }
    with engine.connect() as conn:
        for table, columns in additions.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for name, definition in columns:
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        conn.commit()


def storage_info() -> dict:
    size_kb = int(DATABASE_PATH.stat().st_size // 1024) if DATABASE_PATH.exists() else 0
    return {
        "data_dir": str(DATA_DIR),
        "default_dir": str(DEFAULT_DATA_DIR),
        "db_path": str(DATABASE_PATH),
        "db_file": DB_FILENAME,
        "db_size_kb": size_kb,
        "exists": DATABASE_PATH.exists(),
        "is_default": str(DATA_DIR.resolve()) == str(DEFAULT_DATA_DIR.resolve()),
    }


def set_data_dir(new_dir: str | Path) -> dict:
    """Switch the active data directory live: bring the current DB along, persist
    the choice, and re-bind the engine so it takes effect immediately. The write
    lock blocks until all in-flight requests finish, closing the window where an
    old session could still commit to the previous database after dispose()."""
    global DATA_DIR, DATABASE_PATH, engine
    with _db_lock.write():
        target_dir = Path(str(new_dir)).expanduser()
        target_dir.mkdir(parents=True, exist_ok=True)
        target_db = target_dir / DB_FILENAME
        # (#8) If the target already has a DB we mount it as-is instead of
        # silently overwriting — record the case so the UI can warn the user.
        mounted_existing = target_db.exists()
        if not mounted_existing and DATABASE_PATH.exists():
            _copy_db(DATABASE_PATH, target_db)
        _write_config(target_dir)
        engine.dispose()
        engine = create_engine(
            f"sqlite:///{target_db.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        # re-bind the FK pragma to the replacement engine
        event.listen(engine, "connect", _enable_foreign_keys)
        SessionLocal.configure(bind=engine)
        DATA_DIR = target_dir
        DATABASE_PATH = target_db
        Base.metadata.create_all(bind=engine)
        _migrate_legacy_columns()
        info = storage_info()
        info["mounted_existing"] = mounted_existing
        return info


def reset_data_dir() -> dict:
    """Return to the default new/墨境数据 folder."""
    cfg = _read_config()
    if cfg.get("data_dir"):
        # clear override so configured_data_dir() falls back to default
        CONFIG_PATH.write_text("{}", encoding="utf-8")
    return set_data_dir(DEFAULT_DATA_DIR)
