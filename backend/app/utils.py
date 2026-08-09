"""Shared, framework-agnostic helpers used across the app package."""


def count_words(content: str) -> int:
    """Word/character count for prose. Counts non-whitespace characters —
    the conventional measure for Chinese fiction (one CJK char ≈ one 字),
    while still behaving sensibly for mixed-language text."""
    return len("".join((content or "").split()))
