"""Route generation to the right provider based on the active AIConfig.
Falls back to the deterministic MockProvider when no usable key is configured,
so the writing assistant always works offline."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

from ...models import AIConfig
from ...security import decrypt_key
from .providers.mock import MockProvider
from .providers.openai_compat import OpenAICompatProvider

try:  # httpx is optional at import time; only needed to classify retriable errors
    import httpx  # type: ignore
    _HTTPX_AVAILABLE = True
except Exception:  # pragma: no cover
    _HTTPX_AVAILABLE = False


def _decrypted_key(config: AIConfig | None) -> str:
    """API keys are stored encrypted (Fernet); decrypt for in-process use only."""
    return decrypt_key(config.api_key) if config else ""


def provider_for(config: AIConfig | None):
    api_key = _decrypted_key(config)
    if config and api_key and config.base_url and config.model:
        return OpenAICompatProvider(model=config.model, base_url=config.base_url, api_key=api_key)
    return MockProvider()


def _is_retriable(err: Exception) -> bool:
    """Only retry transient network/timeout failures — a 4xx from the model
    (raised as RuntimeError by the provider) would just fail identically again,
    and we never retry once streaming has already produced output (that would
    duplicate what the user already saw)."""
    if _HTTPX_AVAILABLE and isinstance(
        err, (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError)
    ):
        return True
    return False


async def stream(
    config: AIConfig | None, messages: list[dict[str, str]]
) -> AsyncIterator[str]:
    provider = provider_for(config)
    temperature = float(config.temperature) if config else 0.85
    max_tokens = int(config.max_tokens) if config else 50000
    async for piece in provider.stream(messages, temperature=temperature, max_tokens=max_tokens):
        yield piece


async def stream_with_usage(
    config: AIConfig | None, messages: list[dict[str, str]]
):
    """Like stream(), but also yields the provider so the caller can read its
    `last_usage` dict after the stream completes (for token accounting). The
    provider is yielded once at the start, before any text pieces.

    Retries once on a transient network/timeout failure — but only before any
    text has been produced, so a half-finished stream is never replayed."""
    provider = provider_for(config)
    temperature = float(config.temperature) if config else 0.85
    max_tokens = int(config.max_tokens) if config else 50000
    yield provider
    produced = False
    last_err: Exception | None = None
    for attempt in range(2):  # 1 original + 1 retry
        try:
            async for piece in provider.stream(messages, temperature=temperature, max_tokens=max_tokens):
                produced = True
                yield piece
            return  # completed cleanly
        except Exception as err:
            last_err = err
            # Once we've streamed anything, retrying would duplicate output — bail.
            if produced or attempt > 0 or not _is_retriable(err):
                raise
            # First-token transient failure: back off briefly and try once more.
            await asyncio.sleep(1.0)
    if last_err:  # pragma: no cover - loop always returns or raises above
        raise last_err
