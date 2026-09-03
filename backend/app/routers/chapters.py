"""Chapters (CRUD, version snapshots, rollback), outline scenes, and
manual mind-map graph edges."""

from __future__ import annotations

import logging
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from ..database import get_db, session_scope
from ..models import Chapter, ChapterStatus, ChapterVersion, DocumentChunk, GraphEdge, Scene
from ..schemas import (
    ChapterCreate, ChapterReorder, ChapterResponse, ChapterSummary, ChapterUpdate,
    ChapterVersionResponse, GraphEdgeCreate, GraphEdgeOut, GraphEdgeUpdate,
    SceneCreate, SceneSummary, SceneUpdate,
)
from ..utils import count_words
from .helpers import _chapter, _chapter_summary, _get_novel, _graph_edge, _record_auto_version, _scene, _utcnow
from .system import _daily_backup_if_due

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------- chapters
@router.get("/novels/{novel_id}/chapters", response_model=list[ChapterSummary])
def list_chapters(novel_id: str, database: Session = Depends(get_db)):
    """Chapter metadata list (#2 懒加载)：写作页章节目录 / 大纲页的数据源，
    不含正文（编辑时经 getChapter 按需取全文）。"""
    _get_novel(database, novel_id)
    return [_chapter_summary(c) for c in database.scalars(
        select(Chapter).options(load_only(
            Chapter.id, Chapter.novel_id, Chapter.title, Chapter.order,
            Chapter.word_count, Chapter.status, Chapter.created_at, Chapter.updated_at,
        )).where(Chapter.novel_id == novel_id).order_by(Chapter.order))]


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
    database.flush()  # 生成 chapter.id，登场追踪需要它做外键
    # F2 登场追踪：创建时若带初始正文，同步扫一次。
    from ..services.presence import sync_chapter_appearances
    sync_chapter_appearances(database, chapter)
    database.commit()
    database.refresh(chapter)
    return _chapter(chapter)


