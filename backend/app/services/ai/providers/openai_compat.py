"""OpenAI-compatible streaming provider. Works with GPT, DeepSeek, Claude
(via OpenAI-compatible base_url / proxies / OpenRouter) — anything exposing
POST {base_url}/chat/completions with an SSE stream of chat.completion.chunk."""
from __future__ import annotations

import json
import re
from typing import AsyncIterator

try:
    import httpx  # type: ignore

    _HTTPX_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    _HTTPX_AVAILABLE = False


def _max_tokens_cap_from_error(message: str, requested: int) -> int | None:
    """Extract the provider's real max_tokens ceiling from a rejection message.

    Providers reject an oversized max_tokens outright instead of clamping it
    (DeepSeek: "the valid range of max_tokens is [1, 8192]"; OpenAI: "This
    model supports at most 16384 completion tokens"). So a generously
    configured value must be retried at the provider's own limit, not fail."""
    if "max_tokens" not in message.lower():
        return None
    for pattern in (r"\[\s*\d+\s*,\s*(\d+)\s*\]", r"at most (\d+)"):
        match = re.search(pattern, message)
        if match:
            cap = int(match.group(1))
            if 0 < cap < requested:
                return cap
    return None


class OpenAICompatProvider:
    name = "openai-compat"

    def __init__(self, *, model: str, base_url: str, api_key: str) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        # Filled in by stream() when the provider's final usage chunk arrives.
        self.last_usage: dict[str, int] | None = None

    @property
    def available(self) -> bool:
        return _HTTPX_AVAILABLE and bool(self.api_key) and bool(self.base_url)

    def _endpoint(self) -> str:
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return f"{self.base_url}/chat/completions"

    async def stream(
        self, messages: list[dict[str, str]], *, temperature: float, max_tokens: int
    ) -> AsyncIterator[str]:
        if not self.available:
            raise RuntimeError("OpenAI-compatible provider needs httpx, base_url and api_key")

        # A 4xx naming max_tokens is a ceiling mismatch, not a transient
        # failure: retry once at the limit parsed from the error body (and
        # only before any text has been yielded, so output is never replayed).
        cap = max_tokens
        for attempt in range(2):
            produced = False
            try:
                async for piece in self._stream_once(messages, temperature=temperature, max_tokens=cap):
                    produced = True
                    yield piece
                return
            except RuntimeError as err:
                retry_cap = _max_tokens_cap_from_error(str(err), cap)
                if attempt == 0 and not produced and retry_cap:
                    cap = retry_cap
                    continue
                raise

    async def _stream_once(
        self, messages: list[dict[str, str]], *, temperature: float, max_tokens: int
    ) -> AsyncIterator[str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        # Minimal payload: some OpenAI-compatible proxies (e.g. OpenCode Go's
        # "Console Go" gateway) reject fields they don't understand with cryptic
        # errors like "Invalid n value". Only send the universally-honored fields.
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        # read timeout caps how long we wait for the *first* token (and for any
        # gap between chunks). 90s comfortably covers a real model's 20-40s
        # first-token latency while still failing a truly dead connection far
        # sooner than the old 120s. The dispatcher retries once on top of this.
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0)) as client:
            async with client.stream("POST", self._endpoint(), headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="replace")
                    raise RuntimeError(f"模型返回 {response.status_code}: {body[:300]}")
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    # Usage may arrive on a final chunk even without stream_options.
                    usage = chunk.get("usage")
                    if usage:
                        # Cached-input tokens: DeepSeek reports prompt_cache_hit_tokens,
                        # OpenAI nests them under prompt_tokens_details.cached_tokens.
                        # Providers that report neither just get 0.
                        details = usage.get("prompt_tokens_details") or {}
                        cached = usage.get("prompt_cache_hit_tokens") or details.get("cached_tokens") or 0
                        self.last_usage = {
                            "prompt_tokens": usage.get("prompt_tokens", 0),
                            "completion_tokens": usage.get("completion_tokens", 0),
                            "total_tokens": usage.get("total_tokens", 0),
                            "cached_tokens": int(cached),
                        }
                    # 兼容端点常在流结束时发一个只带 usage、choices 为空列表的
                    # 收尾块（或心跳块）。key 存在时 get 的默认值不生效，直接取
                    # [0] 会 IndexError——这曾把整次生成在最后一块上炸掉。
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content")
                    if delta:
                        yield delta
