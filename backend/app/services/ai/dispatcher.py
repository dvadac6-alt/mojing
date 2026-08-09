"""Route generation to the right provider based on the active AIConfig.
Falls back to the deterministic MockProvider when no usable key is configured,
so the writing assistant always works offline."""
from __future__ import annotations

from typing import AsyncIterator

from ...models import AIConfig
from .providers.mock import MockProvider
from .providers.openai_compat import OpenAICompatProvider


def provider_for(config: AIConfig | None):
    if config and config.api_key and config.base_url and config.model:
        return OpenAICompatProvider(model=config.model, base_url=config.base_url, api_key=config.api_key)
    return MockProvider()


async def stream(
    config: AIConfig | None, messages: list[dict[str, str]]
) -> AsyncIterator[str]:
    provider = provider_for(config)
    temperature = float(config.temperature) if config else 0.85
    max_tokens = int(config.max_tokens) if config else 1200
    async for piece in provider.stream(messages, temperature=temperature, max_tokens=max_tokens):
        yield piece