@router.get("/chapters/{chapter_id}", response_model=ChapterResponse)
def get_chapter(chapter_id: str, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return _chapter(chapter)


# 自动保存 ~1 次/秒，而 RAG 重索引 = 重切全文 + 批量 embedding（外部 API，
# 单批超时可达 60s）。与版本快照共用"节流 + 延迟补一次"的策略：窗口内的
# 保存不立即重建，只安排一个延迟任务，到点后按库里最新内容重建一次。
_RAG_REINDEX_MIN_INTERVAL = 30.0  # seconds
_rag_last_reindex: dict[str, float] = {}
_rag_reindex_timers: dict[str, threading.Timer] = {}


def _rag_reindex_now(chapter_id: str) -> None:
    _rag_reindex_timers.pop(chapter_id, None)
    try:
        from ..services.rag import indexer as rag_indexer
        with session_scope() as database:
            chapter = database.get(Chapter, chapter_id)
            if chapter is None:
                return
            rag_indexer.reindex_chapter(database, chapter)
            database.commit()
            _rag_last_reindex[chapter_id] = time.monotonic()
    except Exception:
        # 索引失败不影响写作；留痕便于排查（embedding 恢复后 rebuild 可补齐）。
        logger.warning("RAG reindex failed for chapter %s", chapter_id, exc_info=True)


def _schedule_rag_reindex(chapter_id: str) -> None:
    now = time.monotonic()
    if now - _rag_last_reindex.get(chapter_id, 0.0) >= _RAG_REINDEX_MIN_INTERVAL:
        _rag_last_reindex[chapter_id] = now
        worker = threading.Thread(target=_rag_reindex_now, args=(chapter_id,),
                                  daemon=True, name="rag-reindex")
        worker.start()
        return
    # 窗口内已有重建（或已排期）——只需保证最后一次编辑后仍会重建一次。
    if chapter_id not in _rag_reindex_timers:
        timer = threading.Timer(_RAG_REINDEX_MIN_INTERVAL, _rag_reindex_now, args=(chapter_id,))
        timer.daemon = True
        _rag_reindex_timers[chapter_id] = timer
        timer.start()


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
        # (#2) First content write of the day triggers a rolling file backup.
        _daily_backup_if_due()

    if "title" in changes:
        chapter.title = changes["title"].strip()
    if "status" in changes:
        try:
            chapter.status = ChapterStatus(changes["status"])
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid chapter status") from e
    # F1 摘要单独保存：不触发正文版本快照，只记一个变更时间用于"过期"提示。
    if changes.get("summary") is not None and changes["summary"] != chapter.summary:
        chapter.summary = changes["summary"]
        chapter.summary_updated_at = _utcnow()

    database.commit()
    database.refresh(chapter)
    if content_changed:
        # F2 登场追踪：正文变化即重扫该章（名字扫描是毫秒级，随保存同步执行）。
        from ..services.presence import sync_chapter_appearances
        sync_chapter_appearances(database, chapter)
        database.commit()
        # RAG 增量索引（RAG设计方案.md §五）：节流后台重建（见 _schedule_rag_reindex）。
        _schedule_rag_reindex(chapter.id)
    return _chapter(chapter)


@router.delete("/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: str, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    database.delete(chapter)
    # 级联清理该章的 RAG 块
    database.execute(sa_delete(DocumentChunk).where(
        DocumentChunk.source_type == "chapter", DocumentChunk.source_id == chapter_id))
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
def list_versions(chapter_id: str, limit: int = Query(100, ge=1, le=500),
                  database: Session = Depends(get_db)):
    """Version metadata for the history modal. The client only renders
    word_count/date and rollbacks by version id server-side, so full-text
    snapshots are omitted — listing every version's whole chapter used to
    produce multi-MB payloads for old chapters."""
    if not database.get(Chapter, chapter_id):
        raise HTTPException(status_code=404, detail="Chapter not found")
    versions = database.scalars(
        select(ChapterVersion).options(load_only(
            ChapterVersion.id, ChapterVersion.chapter_id, ChapterVersion.word_count,
            ChapterVersion.version_number, ChapterVersion.label, ChapterVersion.created_at,
        )).where(ChapterVersion.chapter_id == chapter_id)
        .order_by(ChapterVersion.version_number.desc()).limit(limit)
    ).all()
    return [
        ChapterVersionResponse(
            id=v.id, chapter_id=v.chapter_id, content="", word_count=v.word_count,
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
    # F2 登场追踪：回滚改变了正文，重扫该章。
    from ..services.presence import sync_chapter_appearances
    sync_chapter_appearances(database, chapter)
    database.commit()
    database.refresh(chapter)
    return _chapter(chapter)


# ---------------------------------------------------------------- lint (F3 发布前自检)
@router.post("/novels/{novel_id}/chapters/{chapter_id}/lint")
def lint_chapter(novel_id: str, chapter_id: str, database: Session = Depends(get_db)):
    """对一章跑本地自检：用户敏感词库 + 疑似叠字 + 标点规范。不调 AI、不上传正文。"""
    from .. import database as db_mod
    from ..services.lint import lint_text, load_sensitive_words

    _get_novel(database, novel_id)
    chapter = database.get(Chapter, chapter_id)
    if not chapter or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    issues = lint_text(chapter.content or "", load_sensitive_words(db_mod.DATA_DIR))
    return {
        "chapter_id": chapter_id,
        "issues": issues,
        "word_count": chapter.word_count,
        "counts": {
            "sensitive": sum(1 for i in issues if i["type"] == "sensitive"),
            "duplicate": sum(1 for i in issues if i["type"] == "duplicate"),
            "punct": sum(1 for i in issues if i["type"] == "punct"),
        },
    }


# ---------------------------------------------------------------- recap (F1 滚动前情提要)
@router.get("/novels/{novel_id}/recap")
def get_recap(novel_id: str, before_chapter_id: str | None = None,
              budget: int = Query(3000, ge=500, le=8000), database: Session = Depends(get_db)):
    """拼装 before_chapter_id 之前的滚动前情提要：最近 2 章带结尾段，更早章节
    用摘要串；无摘要降级为标题行。写作页"前情提要"弹窗与 AI 上下文注入共用。"""
    from ..services.recap import RecapEntry, build_recap

    _get_novel(database, novel_id)
    # 优化审查 3.2：与 ai.py 的 _build_recap_for 同一策略——元数据列只读
    # load_only（不携带全部正文），结尾段仅对最近两章按 id 单独取回。
    chapters = database.scalars(
        select(Chapter).options(load_only(
            Chapter.id, Chapter.order, Chapter.title, Chapter.summary))
        .where(Chapter.novel_id == novel_id).order_by(Chapter.order)
    ).all()
    before_order: int | None = None
    if before_chapter_id:
        current = next((c for c in chapters if c.id == before_chapter_id), None)
        if current:
            before_order = current.order
    prior = [c for c in chapters if before_order is None or c.order < before_order]
    recent_ids = {c.id for c in prior[-2:]}
    tails: dict[str, str] = {}
    if recent_ids:
        for cid, content in database.execute(
            select(Chapter.id, Chapter.content).where(Chapter.id.in_(recent_ids))
        ).all():
            tails[cid] = (content or "")[-400:]
    entries = [
        RecapEntry(
            order=c.order, title=c.title, summary=c.summary or "",
            tail=tails.get(c.id, ""),
        )
        for c in prior
    ]
    return {
        "recap": build_recap(entries, budget=budget),
        "chapters": len(entries),
        "missing_summaries": sum(1 for e in entries if not e.summary.strip()),
    }


# ---------------------------------------------------------------- scenes (outline mind map)
@router.get("/novels/{novel_id}/scenes", response_model=list[SceneSummary])
def list_scenes(novel_id: str, database: Session = Depends(get_db)):
    """Scenes of every chapter in reading order (#2 懒加载：大纲页专用)."""
    _get_novel(database, novel_id)
    return [_scene(s) for s in database.scalars(
        select(Scene).join(Chapter, Scene.chapter_id == Chapter.id)
        .where(Chapter.novel_id == novel_id).order_by(Chapter.order, Scene.order))]


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
@router.get("/novels/{novel_id}/graph-edges", response_model=list[GraphEdgeOut])
def list_graph_edges(novel_id: str, database: Session = Depends(get_db)):
    """Manual mind-map connectors of a novel (#2 懒加载：大纲页专用)."""
    _get_novel(database, novel_id)
    return [_graph_edge(e) for e in database.scalars(
        select(GraphEdge).where(GraphEdge.novel_id == novel_id).order_by(GraphEdge.created_at))]


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


