"""F2 角色登场追踪 — 名字扫描（纯函数）+ 登场记录同步。

扫描策略：把角色名与其别名（顿号/逗号/空格分隔）一起匹配，长名优先——
命中的名字立即用占位符替换，防止短名（"江离"）重复吞掉长名（"江离别"）的命中。
"""
from __future__ import annotations

import re

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Character, CharacterAppearance, Chapter

_ALIAS_SPLIT = re.compile(r"[,，、;；/\s]+")


def character_names(character: Character) -> list[str]:
    """角色名 + 别名（去空白）。names 为空串的项被丢弃。"""
    names = [character.name.strip()]
    names.extend(part.strip() for part in _ALIAS_SPLIT.split(character.aliases or ""))
    return [n for n in names if n]


def scan_mentions(content: str, names: list[str]) -> dict[str, int]:
    """返回每个名字在正文中的命中次数（长名优先，命中后占位）。"""
    counts: dict[str, int] = {}
    text = content or ""
    for name in sorted({n for n in names if n}, key=len, reverse=True):
        hits = text.count(name)
        if hits:
            counts[name] = hits
            text = text.replace(name, "\x00")
    return counts


def sync_chapter_appearances(database: Session, chapter: Chapter) -> int:
    """重扫一章：清掉该章旧记录，按正文命中写入新记录。返回有登场的角色数。
    同一角色的多个名字（名 + 别名）的命中合并为一条。"""
    characters = database.scalars(
        select(Character).where(Character.novel_id == chapter.novel_id)
    ).all()
    database.execute(
        sa_delete(CharacterAppearance).where(CharacterAppearance.chapter_id == chapter.id)
    )
    if not characters:
        return 0
    name_to_char: dict[str, str] = {}
    for character in characters:
        for name in character_names(character):
            # 两个角色共用同一别名时先到先得（罕见，接受）。
            name_to_char.setdefault(name, character.id)
    per_char: dict[str, int] = {}
    for name, hits in scan_mentions(chapter.content or "", list(name_to_char)).items():
        cid = name_to_char[name]
        per_char[cid] = per_char.get(cid, 0) + hits
    for cid, hits in per_char.items():
        database.add(CharacterAppearance(
            novel_id=chapter.novel_id, character_id=cid, chapter_id=chapter.id, hits=hits,
        ))
    return len(per_char)


def rescan_novel(database: Session, novel_id: str) -> int:
    """全量重扫一本小说（角色改名/加别名/初次启用时调用）。
    典型体量（几百章 × 几十字名）在本地 SQLite 上是几十毫秒级，同步执行即可。"""
    total = 0
    for chapter in database.scalars(select(Chapter).where(Chapter.novel_id == novel_id)):
        total += sync_chapter_appearances(database, chapter)
    return total
