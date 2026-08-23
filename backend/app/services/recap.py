"""F1 章节摘要链 — 滚动前情提要的拼装（纯函数，无 DB 依赖）。

续写上下文装不下全部前文时，用"最近 K 章的结尾段 + 更早章节的摘要串"拼一条
连贯的剧情主线，按字数预算从最旧的条目开始截断。摘要缺失的章节降级为标题行，
绝不报错——提示用户补摘要是前端的事。
"""
from __future__ import annotations

from dataclasses import dataclass

# 最近 N 章附带结尾段（摘要对"刚写完的章节"总是滞后的，结尾才是无缝衔接的关键）。
RECENT_TAIL_COUNT = 2
TAIL_CHARS = 400


@dataclass(frozen=True)
class RecapEntry:
    order: int
    title: str
    summary: str = ""
    tail: str = ""


def _entry_line(entry: RecapEntry, *, with_tail: bool) -> str:
    head = f"第{entry.order}章《{entry.title}》"
    summary = (entry.summary or "").strip()
    if with_tail and entry.tail.strip():
        tail = entry.tail.strip()[-TAIL_CHARS:]
        if summary:
            return f"{head}：{summary}……（本章结尾）{tail}"
        return f"{head}：（未写摘要，附本章结尾）{tail}"
    if summary:
        return f"{head}：{summary}"
    return f"{head}：（未写摘要）"


def build_recap(entries: list[RecapEntry], *, budget: int = 3000,
                recent_full: int = RECENT_TAIL_COUNT) -> str:
    """按章节顺序升序传入当前章之前的章节；返回拼装好的前情提要文本。

    预算超限时丢弃最旧的条目（保底保留最新一条），使注入 prompt 的长度可控。
    """
    if not entries:
        return ""
    ordered = sorted(entries, key=lambda e: e.order)
    total = len(ordered)
    lines = [
        _entry_line(e, with_tail=index >= total - max(recent_full, 0))
        for index, e in enumerate(ordered)
    ]
    kept: list[str] = []
    used = 0
    for line in reversed(lines):
        if kept and used + len(line) > budget:
            break
        kept.append(line)
        used += len(line)
    kept.reverse()
    return "\n".join(kept)
