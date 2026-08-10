"""Build context-aware prompts for AI generation, following the design doc's strategy."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import Chapter, Character, Location, Novel, PlotThread, ThreadStatus, WorldSetting
from ...schemas import AIContextOptions


def _recent_chapter_summary(database: Session, novel_id: str, count: int) -> str:
    if count <= 0:
        return "（未提供前文摘要）"
    chapters = list(
        database.scalars(
            select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.order.desc()).limit(count + 1)
        ).all()
    )
    chapters = list(reversed(chapters))
    if len(chapters) <= 1:
        return "（尚无足够的前文）"
    lines = [f"第 {c.order} 章 · {c.title}（{c.word_count} 字）" for c in chapters[:-1]]
    return "\n".join(lines) or "（尚无足够的前文）"


def _characters_block(characters: list[Character]) -> str:
    if not characters:
        return "（暂无关联角色）"
    return "\n".join(
        f"- {c.name}{'（' + c.aliases + '）' if c.aliases else ''}：{c.role}。{c.description}".strip("。 ")
        + ("。" if (c.role or c.description) else "")
        for c in characters
    )


def _locations_block(locations: list[Location]) -> str:
    if not locations:
        return "（暂无关联地点）"
    return "\n".join(f"- {l.name}（{l.type or '地点'}）：{l.description}" for l in locations)


def _settings_block(settings: list[WorldSetting]) -> str:
    if not settings:
        return "（暂无世界观设定）"
    return "\n".join(f"- [{s.category}] {s.name}：{s.description}" for s in settings)


def _threads_block(threads: list[PlotThread]) -> str:
    active = [t for t in threads if t.status != ThreadStatus.RESOLVED]
    if not active:
        return "（暂无活跃伏笔）"
    return "\n".join(f"- [{t.priority.value}]{t.title}（{t.status.value}）：{t.description}" for t in active)


def build_messages(
    database: Session,
    novel: Novel,
    *,
    instruction: str,
    mode: str,
    target_words: int,
    context: AIContextOptions,
    current_content: str = "",
) -> list[dict[str, str]]:
    characters = list(database.scalars(select(Character).where(Character.novel_id == novel.id)).all())
    locations = list(database.scalars(select(Location).where(Location.novel_id == novel.id)).all())
    settings = list(database.scalars(select(WorldSetting).where(WorldSetting.novel_id == novel.id)).all())
    threads = list(database.scalars(select(PlotThread).where(PlotThread.novel_id == novel.id)).all())

    sections: list[str] = []
    if context.characters:
        sections.append("## 相关角色\n" + _characters_block(characters))
    if context.locations:
        sections.append("## 相关地点\n" + _locations_block(locations))
    if context.settings:
        sections.append("## 世界观设定参考\n" + _settings_block(settings))
    if context.threads:
        sections.append("## 活跃伏笔（请在合适时机自然收回，不要强行解释）\n" + _threads_block(threads))
    sections.append("## 最近剧情（前文摘要）\n" + _recent_chapter_summary(database, novel.id, context.recent_chapters))

    system = (
        f"你是专业的小说作家，擅长{novel.genre or '悬疑'}类型小说，文风细腻、克制。"
        f"当前你正在协助创作《{novel.title}》。{novel.description}\n\n"
        + "\n\n".join(sections)
    )

    task_map = {
        "continue": f"请根据以上设定与已有正文续写，保持文风一致、角色性格不崩坏，"
                    f"如有合适的时机可自然推进伏笔。续写约 {target_words} 字，直接输出正文，不要解释。",
        "polish": "请润色以下正文：提升语言的画面感与节奏，修正重复与啰嗦，但不要改变情节与人物。只输出润色后的正文。",
        "expand": f"请把以下正文扩写成一个更完整的场景，补充环境、动作与心理细节，约 {target_words} 字。只输出扩写后的正文。",
        "worldsetting": "请根据用户的想法，为这部小说创作一个世界观设定条目（如地点、势力、物品、规则等）。"
                        "内容要契合作品的题材与已有设定，避免与世界观设定参考中的条目重复或冲突。"
                        "输出格式必须严格如下，每行一个字段：\n"
                        "名称：<条目名称>\n"
                        "分类：<世界规则 | 势力分布 | 历史背景 | 法宝物品>\n"
                        "描述：<150-300 字的详细描述，包括来历、特征与对故事的影响>\n"
                        "只输出以上三行，不要任何解释或额外文字。",
        "setting_expand": "请扩写以下世界观设定条目的「详细说明」，使其更完整、更有画面感："
                          "补充该设定的来历、具体特征、与小说角色/地点/伏笔的联系。"
                          "保持文风与已有设定一致，不得改变原有内容的核心含义，不得杜撰与现有设定冲突的内容。"
                          "只输出扩写后的详细说明正文，不要输出名称、分类或任何解释。",
    }
    task = task_map.get(mode, task_map["continue"])
    user = (f"{instruction.strip()}\n\n" if instruction.strip() else "") + task
    if current_content.strip():
        user += f"\n\n--- 当前正文 ---\n{current_content.strip()}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
