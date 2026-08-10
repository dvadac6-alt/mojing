"""Tests for in-place schema migration idempotency (#9).

The legacy-column migration must be safe to run repeatedly (it is called on every
startup). Running it twice should not error and should not duplicate columns.
"""
from app import database as db_mod
from app.database import init_db, _migrate_legacy_columns


def test_migrate_legacy_columns_is_idempotent():
    """init_db + _migrate_legacy_columns run twice without error; the migrated
    column exists exactly once afterwards."""
    init_db()
    # Running the migration again must not raise (ALTER TABLE ADD COLUMN would
    # fail on a duplicate, so the existence check is what protects us).
    _migrate_legacy_columns()
    _migrate_legacy_columns()

    with db_mod.engine.connect() as conn:
        cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(chapter_versions)")]
    # The one migrated column exists, and only once.
    assert cols.count("label") == 1
