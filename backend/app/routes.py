import json
import os
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import SessionLocal, get_db, reset_data_dir, set_data_dir, storage_info
from .security import get_auth_token
from .models import (
    AIConfig,
    AIUsage,
    Chapter,
    ChapterStatus,
    ChapterVersion,
    Character,
    Location,
    Novel,
    NovelStatus,
    PlotThread,
    Scene,
    GraphEdge,
    ThreadPriority,
    ThreadStatus,
    WorldSetting,
)
from .schemas import (
    AIConsistencyRequest,
    AIConfigCreate,
    AIConfigResponse,
    AIConfigTestRequest,
    AIConfigUpdate,
    AIGenerateRequest,
    CharacterCreate,
    CharacterResponse,
    CharacterUpdate,
    ChapterCreate,
    ChapterResponse,
    ChapterReorder,
    ChapterSummary,
    ChapterUpdate,
    ChapterVersionResponse,
    ExportRequest,
    LocationCreate,
    LocationResponse,
    LocationUpdate,
    NovelCreate,
    NovelDetailResponse,
    NovelResponse,
    NovelUpdate,
    PlotThreadCreate,
    PlotThreadResolve,
    PlotThreadResponse,
    PlotThreadUpdate,
    GraphEdgeCreate,
    GraphEdgeOut,
    GraphEdgeUpdate,
    SceneCreate,
    SceneSummary,
    SceneUpdate,
    WorldSettingCreate,
    WorldSettingResponse,
    WorldSettingUpdate,
)
from .utils import count_words
from .services.ai import dispatcher, prompt_builder

router = APIRouter(prefix="/api")

# Captured once at import so the desktop shell can tell a real Mojing backend
# apart from whatever else might happen to be listening on the same port.
_INSTANCE_PID = os.getpid()
_INSTANCE_STARTED_AT = time.time()


# ---------------------------------------------------------------- helpers
def _chapter(c: Chapter) -> ChapterResponse:
    return ChapterResponse(
        id=c.id, novel_id=c.novel_id, title=c.title, content=c.content, order=c.order,
        word_count=c.word_count, status=c.status.value, created_at=c.created_at, updated_at=c.updated_at,
    )


def _chapter_summary(c: Chapter) -> ChapterSummary:
    """Same row as _chapter but without the body — the workspace/list payload
    only needs metadata; full content is fetched separately when editing."""
    return ChapterSummary(
        id=c.id, novel_id=c.novel_id, title=c.title, order=c.order,
        word_count=c.word_count, status=c.status.value, created_at=c.created_at, updated_at=c.updated_at,
    )


def _scene(s: Scene) -> SceneSummary:
    return SceneSummary(
        id=s.id, chapter_id=s.chapter_id, title=s.title, order=s.order,
        created_at=s.created_at, updated_at=s.updated_at,
    )


def _graph_edge(e: GraphEdge) -> GraphEdgeOut:
    return GraphEdgeOut(
        id=e.id, novel_id=e.novel_id, kind=e.kind, from_id=e.from_id,
        to_id=e.to_id, label=e.label, created_at=e.created_at,
    )


def _novel(novel: Novel, database: Session) -> NovelResponse:
    total_words = database.scalar(
        select(func.coalesce(func.sum(Chapter.word_count), 0)).where(Chapter.novel_id == novel.id)
    ) or 0
    chapter_count = database.scalar(select(func.count(Chapter.id)).where(Chapter.novel_id == novel.id)) or 0
    return NovelResponse(
        id=novel.id, title=novel.title, description=novel.description, author=novel.author,
        genre=novel.genre, target_words=novel.target_words, status=novel.status.value,
        total_words=total_words, chapter_count=chapter_count, created_at=novel.created_at, updated_at=novel.updated_at,
    )


def _character(c: Character) -> CharacterResponse:
    return CharacterResponse(
        id=c.id, novel_id=c.novel_id, name=c.name, aliases=c.aliases, role=c.role, color=c.color,
        description=c.description, personality=c.personality, background=c.background, appearance=c.appearance,
        abilities=c.abilities, relationships=c.relationships or {},
        first_appearance_chapter_id=c.first_appearance_chapter_id,
        created_at=c.created_at, updated_at=c.updated_at,
    )


def _location(l: Location) -> LocationResponse:
    return LocationResponse(
        id=l.id, novel_id=l.novel_id, name=l.name, description=l.description, type=l.type,
        parent_location_id=l.parent_location_id, first_appearance_chapter_id=l.first_appearance_chapter_id,
        created_at=l.created_at, updated_at=l.updated_at,
    )


def _setting(s: WorldSetting) -> WorldSettingResponse:
    return WorldSettingResponse(
        id=s.id, novel_id=s.novel_id, name=s.name, category=s.category, description=s.description,
        related_settings=s.related_settings or {}, chapter_references=s.chapter_references or {},
        created_at=s.created_at, updated_at=s.updated_at,
    )


def _thread(t: PlotThread) -> PlotThreadResponse:
    return PlotThreadResponse(
        id=t.id, novel_id=t.novel_id, title=t.title, description=t.description, status=t.status.value,
        priority=t.priority.value, planted_chapter_id=t.planted_chapter_id, resolved_chapter_id=t.resolved_chapter_id,
        related_characters=t.related_characters or [], related_locations=t.related_locations or [],
        related_threads=t.related_threads or [], notes=t.notes, created_at=t.created_at, updated_at=t.updated_at,
    )


