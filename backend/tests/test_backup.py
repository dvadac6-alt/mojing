"""Tests for the rolling backup module (#2)."""
import sqlite3

from app import database as db_mod
from app.backup import backup_once, list_backups, should_daily_backup, MAX_BACKUPS


def _seed_db():
    """Create a minimal mojing.db with a novels table so there's something to back up."""
    db_mod.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_mod.DATABASE_PATH))
    conn.executescript("CREATE TABLE IF NOT EXISTS novels (id TEXT PRIMARY KEY, title TEXT);")
    conn.execute("INSERT OR REPLACE INTO novels VALUES ('n1', 'Test')")
    conn.commit()
    conn.close()


def test_backup_creates_file_and_prunes():
    _seed_db()
    # A few real backups land as files.
    for _ in range(3):
        assert backup_once() is not None
    assert len(list_backups()) == 3
    # Exceed MAX_BACKUPS with placeholder files to exercise pruning directly.
    from app.backup import _backup_dir, _prune, MAX_BACKUPS
    d = _backup_dir()
    for i in range(MAX_BACKUPS + 4):
        (d / f"mojing-2025010{i:02d}-0000.db").write_bytes(b"x")
    _prune()
    assert len(list_backups()) == MAX_BACKUPS


def test_should_daily_backup_after_first():
    _seed_db()
    assert should_daily_backup() is True
    backup_once()
    assert should_daily_backup() is False
