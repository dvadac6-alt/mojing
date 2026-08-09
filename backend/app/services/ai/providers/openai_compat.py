"""OpenAI-compatible streaming provider. Works with GPT, DeepSeek, Claude
(via OpenAI-compatible base_url / proxies / OpenRouter) — anything exposing
POST {base_url}/chat/completions with an SSE stream of chat.completion.chunk."""
from __future__ import annotations

import json
from typing import AsyncIterator

try:
    import httpx  # type: ignore

    _HTTPX_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    _HTTPX_AVAILABLE = False


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

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            # Ask the provider to emit a final chunk carrying token usage so we
            # can account for cost. Most OpenAI-compatible servers honor this.
            "stream_options": {"include_usage": True},
        }

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
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
                    # The usage object rides on a final chunk (choices == []).
                    usage = chunk.get("usage")
                    if usage:
                        self.last_usage = {
                            "prompt_tokens": usage.get("prompt_tokens", 0),
                            "completion_tokens": usage.get("completion_tokens", 0),
                            "total_tokens": usage.get("total_tokens", 0),
                        }
                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                    if delta:
                        yield delta
