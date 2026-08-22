"""Deterministic offline provider. Used when no API key is configured so the app
always has a working AI path. Produces plausible placeholder prose that respects
the instruction and target length, sentence by sentence (streamed)."""
from __future__ import annotations

import re
import zlib
from typing import AsyncIterator


_OPENERS = [
    "雨声忽然停了一拍，又在下一瞬倾泻而下。",
    "檐角的水珠落进铜盆，发出一声极轻的回响。",
    "他抬眼，长街尽头那盏未灭的灯在雾里晃了晃。",
    "风穿过空荡的回廊，把一页未写完的信纸吹落地上。",
    "钟声从城北传来，比记忆里更沉，也更慢。",
    "灯笼的光在水洼里碎成一片，又被风重新拼拢。",
    "她没有说话，只是把那枚旧物轻轻推到他面前。",
    "夜色像被水洗过，连远处的犬吠都显得迟疑。",
    "门轴发出一声干涩的低吟，像是谁在长夜里叹息。",
    "他想起渡口老人最后的目光，落在自己看不见的地方。",
]

_CONNECTORS = ["这时", "然而", "他没有动", "片刻之后", "良久", "随即", "终于", "不知过了多久"]


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


class MockProvider:
    name = "mock"

    def __init__(self, *, seed_text: str = "") -> None:
        self._seed = seed_text

    async def stream(
        self, messages: list[dict[str, str]], *, temperature: float, max_tokens: int
    ) -> AsyncIterator[str]:
        user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        # target length detection from the prompt body
        target = 600
        match = re.search(r"约\s*(\d+)\s*字", user_msg)
        if match:
            target = _clamp(int(match.group(1)), 200, 1600)

        sentences: list[str] = []
        # crc32 instead of hash(): hash() is salted per process (PYTHONHASHSEED),
        # so the same prompt produced different drafts on every backend restart.
        opener_idx = zlib.crc32(user_msg.encode("utf-8")) % len(_OPENERS)
        sentences.append(_OPENERS[opener_idx])
        i = 1
        total = len(sentences[0])
        conn_cycle = zlib.crc32(user_msg[::-1].encode("utf-8")) % len(_CONNECTORS)
        while total < target and i < 14:
            opener = _OPENERS[(opener_idx + i) % len(_OPENERS)]
            conn = _CONNECTORS[(conn_cycle + i) % len(_CONNECTORS)]
            beat = f"{conn}，{opener}"
            sentences.append(beat)
            total += len(beat)
            i += 1

        # a closing beat referencing the instruction keywords
        keywords = [w for w in re.split(r"[，。、；\s]+", user_msg) if 2 <= len(w) <= 6][:3]
        tail = "、".join(keywords) if keywords else "这桩旧案"
        sentences.append(f"至于{tail}，答案或许并不在城北，而在这场停不下来的雨里。")

        import asyncio

        for s in sentences:
            yield s + "\n\n"
            await asyncio.sleep(0.12)
