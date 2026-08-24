from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Chapter,
    ChapterStatus,
    Character,
    Location,
    Novel,
    NovelStatus,
    PlotThread,
    ThreadPriority,
    ThreadStatus,
    WorldSetting,
)
from .utils import count_words


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


DEMO_CHARACTERS = [
    {"name": "沈砚", "aliases": "少阁主", "role": "主角 · 少阁主", "color": "#334f68",
     "description": "三年前灭门惨案的幸存者，回到临川追查真相。",
     "personality": "克制 · 敏锐 · 执拗 · 外冷内热",
     "background": "沈家少主，少年时随父亲打理家族生意，三年前一夜之间失去所有亲人。",
     "appearance": "常年着青灰长衫，左手腕有一道旧伤疤，雨天会隐隐作痛。",
     "abilities": "擅长追踪、机关与账目分析。"},
    {"name": "苏晚照", "aliases": "照影", "role": "女主角 · 情报商", "color": "#9d6b62",
     "description": "游走于各方势力之间的情报商，真实身份成谜。",
     "personality": "圆滑 · 警惕 · 心思缜密",
     "background": "对外自称照影楼的人，对“照影”这个名字却异常排斥。",
     "appearance": "总以素色帷帽遮面，指尖常带墨痕。",
     "abilities": "消息网络、易容与暗记。"},
    {"name": "陆停云", "aliases": "陆先生", "role": "重要配角 · 书院教习", "color": "#6c7250",
     "description": "临川书院教习，温和表象之下藏着不为人知的旧事。",
     "personality": "温润 · 含蓄 · 处事周全",
     "background": "与沈家旧主有故交，灭门之夜恰好在城外。",
     "abilities": "古籍考据、雨契礼法。"},
    {"name": "谢无归", "aliases": "北地刀", "role": "对手 · 北地刀客", "color": "#6d5360",
     "description": "来自北境的刀客，与沈家旧案有隐秘联系。",
     "personality": "寡言 · 直接 · 重诺",
     "background": "受某人之命南下调查，随身佩刀从不离身。",
     "appearance": "高大，眉骨有一道斜疤。",
     "abilities": "刀法、追踪与近身搏斗。"},
]


DEMO_LOCATIONS = [
    {"name": "临川城", "type": "城市", "description": "江南旧城，常年多雨，以书院、渡口与纵横水巷闻名。", "parent": None},
    {"name": "长街", "type": "街区", "description": "贯穿临川南北的旧街，青石板被车轮磨得发亮。", "parent": "临川城"},
    {"name": "归雁客栈", "type": "建筑", "description": "沈砚落脚之处，掌柜做事只用右手。", "parent": "长街"},
    {"name": "城北", "type": "区域", "description": "低洼多雾，旧宅与废弃商铺在雾中只剩模糊轮廓。", "parent": "临川城"},
    {"name": "沈家旧宅", "type": "建筑", "description": "三年前被封存的旧宅，城北线索最终指向这里。", "parent": "城北"},
    {"name": "无名渡口", "type": "渡口", "description": "临川城外的渡口，守渡人守护着通往密道的钥匙。", "parent": "临川城"},
    {"name": "北境", "type": "地域", "description": "苦寒之地，谢无归的故乡。", "parent": None},
    {"name": "雪回关", "type": "关隘", "description": "北境通往中原的第一道关隘。", "parent": "北境"},
]


DEMO_SETTINGS = [
    {"name": "雨契", "category": "世界规则", "description": "临川旧族以雨为誓，契约成立时会在信物上留下水纹。"},
    {"name": "临川书院", "category": "势力分布", "description": "表面是书院，实际上保管着历代雨契的副本。"},
    {"name": "沈家旧案", "category": "历史背景", "description": "三年前沈家在一夜间覆灭，官方记载与证词彼此矛盾。"},
    {"name": "裂纹玉佩", "category": "法宝物品", "description": "沈家传承信物，裂纹会随城中钟声出现变化。"},
    {"name": "无灯马车", "category": "世界规则", "description": "雨夜不挂灯的马车只为履行未完成的旧约而来。"},
    {"name": "照影楼", "category": "势力分布", "description": "经营消息与秘密的地下组织，真伪难辨。"},
]


