"""RAG index management, the reference library, and the standalone
embedding config (decoupled from the writing model)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AIConfig, DocumentChunk, LibraryDoc, RagConfig
from ..schemas import (
    LibraryDocCreate, LibraryDocResponse, RagConfigUpdate, RagTestSearchRequest,
)

router = APIRouter()

# ---------------------------------------------------------------- RAG & 资料库
@router.get("/rag/status")
def rag_status_endpoint(database: Session = Depends(get_db)):
    """索引状态：块数/pending/当前 embed 模型/换模型未重建提示。"""
    from ..services.rag import indexer as rag_indexer
    return rag_indexer.rag_status(database)


@router.post("/rag/rebuild")
def rag_rebuild(database: Session = Depends(get_db)):
    """全量重建索引（切换 embedding 模型后使用）。"""
    from ..services.rag import indexer as rag_indexer
    return rag_indexer.rebuild_all(database)


@router.post("/rag/test-search")
def rag_test_search(payload: RagTestSearchRequest, database: Session = Depends(get_db)):
    """检索调试：返回命中块、分数与来源（LibraryPage / 调参用）。"""
    from ..services.rag import embedder as rag_embedder
    from ..services.rag import indexer as rag_indexer
    from ..services.rag import retriever as rag_retriever
    settings = rag_embedder.settings_for(rag_indexer.rag_config(database))
    if not settings:
        return {"enabled": False, "results": [], "detail": "尚未配置 RAG 模型（设置 → AI 模型 → RAG 模型按钮）"}
    hits = rag_retriever.search(
        database, payload.novel_id, payload.query,
        source_types=tuple(payload.source_types) or ("chapter", "library"),
        top_k=8, embed_settings=settings, model_filter=settings.model,
    )
    return {
        "enabled": True, "embed_model": settings.model,
        "results": [
            {"title": h.chunk.title, "source_type": h.chunk.source_type, "text": h.chunk.text,
             "score": round(h.score, 4)}
            for h in hits
        ],
    }


@router.get("/library/docs", response_model=list[LibraryDocResponse])
def list_library_docs(database: Session = Depends(get_db)):
    from sqlalchemy import func as sa_func
    docs = database.scalars(select(LibraryDoc).order_by(LibraryDoc.created_at.desc())).all()
    counts = dict(database.execute(
        select(DocumentChunk.source_id, sa_func.count(DocumentChunk.id))
        .where(DocumentChunk.source_type == "library").group_by(DocumentChunk.source_id)
    ).all())
    out = []
    for d in docs:
        resp = LibraryDocResponse(
            id=d.id, novel_id=d.novel_id, name=d.name, category=d.category,
            source=d.source, size_chars=d.size_chars, chunks=counts.get(str(d.id), 0),
            created_at=d.created_at,
        )
        out.append(resp)
    return out


@router.post("/library/docs", response_model=LibraryDocResponse, status_code=201)
def import_library_doc(payload: LibraryDocCreate, database: Session = Depends(get_db)):
    """导入资料（TXT/粘贴同入口）：建档 → 切块 → 向量化（失败挂 pending）。"""
    from ..services.rag import indexer as rag_indexer
    if len(payload.content) > 2_000_000:
        raise HTTPException(status_code=422, detail="文档过大（>2MB），请拆分后导入")
    doc = LibraryDoc(
        novel_id=payload.novel_id, name=payload.name.strip()[:200],
        category=payload.category, source="txt", size_chars=len(payload.content),
    )
    database.add(doc)
    database.flush()
    rag_indexer.reindex_library_doc(database, doc, payload.content)
    database.commit()
    database.refresh(doc)
    chunks = database.scalar(
        select(func.count(DocumentChunk.id)).where(
            DocumentChunk.source_type == "library", DocumentChunk.source_id == str(doc.id))) or 0
    return LibraryDocResponse(
        id=doc.id, novel_id=doc.novel_id, name=doc.name, category=doc.category,
        source=doc.source, size_chars=doc.size_chars, chunks=chunks, created_at=doc.created_at,
    )


@router.delete("/library/docs/{doc_id}", status_code=204)
def delete_library_doc(doc_id: int, database: Session = Depends(get_db)):
    doc = database.get(LibraryDoc, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Library doc not found")
    database.delete(doc)
    database.execute(sa_delete(DocumentChunk).where(
        DocumentChunk.source_type == "library", DocumentChunk.source_id == str(doc_id)))
    database.commit()


# ---------------------------------------------------------------- RAG 独立配置（与写作模型解耦）
@router.get("/rag/config")
def get_rag_config(database: Session = Depends(get_db)):
    """RAG embedding 配置（key 只回是否已设 + 掩码，永不明文下发）。"""
    from ..security import decrypt_key, mask_key
    from ..services.rag import indexer as rag_indexer
    cfg = rag_indexer.rag_config(database)
    plain = decrypt_key(cfg.api_key) if cfg and cfg.api_key else ""
    return {
        "configured": bool(cfg and cfg.model and plain),
        "model": cfg.model if cfg else "",
        "base_url": cfg.base_url if cfg else "",
        "has_key": bool(plain),
        "key_hint": mask_key(plain),
    }


@router.put("/rag/config")
def save_rag_config(payload: RagConfigUpdate, database: Session = Depends(get_db)):
    """保存 RAG 配置。api_key 缺省 = 保持不变，空串 = 清除，其余覆盖。"""
    from ..security import encrypt_key
    from ..services.rag import indexer as rag_indexer
    cfg = rag_indexer.rag_config(database)
    if not cfg:
        cfg = RagConfig()
        database.add(cfg)
    if payload.model is not None:
        cfg.model = payload.model.strip()[:120]
    if payload.base_url is not None:
        cfg.base_url = payload.base_url.strip().rstrip("/")[:255]
    if payload.api_key is not None:
        cfg.api_key = encrypt_key(payload.api_key)
    database.commit()
    database.refresh(cfg)
    return get_rag_config(database)


@router.post("/rag/config/test")
def test_rag_config(payload: RagConfigUpdate | None = None, database: Session = Depends(get_db)):
    """测试 RAG embedding 连通。可携带未保存的表单值——先测通再保存。"""
    from ..security import decrypt_key
    from ..services.rag import indexer as rag_indexer
    from ..services.rag.embedder import EmbeddingError, EmbedSettings, test_connection
    cfg = rag_indexer.rag_config(database)
    payload = payload or RagConfigUpdate()
    model = (payload.model or (cfg.model if cfg else "") or "").strip()
    base = (payload.base_url or (cfg.base_url if cfg else "") or "").rstrip("/")
    api_key = payload.api_key or ""
    if not api_key and cfg and cfg.api_key:
        api_key = decrypt_key(cfg.api_key)
    if not model or not base or not api_key:
        return {"ok": False, "detail": "请先填写模型 / Base URL / API Key"}
    try:
        result = test_connection(EmbedSettings(base_url=base, api_key=api_key, model=model))
        return {"ok": True, "detail": f"连接成功，向量维度 {result['dim']}", "dim": result["dim"]}
    except EmbeddingError as exc:
        return {"ok": False, "detail": str(exc)}


