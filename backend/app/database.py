import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("MOJING_DATA_DIR", BACKEND_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = DATA_DIR / "mojing.db"


class Base(DeclarativeBase):
    pass


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


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_legacy_columns()


def _migrate_legacy_columns() -> None:
    """Lightweight in-place migrations for tables created before a schema change.
    SQLite supports ALTER TABLE ADD COLUMN; this keeps the local DB working
    without needing a full migration framework."""
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


