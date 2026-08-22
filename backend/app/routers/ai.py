"""AI model configs, streaming generation, thread suggestions,
continuation directions, and token usage stats."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db, session_scope
from ..models import AIConfig, AIUsage, Chapter, Novel, PlotThread, ThreadPriority, ThreadStatus
from ..schemas import (
    AIConfigCreate, AIConfigResponse, AIConfigTestRequest, AIConfigUpdate,
    AIConsistencyRequest, AIGenerateRequest, AIModelsRequest,
)
from ..services.ai import dispatcher, prompt_builder
from .helpers import _active_config, _ai_config, _as_local_date, _get_novel, _utcnow

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------- AI
@router.get("/ai/configs", response_model=list[AIConfigResponse])
def list_ai_configs(database: Session = Depends(get_db)):
    return [_ai_config(c) for c in database.scalars(select(AIConfig).order_by(AIConfig.id))]


@router.post("/ai/configs", response_model=AIConfigResponse, status_code=201)
def create_ai_config(payload: AIConfigCreate, database: Session = Depends(get_db)):
    from ..security import encrypt_key
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
    from ..security import encrypt_key
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
    active = _active_config(database)
    return {
        "active": _ai_config(active).model_dump(mode="json") if active else None,
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
    from ..security import decrypt_key
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


def _parse_model_context(item: dict) -> int | None:
    """Best-effort extraction of a model's context window from /models metadata.
    Provider field names vary (OpenAI has none, OpenCode Go/others add their
    own); accept common spellings and "128k"-style strings."""
    import re
    for key in ("context_length", "context_window", "max_context_length", "max_context_window",
                "input_token_limit", "max_model_len", "max_tokens"):
        value = item.get(key)
        if value is None:
            continue
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
        if isinstance(value, str):
            text = value.strip().lower().replace("tokens", "").strip()
            match = re.match(r"^(\d+(?:\.\d+)?)\s*k$", text)
            if match:
                return int(float(match.group(1)) * 1000)
            if text.isdigit():
                return int(text)
    return None


@router.post("/ai/models")
def list_ai_models(payload: AIModelsRequest, database: Session = Depends(get_db)):
    """Proxy GET {base_url}/models and return the model list with context
    windows, so the form can offer a picker instead of typing an id. Works for
    both the new-form flow (base_url + api_key supplied) and editing an existing
    config (config_id reuses the stored key). The key never reaches the browser."""
    import httpx
    from ..security import decrypt_key
    base_url = (payload.base_url or "").rstrip("/")
    api_key = payload.api_key or ""
    if payload.config_id:
        cfg = database.get(AIConfig, payload.config_id)
        if cfg:
            base_url = base_url or cfg.base_url.rstrip("/")
            api_key = api_key or decrypt_key(cfg.api_key)
    if not base_url or not api_key:
        return {"ok": False, "detail": "缺少 Base URL 或 API Key，无法获取模型列表。"}
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
    data = resp.json()
    items = data.get("data") or data.get("models") or []
    models: list[dict] = []
    for item in items:
        if isinstance(item, str):
            models.append({"id": item, "context_length": None})
            continue
        model_id = item.get("id") if isinstance(item, dict) else None
        if not model_id:
            continue
        models.append({"id": model_id, "context_length": _parse_model_context(item)})
    models.sort(key=lambda m: m["id"])
    return {"ok": True, "detail": f"获取 {len(models)} 个模型", "models": models}


@router.post("/ai/export-env")
def export_ai_env(database: Session = Depends(get_db)):
    """Write the active AI config (key decrypted server-side) to .env so the
    user has one visible file holding the full credentials. The cleartext key
    is never sent to the browser — it goes straight from DB → file."""
    from ..ai_env import export_env_config
    return export_env_config(database)


def _prepare_generation(req: AIGenerateRequest) -> tuple[list[dict[str, str]], AIConfig | None, str]:
    """Validate the request and build the prompt *before* the streaming response
    is created. Doing this here (rather than inside the async generator) means a
    missing novel/chapter raises an HTTPException that surfaces as a proper 4xx,
    instead of a 200 whose body is a broken event stream. This function runs in
    the threadpool (sync route) — the RAG embedding call inside must NOT run on
    the event loop, which is why the result is computed once here and handed to
    the streaming generator instead of being recomputed there."""
    with session_scope() as database:
        novel = _get_novel(database, req.novel_id)  # raises 404 before headers are sent
        current_content = ""
        if req.chapter_id:
            chapter = database.get(Chapter, req.chapter_id)
            if chapter:
                current_content = chapter.content
        # ── RAG 检索注入（RAG设计方案.md §五）：当前章节结尾做 query，
        #    召回前文/资料相关块注入 prompt；未启用 embedding 时静默跳过。──
        rag_chunks: list = []
        if getattr(req.context, "prior_chapters", False) or getattr(req.context, "library", False):
            try:
                from ..services.rag import embedder as rag_embedder
                from ..services.rag import indexer as rag_indexer
                from ..services.rag import retriever as rag_retriever
                embed_settings = rag_embedder.settings_for(rag_indexer.rag_config(database))
                if embed_settings:
                    query = (current_content or req.instruction)[-600:] or req.instruction
                    source_types = []
                    if getattr(req.context, "prior_chapters", False):
                        source_types.append("chapter")
                    if getattr(req.context, "library", False):
                        source_types.append("library")
                    hits = rag_retriever.search(
                        database, req.novel_id, query,
                        source_types=tuple(source_types), top_k=4,
                        exclude_source_id=req.chapter_id, embed_settings=embed_settings,
                        model_filter=embed_settings.model,
                    )
                    rag_chunks = [
                        {"kind": h.chunk.source_type, "title": h.chunk.title, "text": h.chunk.text}
                        for h in hits
                    ]
            except Exception:
                # 检索失败绝不影响生成——但要留痕，否则 RAG 静默失效无法排查。
                logger.warning("RAG retrieval for generation failed", exc_info=True)
                rag_chunks = []
        messages = prompt_builder.build_messages(
            database, novel, instruction=req.instruction, mode=req.mode,
            target_words=req.target_words, context=req.context, current_content=current_content,
            rag_chunks=rag_chunks or None,
        )
        # Per-call model override (the UI lets the user switch models on the fly);
        # falls back to the active config when no config_id is given OR when the
        # specified config no longer exists (e.g. deleted while selected in the UI).
        config = database.get(AIConfig, req.config_id) if req.config_id else None
        if not config:
            config = _active_config(database)
        from ..security import decrypt_key
        has_key = bool(decrypt_key(config.api_key)) if config else False
        model_name = config.model if config and has_key and config.base_url else "mock (offline)"
        return messages, config, model_name


async def _ai_generate_stream(req: AIGenerateRequest, prepared):
    # Validation + prompt building already happened in the route handler
    # (_prepare_generation runs once, in the threadpool — never on this loop).
    messages, config, model_name = prepared
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
            with session_scope() as database:
                database.add(AIUsage(
                    novel_id=req.novel_id, model=model_name, mode=req.mode or "",
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                ))
                database.commit()
        except Exception:
            logger.warning("failed to record AI usage", exc_info=True)


def _stream_response(req: AIGenerateRequest) -> StreamingResponse:
    # Computed exactly once (this is a sync route → runs in the threadpool).
    prepared = _prepare_generation(req)  # raises 404/422 synchronously, before the 200/stream starts
    return StreamingResponse(_ai_generate_stream(req, prepared), media_type="text/event-stream",
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


@router.post("/ai/worldsetting")
def ai_worldsetting(req: AIGenerateRequest):
    """Generate a world-setting entry from a rough idea (name/category/desc)."""
    req.mode = "worldsetting"
    req.target_words = 300
    # Existing settings are the reference so the AI doesn't duplicate/conflict.
    req.context.settings = True
    return _stream_response(req)


@router.post("/ai/setting-expand")
def ai_setting_expand(req: AIGenerateRequest):
    """Expand an existing setting's description (used from the edit dialog)."""
    req.mode = "setting_expand"
    req.target_words = 300
    req.context.settings = True
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


