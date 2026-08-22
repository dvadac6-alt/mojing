import json
import os
import shutil
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event, text
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
    """Read-modify-write: storage.json also holds the auth token (written by
    security.get_auth_token). Replacing the whole file here used to wipe it,
    silently invalidating every existing session after a data-dir switch."""
    data = _read_config()
    data["data_dir"] = str(data_dir)
    CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


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


@contextmanager
def session_scope():
    """Lock-aware session for code outside the request/response cycle (background
    threads, async generators). Raw `SessionLocal()` bypasses the RW lock, so a
    concurrent data-dir switch could dispose the engine under a live session."""
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
    src = dst = None
    try:
        src = sqlite3.connect(str(source))
        dst = sqlite3.connect(str(target))
        with dst:
            src.backup(dst)  # writes source's main DB into dst
    except Exception:
        try:
            shutil.copy2(source, target)
        except Exception:
            pass
    finally:
        # A failed backup must not leak the sqlite handles (they keep the file
        # locked on Windows and would block later copy/delete attempts).
        for conn in (src, dst):
            if conn is not None:
                try:
                    conn.close()
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
    _migrate_doodles_to_strokes()
    _ensure_indexes()
    # (#2) Snapshot the DB on every launch — guards against file-level loss
    # that chapter_versions cannot (disk fault, accidental delete, sync corruption).
    backup_once()


# Secondary indexes for hot query paths (list-by-novel, strokes-by-map...).
# create_all only builds indexes for *newly created* tables — existing installs
# need these CREATE INDEX IF NOT EXISTS statements (SQLite never auto-indexes
# FK columns). Names/columns must stay in sync with models.py __table_args__.
_INDEXES = (
    ("ix_chapters_novel_id", "chapters", "novel_id"),
    ("ix_chapter_versions_chapter_id", "chapter_versions", "chapter_id"),
    ("ix_scenes_chapter_id", "scenes", "chapter_id"),
    ("ix_characters_novel_id", "characters", "novel_id"),
    ("ix_locations_novel_id", "locations", "novel_id"),
    ("ix_locations_map_id", "locations", "map_id"),
    ("ix_world_settings_novel_id", "world_settings", "novel_id"),
    ("ix_plot_threads_novel_id", "plot_threads", "novel_id"),
    ("ix_graph_edges_novel_id", "graph_edges", "novel_id"),
    ("ix_story_maps_novel_id", "story_maps", "novel_id"),
    ("ix_terrains_map_id", "terrains", "map_id"),
    ("ix_map_strokes_map_seq", "map_strokes", "map_id, seq"),
    ("ix_map_strokes_map_color", "map_strokes", "map_id, color"),
    ("ix_ai_usage_novel_created", "ai_usage", "novel_id, created_at"),
)


def _ensure_indexes() -> None:
    """Idempotent: safe on every launch. Table names come from the hardcoded
    tuple above (never user input), so f-string SQL is not an injection surface."""
    with engine.connect() as conn:
        tables = {
            row[0] for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for name, table, columns in _INDEXES:
            if table not in tables:
                continue
            conn.exec_driver_sql(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")
        conn.commit()


def _migrate_doodles_to_strokes() -> None:
    """One-time migration: the old `story_maps.doodles` JSON blob held every
    stroke in one column. The new `map_strokes` table stores one row per
    stroke so append/undo/clear is O(1). Move any pre-existing blob into rows,
    then blank the column so we don't re-migrate next launch."""
    import uuid
    with engine.connect() as conn:
        # story_maps may predate this migration (or be brand new with no doodles).
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(story_maps)")}
        if "doodles" not in cols:
            return
        rows = conn.exec_driver_sql(
            "SELECT id, doodles FROM story_maps WHERE doodles IS NOT NULL AND doodles != '[]'"
        ).fetchall()
        if not rows:
            return
        for map_id, doodles in rows:
            try:
                strokes = json.loads(doodles) if isinstance(doodles, str) else doodles
            except (ValueError, TypeError):
                continue
            if not isinstance(strokes, list):
                continue
            for seq, s in enumerate(strokes, start=1):
                if not isinstance(s, dict) or not s.get("points"):
                    continue
                conn.execute(
                    text(
                        "INSERT INTO map_strokes (id, map_id, color, width, eraser, points, seq) "
                        "VALUES (:id, :map_id, :color, :width, :eraser, :points, :seq)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "map_id": map_id,
                        "color": s.get("color", "#000000"),
                        "width": float(s.get("width", 6)),
                        "eraser": 1 if s.get("eraser") else 0,
                        "points": json.dumps(s.get("points", [])),
                        "seq": seq,
                    },
                )
            # Mark migrated so we don't redo it (and so the blob stops being the source of truth).
            conn.exec_driver_sql("UPDATE story_maps SET doodles = '[]' WHERE id = :id", {"id": map_id})
        conn.commit()


def _migrate_legacy_columns() -> None:
    """In-place column additions for tables created before a schema change."""
    additions = {
        "chapter_versions": [("label", "VARCHAR(40) DEFAULT 'auto' NOT NULL")],
        "ai_config": [
            ("context_length", "INTEGER"),
            ("embed_base_url", "VARCHAR(255) DEFAULT '' NOT NULL"),
            ("embed_model", "VARCHAR(120) DEFAULT '' NOT NULL"),
            ("embed_api_key", "VARCHAR(255) DEFAULT '' NOT NULL"),
        ],
        "locations": [("map_id", "VARCHAR(36) REFERENCES story_maps(id) ON DELETE SET NULL")],
        "story_maps": [("background_image", "VARCHAR(255) DEFAULT '' NOT NULL")],
        "map_strokes": [("shape", "VARCHAR(20) DEFAULT 'path' NOT NULL")],
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
        _migrate_doodles_to_strokes()
        _ensure_indexes()
        info = storage_info()
        info["mounted_existing"] = mounted_existing
        return info


def reset_data_dir() -> dict:
    """Return to the default new/墨境数据 folder."""
    cfg = _read_config()
    if cfg.get("data_dir"):
        # clear only the override so configured_data_dir() falls back to default;
        # keep the other keys (auth_token!) intact.
        cfg.pop("data_dir", None)
        CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
    return set_data_dir(DEFAULT_DATA_DIR)
