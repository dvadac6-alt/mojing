"""F9 命名生成器 — 本地词库随机组合（零 AI、零延迟、离线可用）。

词库做成 Python 模块而非 JSON 数据文件：PyInstaller 直接打包模块，无需
data-files 配置。用户可在 DATA_DIR/wordlists/names.json 里按同名键补充词库
（与内置合并，不去重覆盖由生成端随机性吸收）。
"""
from __future__ import annotations

import json
import random
from pathlib import Path

_SURNAMES = [
    "沈", "顾", "陆", "江", "苏", "楚", "萧", "林", "叶", "秦",
    "谢", "宋", "裴", "温", "许", "洛", "燕", "霍", "祁", "闻",
    "容", "池", "商", "岑", "虞", "阮", "应", "越", "黎", "薄",
]
_PERSON_CHARS = [
    "砚", "辞", "聿", "行", "止", "观", "澜", "叙", "白", "执",
    "昭", "隐", "阙", "蘅", "渡", "野", "迟", "简", "故", "鹤",
    "微", "时", "声", "问", "折", "照", "沉", "浮", "知", "也",
    "青", "寒", "烬", "霖", "霁", "岫", "泾", "渭", "昼", "晏",
]
_PLACE_PREFIX = [
    "青", "苍", "玄", "幽", "落", "寒", "断", "孤", "百", "千",
    "云", "雾", "霜", "照", "闻", "无", "旧", "长", "白", "赤",
]
_PLACE_SUFFIX = [
    "城", "山", "谷", "镇", "渡", "关", "泽", "原", "林", "崖",
    "洲", "坊", "集", "窟", "台", "池", "道", "坊", "陵", "津",
]
_SECT_PREFIX = [
    "青云", "太虚", "紫霄", "万象", "归元", "听雨", "断岳", "洗剑", "拂晓", "摘星",
    "沧澜", "寒山", "无相", "天枢", "白鹭", "苍梧", "玄都", "太一", "流火", "枕流",
]
_SECT_DOMAIN = ["", "剑", "丹", "符", "阵", "音", "器", "药", "雪", "雷"]
_SECT_SUFFIX = ["宗", "门", "阁", "殿", "观", "山庄", "教", "府", "盟", "台"]
_SKILL_STYLE = [
    "太虚", "玄天", "九转", "大衍", "归藏", "惊鸿", "流云", "断水", "焚野", "听潮",
    "摘叶", "拂雪", "坐忘", "无妄", "周天", "垂露", "破军", "衔烛", "抱朴", "守一",
]
_SKILL_KIND = [
    "剑诀", "刀法", "身法", "心法", "掌法", "指法", "雷法", "印", "步", "枪法",
    "拳法", "咒", "术", "图", "引", "势",
]
_PILL_PREFIX = [
    "九转", "玄元", "碧髓", "龙血", "清心", "凝神", "渡厄", "洗髓", "金阙", "玉衡",
    "含光", "坠星", "春回", "寂照", "扶摇",
]
_PILL_SUFFIX = ["丹", "散", "膏", "露", "丸", "液"]

# kind → 生成模板（各槽位词表）
BANKS: dict[str, dict[str, list[str]]] = {
    "person": {"姓": _SURNAMES, "字": _PERSON_CHARS},
    "place": {"前缀": _PLACE_PREFIX, "后缀": _PLACE_SUFFIX},
    "sect": {"前缀": _SECT_PREFIX, "领域": _SECT_DOMAIN, "后缀": _SECT_SUFFIX},
    "skill": {"风格": _SKILL_STYLE, "法门": _SKILL_KIND},
    "pill": {"前缀": _PILL_PREFIX, "后缀": _PILL_SUFFIX},
}

KIND_LABELS = {
    "person": "人名", "place": "地名", "sect": "门派", "skill": "功法", "pill": "丹药",
}


def _user_overrides(data_dir: Path | None) -> dict[str, dict[str, list[str]]]:
    """DATA_DIR/wordlists/names.json 的用户补充词库（结构同 BANKS）。"""
    if not data_dir:
        return {}
    path = Path(data_dir) / "wordlists" / "names.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _merged_banks(data_dir: Path | None) -> dict[str, dict[str, list[str]]]:
    merged = {kind: {slot: list(words) for slot, words in slots.items()} for kind, slots in BANKS.items()}
    for kind, slots in _user_overrides(data_dir).items():
        if kind not in merged or not isinstance(slots, dict):
            continue
        for slot, words in slots.items():
            if isinstance(words, list) and merged[kind].get(slot) is not None:
                merged[kind][slot].extend(str(w) for w in words if str(w).strip())
    return merged


def _person(rng: random.Random, banks: dict[str, list[str]]) -> str:
    surname = rng.choice(banks["姓"])
    chars = rng.choice(banks["字"])
    if rng.random() < 0.55:  # 双字名
        second = rng.choice(banks["字"])
        while second == chars:
            second = rng.choice(banks["字"])
        chars += second
    return surname + chars


def generate(kind: str, count: int, data_dir: Path | None = None) -> list[str]:
    """生成 count 个不重复的名字；词库组合不足时允许少于请求数。"""
    if kind not in BANKS:
        raise KeyError(kind)
    banks = _merged_banks(data_dir)[kind]
    # 命名无需密码学随机，但用 secrets 播种避免可预测序列（Mimosa 弱随机告警）。
    import secrets
    rng = random.Random(secrets.randbits(64))
    out: list[str] = []
    seen: set[str] = set()
    for _ in range(count * 40):  # 随机尝试上限；词库组合空间大，通常一次即中
        if len(out) >= count:
            break
        if kind == "person":
            name = _person(rng, banks)
        else:
            slots = [banks[key] for key in banks]
            name = "".join(rng.choice(slot) for slot in slots)
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out