# ---------------------------------------------------------------- AI directions (续写方向)
@router.post("/ai/directions")
async def ai_directions(req: AIGenerateRequest):
    """Suggest 3 distinct continuation directions for the current chapter.

    Streams the real model with a strict-JSON prompt and parses the result; if
    the model is offline/mock or the output isn't parseable, falls back to a
    heuristic built from the novel's unresolved plot threads so the UI always
    has 3 usable options."""
    with session_scope() as database:
        novel = _get_novel(database, req.novel_id)  # 404 before anything else
        tail = ""
        if req.chapter_id:
            chapter = database.get(Chapter, req.chapter_id)
            if chapter and chapter.content:
                tail = chapter.content[-400:]
        threads = database.scalars(
            select(PlotThread).where(
                PlotThread.novel_id == req.novel_id,
                PlotThread.status != ThreadStatus.RESOLVED,
            ).order_by(PlotThread.created_at).limit(5)
        ).all()
        thread_lines = [f"- {t.title}（{THREAD_PRIORITY_LABEL_CN.get(t.priority.value, '支线')}）：{t.description}" for t in threads]
        config = _active_config(database)

    system = (
        "你是小说续写策划。根据章节结尾与未收束伏笔，提出3个互相差异明显的续写方向。"
        '只输出 JSON 数组，不要任何解释或代码块标记，格式：'
        '[{"title":"6字以内方向名","desc":"40字以内具体写法"}]'
    )
    user_parts = [f"小说：《{novel.title}》"]
    if tail:
        user_parts.append(f"章节结尾：…{tail}")
    if thread_lines:
        user_parts.append("未收束伏笔：\n" + "\n".join(thread_lines))
    user_parts.append("要求：三个方向分别侧重 情节推进 / 人物关系 / 悬念反转 之一。")
    messages = [{"role": "system", "content": system}, {"role": "user", "content": "\n\n".join(user_parts)}]

    fallback = _fallback_directions(threads)
    try:
        chunks: list[str] = []
        async for piece in dispatcher.stream(config, messages):
            chunks.append(piece)
            if sum(len(c) for c in chunks) > 4000:
                break
        text = "".join(chunks)
        parsed = _parse_directions(text)
        if parsed:
            return {"directions": parsed, "source": "ai"}
    except Exception:
        pass
    return {"directions": fallback, "source": "fallback"}