def _ai_config(cfg: AIConfig) -> AIConfigResponse:
    from .security import decrypt_key, mask_key
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


def _record_auto_version(database: Session, chapter: Chapter) -> None:
    """Snapshot the *current* (pre-edit) content. If the most recent auto
    version is newer than the throttle window we overwrite it; otherwise we add
    a new row. Then prune the oldest auto versions beyond the cap."""
    from datetime import datetime, timedelta
    latest = database.scalar(
        select(ChapterVersion).where(
            ChapterVersion.chapter_id == chapter.id, ChapterVersion.label == "auto"
        ).order_by(ChapterVersion.version_number.desc()).limit(1)
    )
    now = datetime.utcnow()
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
    oldest. Versions with a non-auto label (rollback, manual, …) are immortal."""
    autos = database.scalars(
        select(ChapterVersion).where(
            ChapterVersion.chapter_id == chapter_id, ChapterVersion.label == "auto"
        ).order_by(ChapterVersion.version_number.desc())
    ).all()
    for stale in autos[MAX_AUTO_VERSIONS_PER_CHAPTER:]:
        database.delete(stale)


# ---------------------------------------------------------------- health / workspace
@router.get("/health")
def health():
    """Open endpoint (no token) used by the desktop shell to (a) wait for the
    backend to come up, (b) confirm the port owner is actually Mojing via the
    pid/started_at fingerprint, and (c) fetch the bearer token to inject."""
    return {
        "status": "ok",
        "storage": "sqlite",
        "version": "0.3.0",
        "app": "mojing",
        "pid": _INSTANCE_PID,
        "started_at": _INSTANCE_STARTED_AT,
        "auth_token": get_auth_token(),
    }


# ---------------------------------------------------------------- storage / data location
@router.get("/storage")
def get_storage():
    return storage_info()


@router.post("/storage/path")
def set_storage_path(payload: dict):
    data_dir = (payload or {}).get("data_dir")
    if not data_dir or not str(data_dir).strip():
        raise HTTPException(status_code=422, detail="data_dir is required")
    try:
        return set_data_dir(str(data_dir).strip())
    except OSError as error:
        raise HTTPException(status_code=400, detail=f"无法使用该路径：{error}") from error


@router.post("/storage/reset")
def reset_storage_path():
    return reset_data_dir()


@router.get("/workspace", response_model=NovelDetailResponse)
def get_workspace(database: Session = Depends(get_db)):
    novel = database.scalar(select(Novel).order_by(Novel.updated_at.desc()).limit(1))
    if not novel:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return _detail(database, novel.id)


# ---------------------------------------------------------------- novels
@router.get("/novels", response_model=list[NovelResponse])
def list_novels(database: Session = Depends(get_db)):
    novels = database.scalars(select(Novel).order_by(Novel.updated_at.desc())).all()
    return [_novel(n, database) for n in novels]


@router.post("/novels", response_model=NovelResponse, status_code=201)
def create_novel(payload: NovelCreate, database: Session = Depends(get_db)):
    try:
        status = NovelStatus(payload.status)
    except ValueError as e:
        raise HTTPException(status_code=422, detail="Invalid novel status") from e
    novel = Novel(
        title=payload.title.strip(), description=payload.description, author=payload.author,
        genre=payload.genre, target_words=payload.target_words, status=status,
    )
    database.add(novel)
    database.commit()
    database.refresh(novel)
    return _novel(novel, database)


def _detail(database: Session, novel_id: str) -> NovelDetailResponse:
    novel = _get_novel(database, novel_id)
    return NovelDetailResponse(
        novel=_novel(novel, database),
        chapters=[_chapter_summary(c) for c in database.scalars(
            select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.order))],
        scenes=[_scene(s) for s in database.scalars(
            select(Scene).join(Chapter, Scene.chapter_id == Chapter.id)
            .where(Chapter.novel_id == novel_id).order_by(Chapter.order, Scene.order))],
        characters=[_character(c) for c in database.scalars(
            select(Character).where(Character.novel_id == novel_id).order_by(Character.created_at))],
        locations=[_location(l) for l in database.scalars(
            select(Location).where(Location.novel_id == novel_id).order_by(Location.created_at))],
        world_settings=[_setting(s) for s in database.scalars(
            select(WorldSetting).where(WorldSetting.novel_id == novel_id).order_by(WorldSetting.created_at))],
        plot_threads=[_thread(t) for t in database.scalars(
            select(PlotThread).where(PlotThread.novel_id == novel_id).order_by(PlotThread.created_at))],
        graph_edges=[_graph_edge(e) for e in database.scalars(
            select(GraphEdge).where(GraphEdge.novel_id == novel_id).order_by(GraphEdge.created_at))],
    )


@router.get("/novels/{novel_id}", response_model=NovelDetailResponse)
def get_novel(novel_id: str, database: Session = Depends(get_db)):
    return _detail(database, novel_id)


@router.put("/novels/{novel_id}", response_model=NovelResponse)
def update_novel(novel_id: str, payload: NovelUpdate, database: Session = Depends(get_db)):
    novel = _get_novel(database, novel_id)
    changes = payload.model_dump(exclude_none=True)
    if "status" in changes:
        try:
            novel.status = NovelStatus(changes["status"])
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid novel status") from e
    for field in ("title", "description", "author", "genre", "target_words"):
        if field in changes:
            setattr(novel, field, changes[field].strip() if isinstance(changes[field], str) else changes[field])
    database.commit()
    database.refresh(novel)
    return _novel(novel, database)


@router.delete("/novels/{novel_id}", status_code=204)
def delete_novel(novel_id: str, database: Session = Depends(get_db)):
    novel = _get_novel(database, novel_id)
    database.delete(novel)
    database.commit()


# ---------------------------------------------------------------- chapters
@router.post("/novels/{novel_id}/chapters", response_model=ChapterResponse, status_code=201)
def create_chapter(novel_id: str, payload: ChapterCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    next_order = database.scalar(
        select(func.coalesce(func.max(Chapter.order), 0)).where(Chapter.novel_id == novel_id)
    ) or 0
    chapter = Chapter(
        novel_id=novel_id, title=payload.title.strip(), content=payload.content,
        order=next_order + 1, word_count=count_words(payload.content), status=ChapterStatus.DRAFT,
    )
    database.add(chapter)
    database.commit()
    database.refresh(chapter)
    return _chapter(chapter)


@router.get("/chapters/{chapter_id}", response_model=ChapterResponse)
def get_chapter(chapter_id: str, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return _chapter(chapter)


@router.put("/chapters/{chapter_id}", response_model=ChapterResponse)
def update_chapter(chapter_id: str, payload: ChapterUpdate, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    changes = payload.model_dump(exclude_none=True)
    next_content = changes.get("content", chapter.content)
    content_changed = next_content != chapter.content

    if content_changed:
        # Snapshot the outgoing content (throttled/capped) before overwriting.
        _record_auto_version(database, chapter)
        chapter.content = next_content
        chapter.word_count = count_words(next_content)

    if "title" in changes:
        chapter.title = changes["title"].strip()
    if "status" in changes:
        try:
            chapter.status = ChapterStatus(changes["status"])
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid chapter status") from e

    database.commit()
    database.refresh(chapter)
    return _chapter(chapter)


@router.delete("/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: str, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    database.delete(chapter)
    database.commit()


@router.put("/chapters/{chapter_id}/reorder", response_model=ChapterResponse)
def reorder_chapter(chapter_id: str, payload: ChapterReorder, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    chapter.order = payload.order
    database.commit()
    database.refresh(chapter)
    return _chapter(chapter)


@router.get("/chapters/{chapter_id}/versions", response_model=list[ChapterVersionResponse])
def list_versions(chapter_id: str, database: Session = Depends(get_db)):
    if not database.get(Chapter, chapter_id):
        raise HTTPException(status_code=404, detail="Chapter not found")
    versions = database.scalars(
        select(ChapterVersion).where(ChapterVersion.chapter_id == chapter_id).order_by(ChapterVersion.version_number.desc())
    ).all()
    return [
        ChapterVersionResponse(
            id=v.id, chapter_id=v.chapter_id, content=v.content, word_count=v.word_count,
            version_number=v.version_number, label=v.label, created_at=v.created_at,
        )
        for v in versions
    ]


@router.post("/chapters/{chapter_id}/rollback/{version_id}", response_model=ChapterResponse)
def rollback_chapter(chapter_id: str, version_id: str, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    version = database.get(ChapterVersion, version_id)
    if not version or version.chapter_id != chapter_id:
        raise HTTPException(status_code=404, detail="Version not found")
    # snapshot the current content before rolling back
    current_version = database.scalar(
        select(func.coalesce(func.max(ChapterVersion.version_number), 0)).where(ChapterVersion.chapter_id == chapter.id)
    ) or 0
    database.add(ChapterVersion(
        chapter_id=chapter.id, content=chapter.content, word_count=chapter.word_count,
        version_number=current_version + 1, label="rollback",
    ))
    chapter.content = version.content
    chapter.word_count = version.word_count
    database.commit()
    database.refresh(chapter)
    return _chapter(chapter)


# ---------------------------------------------------------------- scenes (outline mind map)
@router.post("/novels/{novel_id}/chapters/{chapter_id}/scenes", response_model=SceneSummary, status_code=201)
def create_scene(novel_id: str, chapter_id: str, payload: SceneCreate, database: Session = Depends(get_db)):
    """Add a scene node under a chapter of the given novel."""
    _get_novel(database, novel_id)
    chapter = database.get(Chapter, chapter_id)
    if not chapter or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    next_order = database.scalar(
        select(func.coalesce(func.max(Scene.order), 0)).where(Scene.chapter_id == chapter_id)
    ) + 1
    scene = Scene(chapter_id=chapter_id, title=payload.title.strip(), order=next_order)
    database.add(scene)
    database.commit()
    database.refresh(scene)
    return _scene(scene)


@router.put("/scenes/{scene_id}", response_model=SceneSummary)
def update_scene(scene_id: str, payload: SceneUpdate, database: Session = Depends(get_db)):
    scene = database.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    if payload.title is not None:
        scene.title = payload.title.strip()
    database.commit()
    database.refresh(scene)
    return _scene(scene)


@router.delete("/scenes/{scene_id}", status_code=204)
def delete_scene(scene_id: str, database: Session = Depends(get_db)):
    scene = database.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    database.delete(scene)
    database.commit()


# ---------------------------------------------------------------- graph edges (manual mind-map connectors)
@router.post("/novels/{novel_id}/graph-edges", response_model=GraphEdgeOut, status_code=201)
def create_graph_edge(novel_id: str, payload: GraphEdgeCreate, database: Session = Depends(get_db)):
    """Create a manual connector between two nodes of an outline mind map."""
    _get_novel(database, novel_id)
    if payload.from_id == payload.to_id:
        raise HTTPException(status_code=422, detail="Cannot connect a node to itself")
    # No duplicate (either direction) for the same graph.
    exists = database.scalar(
        select(GraphEdge).where(
            GraphEdge.novel_id == novel_id, GraphEdge.kind == payload.kind,
            ((GraphEdge.from_id == payload.from_id) & (GraphEdge.to_id == payload.to_id))
            | ((GraphEdge.from_id == payload.to_id) & (GraphEdge.to_id == payload.from_id)),
        ).limit(1)
    )
    if exists:
        raise HTTPException(status_code=409, detail="Edge already exists")
    edge = GraphEdge(
        novel_id=novel_id, kind=payload.kind, from_id=payload.from_id, to_id=payload.to_id,
        label=payload.label.strip(),
    )
    database.add(edge)
    database.commit()
    database.refresh(edge)
    return _graph_edge(edge)


@router.put("/graph-edges/{edge_id}", response_model=GraphEdgeOut)
def update_graph_edge(edge_id: str, payload: GraphEdgeUpdate, database: Session = Depends(get_db)):
    edge = database.get(GraphEdge, edge_id)
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    edge.label = payload.label.strip()
    database.commit()
    database.refresh(edge)
    return _graph_edge(edge)


@router.delete("/graph-edges/{edge_id}", status_code=204)
def delete_graph_edge(edge_id: str, database: Session = Depends(get_db)):
    edge = database.get(GraphEdge, edge_id)
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    database.delete(edge)
    database.commit()


# ---------------------------------------------------------------- characters
@router.get("/novels/{novel_id}/characters", response_model=list[CharacterResponse])
def list_characters(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_character(c) for c in database.scalars(
        select(Character).where(Character.novel_id == novel_id).order_by(Character.created_at))]


@router.post("/novels/{novel_id}/characters", response_model=CharacterResponse, status_code=201)
def create_character(novel_id: str, payload: CharacterCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    character = Character(novel_id=novel_id, **payload.model_dump())
    database.add(character)
    database.commit()
    database.refresh(character)
    return _character(character)


@router.put("/characters/{character_id}", response_model=CharacterResponse)
def update_character(character_id: str, payload: CharacterUpdate, database: Session = Depends(get_db)):
    character = database.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(character, field, value)
    database.commit()
    database.refresh(character)
    return _character(character)


@router.delete("/characters/{character_id}", status_code=204)
def delete_character(character_id: str, database: Session = Depends(get_db)):
    character = database.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    database.delete(character)
    database.commit()


# ---------------------------------------------------------------- locations
@router.get("/novels/{novel_id}/locations", response_model=list[LocationResponse])
def list_locations(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_location(l) for l in database.scalars(
        select(Location).where(Location.novel_id == novel_id).order_by(Location.created_at))]


@router.post("/novels/{novel_id}/locations", response_model=LocationResponse, status_code=201)
def create_location(novel_id: str, payload: LocationCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    location = Location(novel_id=novel_id, **payload.model_dump())
    database.add(location)
    database.commit()
    database.refresh(location)
    return _location(location)


@router.put("/locations/{location_id}", response_model=LocationResponse)
def update_location(location_id: str, payload: LocationUpdate, database: Session = Depends(get_db)):
    location = database.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(location, field, value)
    database.commit()
    database.refresh(location)
    return _location(location)


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: str, database: Session = Depends(get_db)):
    location = database.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    database.delete(location)
    database.commit()


# ---------------------------------------------------------------- world settings
@router.get("/novels/{novel_id}/settings", response_model=list[WorldSettingResponse])
def list_settings(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_setting(s) for s in database.scalars(
        select(WorldSetting).where(WorldSetting.novel_id == novel_id).order_by(WorldSetting.created_at))]


@router.post("/novels/{novel_id}/settings", response_model=WorldSettingResponse, status_code=201)
def create_setting(novel_id: str, payload: WorldSettingCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    setting = WorldSetting(novel_id=novel_id, **payload.model_dump())
    database.add(setting)
    database.commit()
    database.refresh(setting)
    return _setting(setting)


@router.put("/settings/{setting_id}", response_model=WorldSettingResponse)
def update_setting(setting_id: str, payload: WorldSettingUpdate, database: Session = Depends(get_db)):
    setting = database.get(WorldSetting, setting_id)
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(setting, field, value)
    database.commit()
    database.refresh(setting)
    return _setting(setting)


@router.delete("/settings/{setting_id}", status_code=204)
def delete_setting(setting_id: str, database: Session = Depends(get_db)):
    setting = database.get(WorldSetting, setting_id)
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    database.delete(setting)
    database.commit()


# ---------------------------------------------------------------- plot threads
@router.get("/novels/{novel_id}/plot-threads", response_model=list[PlotThreadResponse])
def list_threads(novel_id: str, status: str | None = None, priority: str | None = None,
                 database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    stmt = select(PlotThread).where(PlotThread.novel_id == novel_id)
    if status:
        stmt = stmt.where(PlotThread.status == ThreadStatus(status))
    if priority:
        stmt = stmt.where(PlotThread.priority == ThreadPriority(priority))
    return [_thread(t) for t in database.scalars(stmt.order_by(PlotThread.created_at))]


@router.get("/novels/{novel_id}/plot-threads/unresolved", response_model=list[PlotThreadResponse])
def list_unresolved(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    stmt = select(PlotThread).where(PlotThread.novel_id == novel_id, PlotThread.status != ThreadStatus.RESOLVED)
    return [_thread(t) for t in database.scalars(stmt.order_by(PlotThread.created_at))]


@router.get("/novels/{novel_id}/plot-thread-web")
def plot_thread_web(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    threads = database.scalars(select(PlotThread).where(PlotThread.novel_id == novel_id)).all()
    nodes = [{"id": t.id, "title": t.title, "status": t.status.value, "priority": t.priority.value} for t in threads]
    edges = []
    for t in threads:
        for other in t.related_threads or []:
            edges.append({"from": t.id, "to": other})
    return {"nodes": nodes, "edges": edges}


@router.post("/novels/{novel_id}/plot-threads", response_model=PlotThreadResponse, status_code=201)
def create_thread(novel_id: str, payload: PlotThreadCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    data = payload.model_dump()
    try:
        data["status"] = ThreadStatus(data["status"])
        data["priority"] = ThreadPriority(data["priority"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail="Invalid thread status/priority") from e
    thread = PlotThread(novel_id=novel_id, **data)
    database.add(thread)
    database.commit()
    database.refresh(thread)
    return _thread(thread)


@router.get("/plot-threads/{thread_id}", response_model=PlotThreadResponse)
def get_thread(thread_id: str, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return _thread(thread)


@router.put("/plot-threads/{thread_id}", response_model=PlotThreadResponse)
def update_thread(thread_id: str, payload: PlotThreadUpdate, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    changes = payload.model_dump(exclude_none=True)
    if "status" in changes:
        try:
            thread.status = ThreadStatus(changes.pop("status"))
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid thread status") from e
    if "priority" in changes:
        try:
            thread.priority = ThreadPriority(changes.pop("priority"))
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid thread priority") from e
    for field, value in changes.items():
        setattr(thread, field, value)
    database.commit()
    database.refresh(thread)
    return _thread(thread)


@router.put("/plot-threads/{thread_id}/resolve", response_model=PlotThreadResponse)
def resolve_thread(thread_id: str, payload: PlotThreadResolve, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread.status = ThreadStatus.RESOLVED
    thread.resolved_chapter_id = payload.resolved_chapter_id
    database.commit()
    database.refresh(thread)
    return _thread(thread)


@router.delete("/plot-threads/{thread_id}", status_code=204)
def delete_thread(thread_id: str, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    database.delete(thread)
    database.commit()


# ---------------------------------------------------------------- AI
@router.get("/ai/configs", response_model=list[AIConfigResponse])
def list_ai_configs(database: Session = Depends(get_db)):
    return [_ai_config(c) for c in database.scalars(select(AIConfig).order_by(AIConfig.id))]


@router.post("/ai/configs", response_model=AIConfigResponse, status_code=201)
def create_ai_config(payload: AIConfigCreate, database: Session = Depends(get_db)):
    from .security import encrypt_key
    data = payload.model_dump()
    data["api_key"] = encrypt_key(data.get("api_key", ""))  # store encrypted, never plaintext
    cfg = AIConfig(**data)
    if cfg.is_active:
        _deactivate_other_configs(database)
    database.add(cfg)
    database.commit()
    database.refresh(cfg)
    return _ai_config(cfg)


@router.put("/ai/configs/{config_id}", response_model=AIConfigResponse)
def update_ai_config(config_id: int, payload: AIConfigUpdate, database: Session = Depends(get_db)):
    from .security import encrypt_key
    cfg = database.get(AIConfig, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    changes = payload.model_dump(exclude_none=True)
    if changes.get("is_active"):
        _deactivate_other_configs(database, except_id=config_id)
    # api_key=None is excluded by exclude_none, so an omitted key is preserved.
    # An explicit value (incl. "") re-encrypts/overwrites. This is the only way
    # the frontend ever touches the key — it never reads it back.
    if "api_key" in changes:
        changes["api_key"] = encrypt_key(changes["api_key"])
    for field, value in changes.items():
        setattr(cfg, field, value)
    database.commit()
    database.refresh(cfg)
    return _ai_config(cfg)


@router.delete("/ai/configs/{config_id}", status_code=204)
def delete_ai_config(config_id: int, database: Session = Depends(get_db)):
    cfg = database.get(AIConfig, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    database.delete(cfg)
    database.commit()


@router.get("/ai/models")
def list_ai_models(database: Session = Depends(get_db)):
    configs = database.scalars(select(AIConfig).order_by(AIConfig.id)).all()
    return {
        "active": _ai_config(_active_config(database)).model_dump(mode="json") if _active_config(database) else None,
        "configs": [_ai_config(c).model_dump(mode="json") for c in configs],
        "provider": "openai-compatible",
        "offline_fallback": True,
    }


def _deactivate_other_configs(database: Session, *, except_id: int | None = None) -> None:
    """Single source of truth for the "only one active config" invariant.
    Setting one config active deactivates every other row via a bulk UPDATE;
    `except_id` excludes the row being activated (during update)."""
    from sqlalchemy import update as sa_update
    stmt = sa_update(AIConfig).values(is_active=False)
    if except_id is not None:
        stmt = stmt.where(AIConfig.id != except_id)
    database.execute(stmt)


@router.post("/ai/configs/{config_id}/test")
def test_ai_config(config_id: int, payload: AIConfigTestRequest, database: Session = Depends(get_db)):
    """Connectivity check run server-side so the API key never reaches the
    browser. Sends a tiny models-list request to the provider."""
    import httpx
    from .security import decrypt_key
    cfg = database.get(AIConfig, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    model = payload.model or cfg.model
    base_url = (payload.base_url or cfg.base_url).rstrip("/")
    api_key = payload.api_key if payload.api_key is not None else decrypt_key(cfg.api_key)
    if not base_url or not api_key or not model:
        return {"ok": False, "detail": "缺少 base_url / api_key / model，无法测试。"}
    try:
        resp = httpx.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(15.0, connect=8.0),
        )
    except httpx.HTTPError as exc:
        return {"ok": False, "detail": f"连接失败：{exc}"}
    if resp.status_code >= 400:
        return {"ok": False, "detail": f"模型服务返回 {resp.status_code}：{resp.text[:200]}"}
    return {"ok": True, "detail": "连接成功", "model": model}


def _prepare_generation(req: AIGenerateRequest) -> tuple[list[dict[str, str]], AIConfig | None, str]:
    """Validate the request and build the prompt *before* the streaming response
    is created. Doing this here (rather than inside the async generator) means a
    missing novel/chapter raises an HTTPException that surfaces as a proper 4xx,
    instead of a 200 whose body is a broken event stream."""
    with SessionLocal() as database:
        novel = _get_novel(database, req.novel_id)  # raises 404 before headers are sent
        current_content = ""
        if req.chapter_id:
            chapter = database.get(Chapter, req.chapter_id)
            if chapter:
                current_content = chapter.content
        messages = prompt_builder.build_messages(
            database, novel, instruction=req.instruction, mode=req.mode,
            target_words=req.target_words, context=req.context, current_content=current_content,
        )
        config = _active_config(database)
        from .security import decrypt_key
        has_key = bool(decrypt_key(config.api_key)) if config else False
        model_name = config.model if config and has_key and config.base_url else "mock (offline)"
        return messages, config, model_name


async def _ai_generate_stream(req: AIGenerateRequest):
    # Validation already happened in the route handler; stream the pieces out.
    messages, config, model_name = _prepare_generation(req)
    provider = None
    try:
        async for item in dispatcher.stream_with_usage(config, messages):
            if provider is None:
                # First item is the provider handle (for reading usage later).
                provider = item
                continue
            yield f"data: {json.dumps({'text': item, 'model': model_name}, ensure_ascii=False)}\n\n"
    except Exception as exc:  # provider/network error mid-stream
        yield f"data: {json.dumps({'error': str(exc)[:200]}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
    # Record token usage if the provider reported it (real model only; the mock
    # provider has no usage). Best-effort: never let accounting break the stream.
    usage = getattr(provider, "last_usage", None) if provider else None
    if usage:
        try:
            with SessionLocal() as database:
                database.add(AIUsage(
                    novel_id=req.novel_id, model=model_name, mode=req.mode or "",
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                ))
                database.commit()
        except Exception:
            pass


def _stream_response(req: AIGenerateRequest) -> StreamingResponse:
    _prepare_generation(req)  # raises 404/422 synchronously, before the 200/stream starts
    return StreamingResponse(_ai_generate_stream(req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/ai/generate")
def ai_generate(req: AIGenerateRequest):
    return _stream_response(req)


@router.post("/ai/polish")
def ai_polish(req: AIGenerateRequest):
    req.mode = "polish"
    return _stream_response(req)


@router.post("/ai/expand")
def ai_expand(req: AIGenerateRequest):
    req.mode = "expand"
    return _stream_response(req)


@router.post("/ai/suggest-threads")
def ai_suggest_threads(req: AIConsistencyRequest, database: Session = Depends(get_db)):
    _get_novel(database, req.novel_id)
    threads = database.scalars(
        select(PlotThread).where(PlotThread.novel_id == req.novel_id, PlotThread.status != ThreadStatus.RESOLVED)
        .order_by(PlotThread.created_at)
    ).all()
    latest_order = database.scalar(
        select(func.coalesce(func.max(Chapter.order), 0)).where(Chapter.novel_id == req.novel_id)
    ) or 0
    # Map each planted chapter id → its order so we can measure how many chapters
    # have passed since the thread was planted (the real "stale" signal).
    planted_ids = {t.planted_chapter_id for t in threads if t.planted_chapter_id}
    planted_order: dict[str, int] = {}
    if planted_ids:
        for c in database.scalars(select(Chapter).where(Chapter.id.in_(planted_ids))).all():
            planted_order[c.id] = c.order
    suggestions = []
    for t in threads:
        age = latest_order - planted_order.get(t.planted_chapter_id, latest_order)
        if t.priority == ThreadPriority.MAJOR and age >= 5:
            suggestions.append({
                "thread_id": t.id, "title": t.title, "priority": t.priority.value,
                "advice": f"主线伏笔「{t.title}」已埋设较久（{age} 章），建议在最近 2-3 章内安排一次明显的推进或暗示。",
            })
    if not suggestions and threads:
        suggestions.append({
            "thread_id": threads[0].id, "title": threads[0].title, "priority": threads[0].priority.value,
            "advice": "当前伏笔节奏平稳，可在下一章通过角色对话自然带出线索。",
        })
    return {"suggestions": suggestions, "unresolved_count": len(threads)}


@router.post("/ai/check-consistency")
def ai_check_consistency(req: AIConsistencyRequest, database: Session = Depends(get_db)):
    unresolved = database.scalars(
        select(PlotThread).where(PlotThread.novel_id == req.novel_id, PlotThread.status != ThreadStatus.RESOLVED)
    ).all()
    chapters = database.scalars(select(Chapter).where(Chapter.novel_id == req.novel_id).order_by(Chapter.order)).all()
    empty = [c for c in chapters if not c.content.strip()]
    findings = []
    if len(unresolved) > 8:
        findings.append({"level": "warn", "message": f"未收束伏笔较多（{len(unresolved)} 条），存在遗漏风险。"})
    if unresolved:
        findings.append({"level": "info", "message": "主要待收束：" + "、".join(t.title for t in unresolved[:5])})
    if empty:
        findings.append({"level": "warn", "message": f"{len(empty)} 个章节为空：{empty[0].title}" + (" 等" if len(empty) > 1 else "")})
    if not findings:
        findings.append({"level": "ok", "message": "暂未发现明显的前后矛盾。"})
    return {"findings": findings, "unresolved": len(unresolved), "chapters": len(chapters)}


# ---------------------------------------------------------------- activity (writing heatmap)
@router.get("/novels/{novel_id}/activity")
def novel_activity(novel_id: str, days: int = Query(119, ge=14, le=366), database: Session = Depends(get_db)):
    """Daily writing activity for the heatmap / week bars.

    Reconstructs per-day net-added words from chapter_versions: each version
    snapshots a chapter's word_count at a point in time, so the positive delta
    between consecutive versions of the same chapter is the words written in
    that interval. Summing those deltas per calendar day gives a real activity
    signal without needing a separate event log."""
    from datetime import datetime, timedelta, timezone

    _get_novel(database, novel_id)
    chapters = database.scalars(
        select(Chapter).where(Chapter.novel_id == novel_id)
    ).all()
    chapter_ids = [c.id for c in chapters]

    # Buckets keyed by YYYY-MM-DD (local-ish; server tz). Default 0.
    today = datetime.now(timezone.utc).astimezone().date()
    start = today - timedelta(days=days - 1)
    buckets: dict[str, int] = {}
    cursor = start
    while cursor <= today:
        buckets[cursor.isoformat()] = 0
        cursor += timedelta(days=1)

    if chapter_ids:
        rows = database.scalars(
            select(ChapterVersion).where(ChapterVersion.chapter_id.in_(chapter_ids))
            .order_by(ChapterVersion.chapter_id, ChapterVersion.version_number)
        ).all()
        # Group by chapter to compute consecutive deltas.
        prev_wc: dict[str, int] = {}
        prev_date: dict[str, object] = {}
        for v in rows:
            prev = prev_wc.get(v.chapter_id)
            if prev is not None:
                delta = v.word_count - prev
                if delta > 0 and v.created_at:
                    day = _as_local_date(v.created_at).isoformat()
                    if day in buckets:
                        buckets[day] += delta
                    # also credit the day the previous snapshot landed on, so a
                    # burst that straddles midnight still reads as activity.
                prev_wc[v.chapter_id] = v.word_count
                prev_date[v.chapter_id] = v.created_at
            else:
                # First recorded version: count its whole word_count as the day's
                # writing (the chapter had to be created with that much content).
                if v.created_at:
                    day = _as_local_date(v.created_at).isoformat()
                    if day in buckets and v.word_count > 0:
                        buckets[day] += v.word_count
                prev_wc[v.chapter_id] = v.word_count

        # The live chapter word_count beyond the last snapshot is uncounted;
        # fold the trailing growth into "today" so current progress is visible.
        for c in chapters:
            last = prev_wc.get(c.id)
            if last is not None and c.word_count > last:
                buckets[today.isoformat()] += c.word_count - last

    series = [{"date": d, "words": buckets[d]} for d in sorted(buckets)]
    total = sum(b["words"] for b in series)
    active_days = sum(1 for b in series if b["words"] > 0)
    longest = 0
    run = 0
    for b in series:
        run = run + 1 if b["words"] > 0 else 0
        longest = max(longest, run)
    return {
        "novel_id": novel_id,
        "days": days,
        "series": series,
        "total_words_written": total,
        "active_days": active_days,
        "longest_streak": longest,
    }


def _as_local_date(value) -> "object":
    from datetime import datetime, timezone
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.date()
        return value.astimezone().date()
    return datetime.now(timezone.utc).astimezone().date()


# ---------------------------------------------------------------- AI usage (token stats)
@router.get("/novels/{novel_id}/ai/usage")
def novel_ai_usage(novel_id: str, days: int = Query(30, ge=1, le=366), database: Session = Depends(get_db)):
    """Token usage stats for the overview panel. Aggregates AIUsage rows by day
    (for the sparkline) and by model (for the breakdown)."""
    _get_novel(database, novel_id)
    since = _as_local_date_day(database, days)

    rows = database.scalars(
        select(AIUsage).where(AIUsage.novel_id == novel_id, AIUsage.created_at >= since)
        .order_by(AIUsage.created_at)
    ).all()

    # Daily totals for the sparkline.
    daily: dict[str, dict[str, int]] = {}
    cursor = since.date() if hasattr(since, "date") else None
    # Build a contiguous day map over the window.
    from datetime import date as date_cls, timedelta as td
    today = date_cls.today()
    start_day = today - td(days=days - 1)
    day = start_day
    while day <= today:
        daily[day.isoformat()] = {"prompt": 0, "completion": 0, "total": 0, "calls": 0}
        day += td(days=1)
    for r in rows:
        d = _as_local_date(r.created_at).isoformat()
        if d in daily:
            daily[d]["prompt"] += r.prompt_tokens
            daily[d]["completion"] += r.completion_tokens
            daily[d]["total"] += r.total_tokens
            daily[d]["calls"] += 1

    # Per-model totals over the window.
    by_model: dict[str, dict[str, int]] = {}
    for r in rows:
        key = r.model or "mock (offline)"
        bucket = by_model.setdefault(key, {"total_tokens": 0, "calls": 0, "prompt": 0, "completion": 0})
        bucket["total_tokens"] += r.total_tokens
        bucket["prompt"] += r.prompt_tokens
        bucket["completion"] += r.completion_tokens
        bucket["calls"] += 1

    series = [{"date": d, **vals} for d, vals in sorted(daily.items())]
    return {
        "novel_id": novel_id,
        "days": days,
        "series": series,
        "total_tokens": sum(v["total_tokens"] for v in by_model.values()),
        "total_calls": sum(v["calls"] for v in by_model.values()),
        "by_model": [{"model": k, **v} for k, v in sorted(by_model.items(), key=lambda kv: -kv[1]["total_tokens"])],
    }


def _as_local_date_day(database: Session, days: int):
    """A datetime `days` ago, for filtering recent usage rows."""
    from datetime import datetime, timedelta
    return datetime.now() - timedelta(days=days)


# ---------------------------------------------------------------- search & export
@router.get("/novels/{novel_id}/search")
def search_novel(novel_id: str, q: str = Query(min_length=1), database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    keyword = f"%{q}%"
    chapters = database.scalars(
        select(Chapter).where(Chapter.novel_id == novel_id,
                              (Chapter.title.like(keyword)) | (Chapter.content.like(keyword)))
    ).all()
    characters = database.scalars(
        select(Character).where(Character.novel_id == novel_id,
                                (Character.name.like(keyword)) | (Character.description.like(keyword)))
    ).all()
    threads = database.scalars(
        select(PlotThread).where(PlotThread.novel_id == novel_id,
                                 (PlotThread.title.like(keyword)) | (PlotThread.description.like(keyword)))
    ).all()
    return {
        "chapters": [{"id": c.id, "title": c.title, "order": c.order, "word_count": c.word_count} for c in chapters],
        "characters": [{"id": c.id, "name": c.name, "role": c.role} for c in characters],
        "threads": [{"id": t.id, "title": t.title, "status": t.status.value} for t in threads],
        "total": len(chapters) + len(characters) + len(threads),
    }


@router.post("/novels/{novel_id}/export")
def export_novel(novel_id: str, payload: ExportRequest, database: Session = Depends(get_db)):
    novel = _get_novel(database, novel_id)
    stmt = select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.order)
    if payload.chapter_ids:
        stmt = stmt.where(Chapter.id.in_(payload.chapter_ids))
    chapters = database.scalars(stmt).all()

    fmt = payload.format.lower()

    def disposition(title: str, ext: str) -> dict[str, str]:
        from urllib.parse import quote
        safe = quote(title)
        return {"Content-Disposition": f"attachment; filename=\"download.{ext}\"; filename*=UTF-8''{safe}.{ext}"}

    if fmt == "markdown":
        body = f"# {novel.title}\n\n> {novel.description}\n\n"
        for c in chapters:
            body += f"## 第 {c.order} 章 · {c.title}\n\n{c.content}\n\n"
        return Response(content=body, media_type="text/markdown; charset=utf-8", headers=disposition(novel.title, "md"))

    # default txt
    body = f"{novel.title}\n{novel.author or ''}\n\n"
    for c in chapters:
        body += f"第 {c.order} 章 · {c.title}\n\n{c.content}\n\n\n"
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=disposition(novel.title, "txt"))
