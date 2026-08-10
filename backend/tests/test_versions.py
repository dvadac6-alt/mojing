"""Tests for chapter version throttling + pruning (#1 core).

Covers: throttle-window overwrite (no stacking), cap enforcement on auto
versions, and immortality of labeled (non-auto) versions.
"""
from datetime import datetime, timedelta

from app.database import init_db, SessionLocal
from app.models import Chapter, ChapterVersion, Novel, NovelStatus
from app.routes import _record_auto_version, MAX_AUTO_VERSIONS_PER_CHAPTER, AUTO_VERSION_THROTTLE_SECONDS


def _make_chapter(db):
    novel = Novel(title="T", target_words=100, status=NovelStatus.WRITING)
    db.add(novel)
    db.flush()
    ch = Chapter(novel_id=novel.id, title="Ch1", content="v0", order=1, word_count=2)
    db.add(ch)
    db.commit()
    return ch


def test_throttle_window_overwrites(monkeypatch):
    """Two snapshots within the throttle window replace the same row, not stack."""
    init_db()
    db = SessionLocal()
    ch = _make_chapter(db)
    _record_auto_version(db, ch)  # snapshot 1
    db.commit()
    _record_auto_version(db, ch)  # within window → overwrite
    db.commit()
    count = db.query(ChapterVersion).filter_by(chapter_id=ch.id, label="auto").count()
    assert count == 1
    db.close()


def test_bursts_outside_window_stack():
    """A snapshot older than the window starts a new row."""
    init_db()
    db = SessionLocal()
    ch = _make_chapter(db)
    _record_auto_version(db, ch)
    db.commit()
    # Push the existing version's timestamp outside the window.
    old = db.query(ChapterVersion).filter_by(chapter_id=ch.id).first()
    old.created_at = datetime.utcnow() - timedelta(seconds=AUTO_VERSION_THROTTLE_SECONDS + 60)
    db.commit()
    _record_auto_version(db, ch)  # now outside window → new row
    db.commit()
    count = db.query(ChapterVersion).filter_by(chapter_id=ch.id, label="auto").count()
    assert count == 2
    db.close()


def test_auto_versions_capped():
    """Beyond MAX_AUTO_VERSIONS_PER_CHAPTER, oldest auto versions are pruned."""
    init_db()
    db = SessionLocal()
    ch = _make_chapter(db)
    # Insert MAX+10 auto versions with old timestamps so none hit the throttle.
    base = datetime.utcnow() - timedelta(hours=2)
    for i in range(MAX_AUTO_VERSIONS_PER_CHAPTER + 10):
        db.add(ChapterVersion(
            chapter_id=ch.id, content=f"v{i}", word_count=2,
            version_number=i + 1, label="auto", created_at=base - timedelta(minutes=i),
        ))
    db.commit()
    from app.routes import _prune_auto_versions
    _prune_auto_versions(db, ch.id)
    db.commit()
    count = db.query(ChapterVersion).filter_by(chapter_id=ch.id, label="auto").count()
    assert count == MAX_AUTO_VERSIONS_PER_CHAPTER
    db.close()


def test_labeled_versions_immortal():
    """A non-auto label (e.g. rollback) survives pruning even past the cap."""
    init_db()
    db = SessionLocal()
    ch = _make_chapter(db)
    base = datetime.utcnow() - timedelta(hours=2)
    for i in range(MAX_AUTO_VERSIONS_PER_CHAPTER + 5):
        db.add(ChapterVersion(
            chapter_id=ch.id, content=f"v{i}", word_count=2,
            version_number=i + 1, label="auto", created_at=base - timedelta(minutes=i),
        ))
    db.add(ChapterVersion(
        chapter_id=ch.id, content="milestone", word_count=2,
        version_number=999, label="milestone", created_at=base - timedelta(hours=5),
    ))
    db.commit()
    from app.routes import _prune_auto_versions
    _prune_auto_versions(db, ch.id)
    db.commit()
    milestone = db.query(ChapterVersion).filter_by(chapter_id=ch.id, label="milestone").count()
    assert milestone == 1
    db.close()
