"""余弦检索器：候选块载入内存 → 向量点积 → top-k。

单用户本地规模（数千块）毫秒级；numpy 存在时用矩阵运算，否则回退纯 Python。
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from ...models import DocumentChunk
from . import embedder, indexer

try:
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None


@dataclass(frozen=True)
class Retrieved:
    chunk: DocumentChunk
    score: float


def search(
    database: Session,
    novel_id: str | None,
    query_text: str,
    *,
    source_types: tuple[str, ...] = ("chapter", "library"),
    top_k: int = 4,
    exclude_source_id: str | None = None,
    embed_settings: embedder.EmbedSettings | None = None,
    model_filter: str | None = None,
) -> list[Retrieved]:
    """语义检索 top-k。embed_settings 未给时从 active 配置解析；未启用返回 []。"""
    if embed_settings is None:
        return []
    q_vec = embedder.embed_texts(embed_settings, [query_text[:2000]])[0]
    # defer(text): scoring only needs id + embedding — the chunk bodies (the
    # bulk of the index) load lazily, and only for the few top hits below.
    stmt = select(DocumentChunk).options(defer(DocumentChunk.text)).where(
        DocumentChunk.source_type.in_(source_types),
        DocumentChunk.embedding.is_not(None),
    )
    if model_filter:
        stmt = stmt.where(DocumentChunk.embedding_model == model_filter)
    if novel_id:
        # 章节块按小说过滤；资料块（novel_id NULL=全局共享）也纳入。
        stmt = stmt.where((DocumentChunk.novel_id == novel_id) | (DocumentChunk.novel_id.is_(None)))
    if exclude_source_id:
        stmt = stmt.where(
            ~((DocumentChunk.source_type == "chapter") & (DocumentChunk.source_id == exclude_source_id))
        )
    rows = database.scalars(stmt).all()
    if not rows:
        return []

    scored: list[tuple[float, DocumentChunk]] = []
    if _np is not None:
        mat = _np.array([indexer.blob_to_vec(r.embedding) for r in rows], dtype=_np.float32)
        q = _np.array(q_vec, dtype=_np.float32)
        norms = _np.linalg.norm(mat, axis=1) * (_np.linalg.norm(q) or 1.0)
        sims = (mat @ q) / _np.maximum(norms, 1e-10)
        scored = [(float(s), r) for s, r in zip(sims, rows)]
    else:  # 纯 Python 兜底
        qn = sum(x * x for x in q_vec) ** 0.5 or 1.0
        for r in rows:
            v = indexer.blob_to_vec(r.embedding)
            dot = sum(a * b for a, b in zip(v, q_vec))
            scored.append((dot / ((sum(x * x for x in v) ** 0.5) * qn), r))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [Retrieved(chunk=r, score=s) for s, r in scored[:top_k] if s > 0.05]