THREAD_PRIORITY_LABEL_CN = {"major": "主线", "minor": "支线", "detail": "细节"}


def _parse_directions(text: str) -> list[dict] | None:
    """Extract the JSON array of {title, desc} from a model reply."""
    import json as _json
    import re as _re
    match = _re.search(r"\[.*\]", text, _re.S)
    if not match:
        return None
    try:
        data = _json.loads(match.group(0))
    except _json.JSONDecodeError:
        return None
    out = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()[:12]
        desc = str(item.get("desc", "")).strip()[:60]
        if title and desc:
            out.append({"title": title, "desc": desc})
        if len(out) == 3:
            break
    return out if len(out) == 3 else None


def _fallback_directions(threads: list[PlotThread]) -> list[dict]:
    """Offline/parse-failure fallback: derive directions from plot threads."""
    out: list[dict] = []
    for t in threads[:3]:
        out.append({"title": f"推进「{t.title[:6]}」", "desc": t.description[:56] or f"让线索「{t.title}」在本章显性推进一次"})
    while len(out) < 3:
        generic = [
            {"title": "深化当前冲突", "desc": "把本章已有矛盾推到必须做出选择的地步，留一个钩子"},
            {"title": "转入静与内视", "desc": "用一段安静的场景写人物内心，为下一波冲突蓄力"},
            {"title": "引入意外来客", "desc": "让一个新登场或久未出现的人物带来消息，改变局面"},
        ]
        out.append(generic[len(out) % 3])
    return out[:3]


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
    """A naive-UTC datetime `days` ago, for filtering recent usage rows
    (created_at is stored naive-UTC — a local-time `now()` would shift the
    window on every non-UTC machine)."""
    return _utcnow() - timedelta(days=days)


