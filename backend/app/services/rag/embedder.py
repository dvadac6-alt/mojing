"""OpenAI-compatible /v1/embeddings client for RAG.

Reads the embedding config off the active AIConfig (embed_model empty = RAG
disabled; embed_base_url / embed_api_key fall back to the generation config's
base_url / api_key). Batches requests (<=32 texts), retries once on transport
errors, backs off briefly on 429. All failures raise EmbeddingError — callers
degrade gracefully (chunks land with embedding=NULL and get backfilled later).
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from ...models import RagConfig
from ...security import decrypt_key


class EmbeddingError(RuntimeError):
    """Raised when embeddings cannot be obtained (disabled, network, API)."""


@dataclass(frozen=True)
class EmbedSettings:
    base_url: str
    api_key: str
    model: str


def settings_for(config: RagConfig | None) -> EmbedSettings | None:
    """Resolve the effective embedding settings, or None if RAG is disabled.
    RAG 配置独立于写作模型（rag_config 单例）——不回退生成配置。"""
    if not config or not config.model:
        return None
    base = (config.base_url or "").rstrip("/")
    api_key = decrypt_key(config.api_key) if config.api_key else ""
    if not base or not api_key:
        return None
    return EmbedSettings(base_url=base, api_key=api_key, model=config.model)


def _endpoint(base_url: str) -> str:
    if base_url.endswith("/embeddings"):
        return base_url
    return f"{base_url}/embeddings"


def embed_texts(settings: EmbedSettings, texts: list[str]) -> list[list[float]]:
    """Embed a list of texts (batched <=32). Returns vectors in input order."""
    if not texts:
        return []
    out: list[list[float]] = []
    for start in range(0, len(texts), 32):
        batch = [t[:4000] or " " for t in texts[start:start + 32]]  # guard空串与超长
        out.extend(_embed_batch(settings, batch))
    return out


def _embed_batch(settings: EmbedSettings, batch: list[str]) -> list[list[float]]:
    payload = {"model": settings.model, "input": batch}
    headers = {"Authorization": f"Bearer {settings.api_key}", "Content-Type": "application/json"}
    last_error = ""
    for attempt in (1, 2):
        try:
            resp = httpx.post(
                _endpoint(settings.base_url), headers=headers, json=payload,
                timeout=httpx.Timeout(60.0, connect=10.0),
            )
            if resp.status_code == 429 and attempt == 1:
                time.sleep(2.0)
                continue
            if resp.status_code >= 400:
                raise EmbeddingError(f"embedding 接口返回 {resp.status_code}: {resp.text[:200]}")
            data = resp.json().get("data")
            if not isinstance(data, list) or len(data) != len(batch):
                raise EmbeddingError(f"embedding 返回数量不符（{len(data) if isinstance(data, list) else '?'} / {len(batch)}）")
            return [item["embedding"] for item in sorted(data, key=lambda d: d.get("index", 0))]
        except httpx.HTTPError as exc:
            last_error = str(exc)
            if attempt == 1:
                time.sleep(1.0)
                continue
            raise EmbeddingError(f"embedding 请求失败: {last_error}") from exc
    raise EmbeddingError(f"embedding 请求失败: {last_error}")


def test_connection(settings: EmbedSettings) -> dict:
    """Connectivity probe used by the settings page; returns vector dimension."""
    vec = embed_texts(settings, ["连接测试"])[0]
    return {"ok": True, "dim": len(vec), "model": settings.model}