def seed_demo_workspace(database: Session) -> None:
    # 演示数据只允许进入全新空库。此前实现是"挑最近更新的作品、没章节就灌入"，
    # 导致用户新建空作品后重启后端时，整套演示内容被注入到用户作品里。
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

    chapters = list(database.scalars(
        select(Chapter).where(Chapter.novel_id == novel.id).order_by(Chapter.order)).all())
    if not chapters:
        for index, (title, content) in enumerate(DEMO_CHAPTERS, start=1):
            chapter = Chapter(
                novel_id=novel.id, title=title, content=content, order=index,
                word_count=count_words(content),
                status=ChapterStatus.WRITING if index == 4 else ChapterStatus.COMPLETED,
            )
            database.add(chapter)
            chapters.append(chapter)
        database.flush()

    by_title = {c.title: c for c in chapters}
    by_order = {c.order: c for c in chapters}

    # ---- characters (idempotent) ----
    if not database.scalar(select(Character.id).where(Character.novel_id == novel.id).limit(1)):
        for data in DEMO_CHARACTERS:
            appearance = by_title.get("雨夜来客")
            database.add(Character(
                novel_id=novel.id, **data, relationships={},
                first_appearance_chapter_id=appearance.id if appearance else None,
            ))
        database.flush()

    # ---- locations (idempotent, build hierarchy) ----
    if not database.scalar(select(Location.id).where(Location.novel_id == novel.id).limit(1)):
        created: dict[str, Location] = {}
        for data in DEMO_LOCATIONS:
            parent = created.get(data["parent"]) if data["parent"] else None
            location = Location(
                novel_id=novel.id, name=data["name"], type=data["type"],
                description=data["description"], parent_location_id=parent.id if parent else None,
            )
            database.add(location)
            database.flush()
            created[data["name"]] = location

    # ---- world settings (idempotent) ----
    if not database.scalar(select(WorldSetting.id).where(WorldSetting.novel_id == novel.id).limit(1)):
        for data in DEMO_SETTINGS:
            database.add(WorldSetting(novel_id=novel.id, **data, related_settings={}, chapter_references={}))

    # ---- plot threads (idempotent) ----
    if not database.scalar(select(PlotThread.id).where(PlotThread.novel_id == novel.id).limit(1)):
        planted = by_order.get(1)
        developing_ch = by_order.get(4)
        resolved_ch = by_order.get(3)
        thread_defs = [
            ("裂纹玉佩", "玉佩在雨夜突然出现裂纹，内部似乎封存着某种信息。", ThreadStatus.PLANTED, ThreadPriority.MAJOR, planted),
            ("客栈掌柜的左手", "掌柜始终用右手做事，左手藏在袖中。", ThreadStatus.PLANTED, ThreadPriority.DETAIL, planted),
            ("无名渡口的旧碑", "碑文与沈家族谱中的缺页内容高度相似。", ThreadStatus.HINTED, ThreadPriority.MINOR, by_order.get(3)),
            ("三年前的雨夜", "多名角色对当夜的叙述存在明显冲突。", ThreadStatus.DEVELOPING, ThreadPriority.MAJOR, developing_ch),
            ("苏晚照的真名", "她对“照影”这个名字表现出异常排斥。", ThreadStatus.DEVELOPING, ThreadPriority.MINOR, by_order.get(2)),
            ("渡口老人身份", "确认他曾是沈家账房，受命守护渡口密道。", ThreadStatus.RESOLVED, ThreadPriority.MINOR, by_order.get(3)),
        ]
        for title, desc, status, priority, ch in thread_defs:
            database.add(PlotThread(
                novel_id=novel.id, title=title, description=desc, status=status, priority=priority,
                planted_chapter_id=ch.id if ch else None,
                resolved_chapter_id=(resolved_ch.id if status == ThreadStatus.RESOLVED and resolved_ch else None),
                related_characters=[], related_locations=[], related_threads=[],
                notes="",
            ))

    database.commit()
