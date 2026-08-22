"""索引器：把章节正文 / 资料文档切块并向量化写入 document_chunks。

策略（RAG设计方案.md §五）：
- reindex_source 先删旧块再插新块；
- embed 不可用/失败时块以 embedding=NULL 落库（pending），下次保存或 rebuild 补齐；
- 向量与 embedding_model 绑定，换模型后 rebuild_all 全量重建。
"""
from __future__ import annotations

import struct

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ...models import AIConfig, Chapter, DocumentChunk, LibraryDoc, RagConfig
from . import chunker, embedder

try:  # numpy 加速余弦；缺省回退纯 Python（见 retriever）
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None


def vec_to_blob(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def blob_to_vec(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"<{n}f", blob))


def rag_config(database: Session) -> RagConfig | None:
    """取 RAG 单例配置；首次访问时把旧 ai_config.embed_* 字段一次性迁移过来
    （v1 设计曾把 embedding 挂在写作模型上，v2 起独立）。"""
    cfg = database.scalar(select(RagConfig).limit(1))
    if cfg:
        return cfg
    legacy = database.scalar(select(AIConfig).where(AIConfig.embed_model != "").limit(1))
    if legacy and legacy.embed_model:
        cfg = RagConfig(
            base_url=legacy.embed_base_url or legacy.base_url,
            model=legacy.embed_model,
            api_key=legacy.embed_api_key,
        )
        database.add(cfg)
        database.commit()
    return cfg or None


def _active_settings(database: Session):
    cfg = rag_config(database)
    return cfg, embedder.settings_for(cfg)


# Sentinel distinguishing "not resolved yet" from a resolved settings of None
# (RAG disabled) when threading pre-resolved settings through _write_chunks.
_UNRESOLVED = object()


def _write_chunks(
    database: Session, *, novel_id: str | None, source_type: str, source_id: str,
    title: str, chunks: list[tuple[int, str]], settings=_UNRESOLVED,
) -> int:
    """Delete old rows for the source, insert new chunks (embedding or NULL)."""
    database.execute(
        delete(DocumentChunk).where(
            DocumentChunk.source_type == source_type, DocumentChunk.source_id == source_id
        )
    )
    if not chunks:
        database.flush()
        return 0
    if settings is _UNRESOLVED:  # single-source callers resolve lazily
        settings = _active_settings(database)[1]
    texts = [c for _, c in chunks]
    vectors: list[list[float]] | None = None
    if settings:
        try:
            vectors = embedder.embed_texts(settings, texts)
        except embedder.EmbeddingError:
            vectors = None  # pending，下次补
    model_name = settings.model if settings else ""
    for (idx, text), vec in zip(chunks, vectors or [None] * len(chunks)):
        database.add(DocumentChunk(
            novel_id=novel_id, source_type=source_type, source_id=source_id,
            title=title[:200], chunk_index=idx, text=text,
            embedding=vec_to_blob(vec) if vec else None,
            embedding_model=model_name,
        ))
    database.flush()
    return len(chunks)


def reindex_chapter(database: Session, chapter: Chapter, settings=_UNRESOLVED) -> int:
    title = f"第{chapter.order}章 · {chapter.title}"
    chunks = chunker.chunk_chapter(title, chapter.content or "")
    return _write_chunks(
        database, novel_id=chapter.novel_id, source_type="chapter",
        source_id=chapter.id, title=title, chunks=chunks, settings=settings,
    )


def reindex_library_doc(database: Session, doc: LibraryDoc, content: str, settings=_UNRESOLVED) -> int:
    chunks = chunker.chunk_library(doc.name, content)
    return _write_chunks(
        database, novel_id=doc.novel_id, source_type="library",
        source_id=str(doc.id), title=doc.name, chunks=chunks, settings=settings,
    )


def rebuild_all(database: Session) -> dict:
    """全量重建（换 embedding 模型后用）。章节重切自正文；资料库原文不另存，
    以现有块的文本聚合为源重切（切块已保留内容，足够重建）。"""
    from sqlalchemy import func as sa_func, select as sa_select
    chapters = database.scalars(select(Chapter)).all()
    docs = database.scalars(select(LibraryDoc)).all()
    # Resolve the embedding settings once — re-resolving per source ran the
    # rag_config query N times (once per chapter / doc).
    settings = _active_settings(database)[1]
    total = 0
    for ch in chapters:
        total += reindex_chapter(database, ch, settings=settings)
    for doc in docs:
        existing = database.scalars(
            select(DocumentChunk).where(
                DocumentChunk.source_type == "library", DocumentChunk.source_id == str(doc.id)
            ).order_by(DocumentChunk.chunk_index)
        ).all()
        content = "\n".join(c.text for c in existing)
        if content:
            total += reindex_library_doc(database, doc, content, settings=settings)
    database.commit()
    pending = database.scalar(
        sa_select(sa_func.count(DocumentChunk.id)).where(DocumentChunk.embedding.is_(None))
    ) or 0
    return {"chunks": total, "pending": pending}


def backfill_pending(database: Session, limit: int = 512) -> int:
    """给 embedding=NULL 的块补向量（保存触发或手动触发）。返回补齐数量。"""
    cfg, settings = _active_settings(database)
    if not settings:
        return 0
    rows = database.scalars(
        select(DocumentChunk).where(DocumentChunk.embedding.is_(None)).limit(limit)
    ).all()
    if not rows:
        return 0
    done = 0
    for start in range(0, len(rows), 32):
        batch = rows[start:start + 32]
        try:
            vectors = embedder.embed_texts(settings, [r.text for r in batch])
        except embedder.EmbeddingError:
            break
        for row, vec in zip(batch, vectors):
            row.embedding = vec_to_blob(vec)
            row.embedding_model = settings.model
            done += 1
    database.commit()
    return done


def rag_status(database: Session) -> dict:
    """索引状态总览：块数 / pending / 当前 embed 模型 / 换模型提示。"""
    from sqlalchemy import func as sa_func, select as sa_select
    cfg, settings = _active_settings(database)

    def _count(*conditions) -> int:
        stmt = sa_select(sa_func.count(DocumentChunk.id))
        if conditions:
            stmt = stmt.where(*conditions)
        return database.scalar(stmt) or 0

    total = _count()
    pending = _count(DocumentChunk.embedding.is_(None))
    chapter_chunks = _count(DocumentChunk.source_type == "chapter")
    library_chunks = _count(DocumentChunk.source_type == "library")
    # 与当前模型不一致的向量数（换模型未重建的信号）
    stale = _count(
        DocumentChunk.embedding.is_not(None),
        DocumentChunk.embedding_model != settings.model,
    ) if settings else 0
    return {
        "enabled": bool(settings),
        "embed_model": settings.model if settings else "",
        "chunks": {"total": total, "chapter": chapter_chunks, "library": library_chunks, "pending": pending},
        "stale_model_chunks": stale,   # >0 → 提示重建
    }
