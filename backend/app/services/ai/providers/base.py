from __future__ import annotations

from typing import AsyncIterator, Protocol


class BaseProvider(Protocol):
    name: str

    async def stream(self, messages: list[dict[str, str]], *, temperature: float, max_tokens: int) -> AsyncIterator[str]:
        ...
