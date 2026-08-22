"""Rolling SQLite backups (#2).

Protects against file-level loss (disk fault, accidental delete, cloud-sync
corruption) which chapter_versions cannot. Uses the online backup API so it is
safe while the app holds the DB open. Keeps the most recent N backups and
prunes older ones on each run.

A backup is taken:
  - on backend startup (init_db calls backup_once)
  - on the first write of each calendar day (checked via the _last_backup_day marker)
  - on demand from the settings page (POST /backup)
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

# Read DATA_DIR/DATABASE_PATH off the database module at call time (not import
# time) so tests that rebind them per-test are picked up.
from . import database as _db

MAX_BACKUPS = 10
BACKUP_SUBDIR = "backups"


def _backup_dir() -> Path:
    return _db.DATA_DIR / BACKUP_SUBDIR


def list_backups() -> list[dict]:
    """Existing backups newest-first, with size + mtime for the settings view."""
    d = _backup_dir()
    if not d.exists():
        return []
    out = []
    for f in sorted(d.glob("mojing-*.db"), key=lambda p: p.name, reverse=True):
        st = f.stat()
        out.append({"name": f.name, "size_kb": int(st.st_size // 1024), "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")})
    return out


def backup_once() -> dict | None:
    """Take one timestamped backup now (online, safe under load) and prune old
    ones. Returns metadata or None if there is nothing to back up yet."""
    if not _db.DATABASE_PATH.exists():
        return None
    d = _backup_dir()
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    target = d / f"mojing-{stamp}.db"
    # Avoid clobbering if two backups land in the same minute.
    i = 1
    while target.exists():
        target = d / f"mojing-{stamp}-{i}.db"
        i += 1
    src = dst = None
    try:
        src = sqlite3.connect(str(_db.DATABASE_PATH))
        dst = sqlite3.connect(str(target))
        with dst:
            src.backup(dst)
    except Exception:
        # Fallback: plain copy (may miss the last in-flight txn, still useful).
        import shutil
        try:
            shutil.copy2(_db.DATABASE_PATH, target)
        except Exception:
            return None
    finally:
        # Never leak sqlite handles — on Windows they keep the files locked.
        for conn in (src, dst):
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    _prune()
    return {"name": target.name, "path": str(target), "size_kb": int(target.stat().st_size // 1024)}


def _prune() -> None:
    """Keep only the newest MAX_BACKUPS backup files."""
    d = _backup_dir()
    files = sorted(d.glob("mojing-*.db"), key=lambda p: p.name, reverse=True)
    for stale in files[MAX_BACKUPS:]:
        try:
            stale.unlink()
        except OSError:
            pass


def should_daily_backup() -> bool:
    """True if no backup exists from today yet (cheap day-stamp check)."""
    today = datetime.now().strftime("%Y%m%d")
    d = _backup_dir()
    if not d.exists():
        return True
    return not any(f.name.startswith(f"mojing-{today}") for f in d.glob("mojing-*.db"))
