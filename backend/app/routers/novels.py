"""Novel CRUD + workspace detail, full-text/semantic search, per-day
writing activity, and export."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from ..database import get_db
from ..models import (
    Chapter, ChapterVersion, Character, DocumentChunk, GraphEdge, Location,
    Novel, NovelStatus, PlotThread, Scene, ThreadPriority, ThreadStatus, WorldSetting,
)
from ..schemas import (
    ExportRequest, NovelCreate, NovelResponse, NovelUpdate, WorkspaceCounts, WorkspaceResponse,
)
from .helpers import (
    _as_local_date, _chapter_summary, _get_novel, _novel,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------- novels
@router.get("/workspace", response_model=WorkspaceResponse)
def get_workspace(database: Session = Depends(get_db)):
    novel = database.scalar(select(Novel).order_by(Novel.updated_at.desc()).limit(1))
    if not novel:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return _detail(database, novel.id)


@router.get("/novels", response_model=list[NovelResponse])
def list_novels(database: Session = Depends(get_db)):
    # One grouped query instead of 2 sub-selects per novel (was 2N+1 queries).
    # SQLite lets us group by the primary key and read the other Novel columns.
    rows = database.execute(
        select(
            Novel,
            func.coalesce(func.sum(Chapter.word_count), 0).label("total_words"),
            func.count(Chapter.id).label("chapter_count"),
        )
        .outerjoin(Chapter, Chapter.novel_id == Novel.id)
        .group_by(Novel.id)
        .order_by(Novel.updated_at.desc())
    ).all()
    out = []
    for novel, total_words, chapter_count in rows:
        resp = NovelResponse.model_validate(novel)
        resp.total_words = total_words or 0
        resp.chapter_count = chapter_count or 0
        out.append(resp)
    return out


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


def _counts(database: Session, novel_id: str) -> WorkspaceCounts:
    """Sidebar/statusbar badge counts. Cheap indexed COUNTs; the slim workspace
    no longer ships the entity rows so the shell needs numbers instead."""
    def count(stmt) -> int:
        return database.scalar(stmt) or 0
    return WorkspaceCounts(
        scenes=count(
            select(func.count(Scene.id)).join(Chapter, Scene.chapter_id == Chapter.id)
            .where(Chapter.novel_id == novel_id)),
        characters=count(select(func.count(Character.id)).where(Character.novel_id == novel_id)),
        locations=count(select(func.count(Location.id)).where(Location.novel_id == novel_id)),
        world_settings=count(select(func.count(WorldSetting.id)).where(WorldSetting.novel_id == novel_id)),
        plot_threads=count(select(func.count(PlotThread.id)).where(PlotThread.novel_id == novel_id)),
        unresolved_threads=count(select(func.count(PlotThread.id)).where(
            PlotThread.novel_id == novel_id, PlotThread.status != ThreadStatus.RESOLVED)),
        unresolved_major=count(select(func.count(PlotThread.id)).where(
            PlotThread.novel_id == novel_id, PlotThread.status != ThreadStatus.RESOLVED,
            PlotThread.priority == ThreadPriority.MAJOR)),
        graph_edges=count(select(func.count(GraphEdge.id)).where(GraphEdge.novel_id == novel_id)),
    )


def _detail(database: Session, novel_id: str) -> WorkspaceResponse:
    """Slim workspace (#2)：小说 + 章节元数据 + 计数。实体行由各自的
    list 端点按需拉取——整包加载曾把全部角色/设定/伏笔塞进每次 reload。"""
    novel = _get_novel(database, novel_id)
    return WorkspaceResponse(
        novel=_novel(novel, database),
        # load_only: the summary payload never reads Chapter.content — without
        # it every workspace load pulled the full text of every chapter.
        chapters=[_chapter_summary(c) for c in database.scalars(
            select(Chapter).options(load_only(
                Chapter.id, Chapter.novel_id, Chapter.title, Chapter.order,
                Chapter.word_count, Chapter.status, Chapter.created_at, Chapter.updated_at,
            )).where(Chapter.novel_id == novel_id).order_by(Chapter.order))],
        counts=_counts(database, novel_id),
    )


@router.get("/novels/{novel_id}", response_model=WorkspaceResponse)
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
    database.execute(sa_delete(DocumentChunk).where(DocumentChunk.novel_id == novel_id))
    database.commit()


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
    # load_only: only word_count is needed — the ORM would otherwise load the
    # full text of every chapter in the novel on every activity request.
    chapters = database.scalars(
        select(Chapter).options(load_only(Chapter.id, Chapter.word_count))
        .where(Chapter.novel_id == novel_id)
    ).all()
    chapter_ids = [c.id for c in chapters]

    # Buckets keyed by YYYY-MM-DD (server-local). Default 0.
    today = datetime.now(timezone.utc).astimezone().date()
    start = today - timedelta(days=days - 1)
    buckets: dict[str, int] = {}
    cursor = start
    while cursor <= today:
        buckets[cursor.isoformat()] = 0
        cursor += timedelta(days=1)

    if chapter_ids:
        # Same for the snapshots: metadata columns only (content excluded).
        rows = database.scalars(
            select(ChapterVersion).options(load_only(
                ChapterVersion.chapter_id, ChapterVersion.word_count, ChapterVersion.created_at,
            )).where(ChapterVersion.chapter_id.in_(chapter_ids))
            .order_by(ChapterVersion.chapter_id, ChapterVersion.version_number)
        ).all()
        # Group by chapter to compute consecutive deltas.
        prev_wc: dict[str, int] = {}
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


# ---------------------------------------------------------------- search & export
@router.get("/novels/{novel_id}/search")
def search_novel(novel_id: str, q: str = Query(min_length=1), database: Session = Depends(get_db)):
    """混合检索（RAG设计方案.md §六）：向量召回(0.7) + LIKE 召回(0.3) 融合排序，
    结果带 snippet。未启用 embedding 时完全回退原有 LIKE 行为。"""
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

    def like_snippet(content: str) -> str:
        pos = content.find(q)
        if pos < 0:
            return content[:60]
        return "…" + content[max(0, pos - 25):pos + 40].replace(chr(10), " ") + "…"

    chapter_items = [{
        "id": c.id, "title": c.title, "order": c.order, "word_count": c.word_count,
        "snippet": like_snippet(c.content or ""), "score": 0.3, "semantic": False,
    } for c in chapters]

    # ── 语义召回：命中"同义但无关键词"的章节 ──
    semantic = False
    try:
        from ..services.rag import embedder as rag_embedder
        from ..services.rag import indexer as rag_indexer
        from ..services.rag import retriever as rag_retriever
        settings = rag_embedder.settings_for(rag_indexer.rag_config(database))
        if settings:
            semantic = True
            hits = rag_retriever.search(
                database, novel_id, q, source_types=("chapter",),
                top_k=12, embed_settings=settings, model_filter=settings.model,
            )
            like_ids = {c.id for c in chapters}
            by_id = {item["id"]: item for item in chapter_items}
            # Metadata only — this map exists to enrich hits with chapter
            # order/title/word_count, not to re-load every chapter's full text.
            order_by_id = {c.id: c for c in database.scalars(
                select(Chapter).options(load_only(
                    Chapter.id, Chapter.title, Chapter.order, Chapter.word_count))
                .where(Chapter.novel_id == novel_id))}
            for h in hits:
                ch = order_by_id.get(h.chunk.source_id)
                if not ch:
                    continue
                cos = max(0.0, h.score)
                if h.chunk.source_id in by_id:
                    by_id[h.chunk.source_id]["score"] = 0.7 * cos + 0.3
                    by_id[h.chunk.source_id]["snippet"] = "…" + h.chunk.text[:80].replace(chr(10), " ") + "…"
                    by_id[h.chunk.source_id]["semantic"] = True
                else:
                    chapter_items.append({
                        "id": ch.id, "title": ch.title, "order": ch.order, "word_count": ch.word_count,
                        "snippet": "…" + h.chunk.text[:80].replace(chr(10), " ") + "…",
                        "score": 0.7 * cos, "semantic": True,
                    })
            chapter_items.sort(key=lambda x: x["score"], reverse=True)
    except Exception:
        # 语义失败回退 LIKE 结果——留痕，否则 RAG 静默失效无从排查。
        logger.warning("semantic search fallback to LIKE", exc_info=True)

    return {
        "semantic": semantic,
        "chapters": chapter_items,
        "characters": [{"id": c.id, "name": c.name, "role": c.role} for c in characters],
        "threads": [{"id": t.id, "title": t.title, "status": t.status.value} for t in threads],
        "total": len(chapter_items) + len(characters) + len(threads),
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

    if fmt == "docx":
        # (#5) Word export with heading hierarchy; pure-python via python-docx.
        from io import BytesIO
        from docx import Document
        from docx.shared import Pt
        doc = Document()
        h = doc.add_heading(novel.title, level=0)
        if novel.author:
            doc.add_paragraph(novel.author)
        if novel.description:
            doc.add_paragraph(novel.description)
        for c in chapters:
            doc.add_heading(f"第 {c.order} 章 · {c.title}", level=1)
            for para in (c.content or "").split("\n"):
                stripped = para.strip()
                if stripped:
                    p = doc.add_paragraph(stripped)
                    p.paragraph_format.space_after = Pt(6)
        buf = BytesIO()
        doc.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers=disposition(novel.title, "docx"))

    # default txt
    body = f"{novel.title}\n{novel.author or ''}\n\n"
    for c in chapters:
        body += f"第 {c.order} 章 · {c.title}\n\n{c.content}\n\n\n"
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=disposition(novel.title, "txt"))
