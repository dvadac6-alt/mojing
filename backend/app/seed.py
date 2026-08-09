from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Chapter, ChapterStatus, Novel, NovelStatus


DEMO_CHAPTERS = [
    ("雨夜来客", "雨落临川，沈砚在归雁客栈收到一封没有署名的信。"),
    ("旧城的钟声", "钟楼在停摆三年后重新响起，苏晚照带来沈家旧案的第一条线索。"),
    ("无名渡口", "渡口老人交出密道钥匙，并警告沈砚不要相信雨夜来客。"),
    (
        "玉佩上的裂痕",
        "\n\n".join(
            [
                "雨落到第四更时，临川城最后一盏灯也灭了。",
                "沈砚站在檐下，掌心那枚旧玉佩被雨气浸得冰凉。裂纹从云纹中央一路延伸，像一条刚刚苏醒的河。他记得三年前离开故乡时，它还完好无损。",
                "街角传来木轮碾过青石的声音。",
                "一辆没有灯笼的马车停在客栈门前。车帘掀起一线，先伸出来的是一只苍白的手，指间夹着半封被火烧过的信。",
                "“沈公子，”车里的人说，“你等的答案，在城北。”",
                "沈砚没有动。他看见那封信残存的落款，忽然想起渡口老人临死前说过的话——不要相信在雨夜找到你的人。",
            ]
        ),
    ),
    ("长街尽头", "长街尽头的旧宅门锁被人换过，雨水里留下了新的车辙。"),
    ("未寄出的信", ""),
]


def count_words(content: str) -> int:
    return len("".join(content.split()))


def seed_demo_workspace(database: Session) -> None:
    if database.scalar(select(Novel.id).limit(1)):
        return

    novel = Novel(
        title="雾隐长街",
        description="一场持续三年的雨，和一桩无人敢提起的旧案。",
        author="",
        genre="悬疑",
        target_words=200_000,
        status=NovelStatus.WRITING,
    )
    database.add(novel)
    database.flush()

    for index, (title, content) in enumerate(DEMO_CHAPTERS, start=1):
        database.add(
            Chapter(
                novel_id=novel.id,
                title=title,
                content=content,
                order=index,
                word_count=count_words(content),
                status=ChapterStatus.WRITING if index == 4 else ChapterStatus.COMPLETED,
            )
        )
    database.commit()

