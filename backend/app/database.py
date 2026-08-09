import json
import os
import shutil
import sqlite3
import threading
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]          # new/backend
NEW_ROOT = BACKEND_DIR.parent                               # new/
DEFAULT_DATA_DIR = NEW_ROOT / "墨境数据"                    # dedicated data folder inside new/
CONFIG_PATH = BACKEND_DIR / "storage.json"                 # fixed location, never moves with data
LEGACY_DB = BACKEND_DIR / "data" / "mojing.db"             # pre-feature storage location
DB_FILENAME = "mojing.db"

_lock = threading.Lock()


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


def get_db():
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

    _migrate_legacy_db(DATABASE_PATH)
    Base.metadata.create_all(bind=engine)
    _migrate_legacy_columns()


def _migrate_legacy_columns() -> None:
    """In-place column additions for tables created before a schema change."""
    additions = {
        "chapter_versions": [("label", "VARCHAR(40) DEFAULT 'auto' NOT NULL")],
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
    the choice, and re-bind the engine so it takes effect immediately."""
    global DATA_DIR, DATABASE_PATH, engine
    with _lock:
        target_dir = Path(str(new_dir)).expanduser()
        target_dir.mkdir(parents=True, exist_ok=True)
        target_db = target_dir / DB_FILENAME
        if not target_db.exists() and DATABASE_PATH.exists():
            _copy_db(DATABASE_PATH, target_db)
        _write_config(target_dir)
        engine.dispose()
        engine = create_engine(
            f"sqlite:///{target_db.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        SessionLocal.configure(bind=engine)
        DATA_DIR = target_dir
        DATABASE_PATH = target_db
        Base.metadata.create_all(bind=engine)
        _migrate_legacy_columns()
        return storage_info()


def reset_data_dir() -> dict:
    """Return to the default new/墨境数据 folder."""
    cfg = _read_config()
    if cfg.get("data_dir"):
        # clear override so configured_data_dir() falls back to default
        CONFIG_PATH.write_text("{}", encoding="utf-8")
    return set_data_dir(DEFAULT_DATA_DIR)
