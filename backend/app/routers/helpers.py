"""Shared building blocks for the API routers: ORM→schema converters,
get-or-404 helpers, chapter-version throttling, and datetime utilities.
No routes live here."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from ..models import (
    AIConfig, Chapter, ChapterVersion, Character, GraphEdge, Location, MapStroke,
    Novel, PlotThread, Scene, StoryMap, Terrain, WorldSetting,
)
from ..schemas import (
    AIConfigResponse, ChapterResponse, ChapterSummary, CharacterResponse,
    GraphEdgeOut, LocationResponse, NovelResponse, PlotThreadResponse,
    SceneSummary, StoryMapResponse, StrokeResponse, TerrainResponse,
    WorldSettingResponse,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------- helpers
def _chapter(c: Chapter) -> ChapterResponse:
    return ChapterResponse.model_validate(c)


def _chapter_summary(c: Chapter) -> ChapterSummary:
    """Same row as _chapter but without the body — the workspace/list payload
    only needs metadata; full content is fetched separately when editing."""
    return ChapterSummary.model_validate(c)


def _scene(s: Scene) -> SceneSummary:
    return SceneSummary.model_validate(s)


def _graph_edge(e: GraphEdge) -> GraphEdgeOut:
    return GraphEdgeOut.model_validate(e)


def _novel(novel: Novel, database: Session) -> NovelResponse:
    # Aggregated fields (total_words/chapter_count) need a sub-query, so the
    # base attributes are validated from the ORM row and the two aggregates are
    # filled in afterwards.
    total_words = database.scalar(
        select(func.coalesce(func.sum(Chapter.word_count), 0)).where(Chapter.novel_id == novel.id)
    ) or 0
    chapter_count = database.scalar(select(func.count(Chapter.id)).where(Chapter.novel_id == novel.id)) or 0
    resp = NovelResponse.model_validate(novel)
    resp.total_words = total_words
    resp.chapter_count = chapter_count
    return resp


def _character(c: Character) -> CharacterResponse:
    return CharacterResponse.model_validate(c)


def _location(l: Location) -> LocationResponse:
    return LocationResponse.model_validate(l)


def _story_map(m: StoryMap) -> StoryMapResponse:
    return StoryMapResponse.model_validate(m)


def _terrain(t: Terrain) -> TerrainResponse:
    return TerrainResponse.model_validate(t)


def _stroke(s: MapStroke) -> StrokeResponse:
    return StrokeResponse.model_validate(s)


def _setting(s: WorldSetting) -> WorldSettingResponse:
    return WorldSettingResponse.model_validate(s)


def _thread(t: PlotThread) -> PlotThreadResponse:
    return PlotThreadResponse.model_validate(t)


def _ai_config(cfg: AIConfig) -> AIConfigResponse:
    from ..security import decrypt_key, mask_key
    # API keys are stored encrypted; decrypt here only to derive a mask hint.
    # The cleartext key is never placed in the response.
    plain = decrypt_key(cfg.api_key) if cfg.api_key else ""
    return AIConfigResponse(
        id=cfg.id, provider=cfg.provider, name=cfg.name, model=cfg.model, base_url=cfg.base_url,
        has_key=bool(plain), key_hint=mask_key(plain),
        temperature=cfg.temperature, max_tokens=cfg.max_tokens,
        is_active=cfg.is_active, created_at=cfg.created_at,
    )


def _get_novel(database: Session, novel_id: str) -> Novel:
    novel = database.get(Novel, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


def _active_config(database: Session) -> AIConfig | None:
    cfg = database.scalar(select(AIConfig).where(AIConfig.is_active.is_(True)))
    return cfg or database.scalar(select(AIConfig).order_by(AIConfig.id.desc()).limit(1))


# Auto-saves fire ~1/sec from the writing page. Without throttling a chapter
# accumulates hundreds of full-text snapshots. So: collapse saves that land
# within this window into the latest auto version (overwrite), and cap the
# number of auto versions per chapter (labeled ones are never auto-pruned).
AUTO_VERSION_THROTTLE_SECONDS = 600  # 10 minutes
MAX_AUTO_VERSIONS_PER_CHAPTER = 50


def _utcnow() -> datetime:
    """Naive-UTC "now". Equivalent to the deprecated datetime.utcnow(), but
    without the DeprecationWarning. DB timestamps (SQLite CURRENT_TIMESTAMP)
    are naive UTC, so comparisons must stay naive on both sides."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _record_auto_version(database: Session, chapter: Chapter) -> None:
    """Snapshot the *current* (pre-edit) content. If the most recent auto
    version is newer than the throttle window we overwrite it; otherwise we add
    a new row. Then prune the oldest auto versions beyond the cap."""
    from datetime import timedelta
    latest = database.scalar(
        select(ChapterVersion).where(
            ChapterVersion.chapter_id == chapter.id, ChapterVersion.label == "auto"
        ).order_by(ChapterVersion.version_number.desc()).limit(1)
    )
    now = _utcnow()
    if latest and latest.created_at and latest.created_at >= now - timedelta(seconds=AUTO_VERSION_THROTTLE_SECONDS):
        # Same burst of editing — replace the snapshot instead of stacking rows.
        latest.content = chapter.content
        latest.word_count = chapter.word_count
        latest.created_at = now
        return
    current_version = database.scalar(
        select(func.coalesce(func.max(ChapterVersion.version_number), 0)).where(
            ChapterVersion.chapter_id == chapter.id)
    ) or 0
    database.add(
        ChapterVersion(
            chapter_id=chapter.id, content=chapter.content, word_count=chapter.word_count,
            version_number=current_version + 1, label="auto", created_at=now,
        )
    )
    _prune_auto_versions(database, chapter.id)


def _prune_auto_versions(database: Session, chapter_id: str) -> None:
    """Keep at most MAX_AUTO_VERSIONS_PER_CHAPTER auto-snapshots, deleting the
    oldest. Versions with a non-auto label (rollback, manual, …) are immortal.
    load_only(id): the row's chapter text is never needed just to delete it."""
    stale = database.scalars(
        select(ChapterVersion).options(load_only(ChapterVersion.id)).where(
            ChapterVersion.chapter_id == chapter_id, ChapterVersion.label == "auto"
        ).order_by(ChapterVersion.version_number.desc())
        .offset(MAX_AUTO_VERSIONS_PER_CHAPTER)
    ).all()
    for row in stale:
        database.delete(row)


def _as_local_date(value) -> "object":
    from datetime import datetime, timezone
    if isinstance(value, datetime):
        # DB timestamps are naive UTC (SQLite CURRENT_TIMESTAMP / _utcnow()) —
        # tag them as UTC before converting so calendar days land in the
        # user's local zone instead of being read as local time directly.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone().date()
    return datetime.now(timezone.utc).astimezone().date()




def sniff_image_ext(data: bytes) -> str | None:
    """优化审查 5.2：按 magic bytes 识别真实图片格式（返回不带点的扩展名），
    伪装成图片的非图片内容返回 None。RIFF 容器需确认第 8-12 字节是 WEBP。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None
