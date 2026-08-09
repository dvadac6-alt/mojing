"""Route generation to the right provider based on the active AIConfig.
Falls back to the deterministic MockProvider when no usable key is configured,
so the writing assistant always works offline."""
from __future__ import annotations

from typing import AsyncIterator

from ...models import AIConfig
from ...security import decrypt_key
from .providers.mock import MockProvider
from .providers.openai_compat import OpenAICompatProvider


def _decrypted_key(config: AIConfig | None) -> str:
    """API keys are stored encrypted (Fernet); decrypt for in-process use only."""
    return decrypt_key(config.api_key) if config else ""


def provider_for(config: AIConfig | None):
    api_key = _decrypted_key(config)
    if config and api_key and config.base_url and config.model:
        return OpenAICompatProvider(model=config.model, base_url=config.base_url, api_key=api_key)
    return MockProvider()


async def stream(
    config: AIConfig | None, messages: list[dict[str, str]]
) -> AsyncIterator[str]:
    provider = provider_for(config)
    temperature = float(config.temperature) if config else 0.85
    max_tokens = int(config.max_tokens) if config else 1200
    async for piece in provider.stream(messages, temperature=temperature, max_tokens=max_tokens):
        yield piece
