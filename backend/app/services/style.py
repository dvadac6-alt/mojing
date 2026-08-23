"""F11 文风分析 — 从已写正文量化文风指标（纯函数），供注入 system prompt
（缓解"AI 味"）与概览页展示。"""
from __future__ import annotations

import re

_SENT_SPLIT = re.compile(r"[。！？!?…]+|\n+")
# 单句统计长度封顶：整块无标点的粘贴文本（或填充数据）不该把平均句长拉爆；
# 中位数/P90 天然稳健，封顶只影响均值。
_SENT_LEN_CAP = 300
_BLANK = re.compile(r"\s+")


def _non_blank(text: str) -> int:
    return len(_BLANK.sub("", text))


def analyze_style(texts: list[str]) -> dict:
    """texts = 各章正文。返回可直接 JSON 化的指标 dict（全空文本返回零值）。"""
    full = "\n".join(t for t in texts if t and t.strip())
    total = _non_blank(full)
    empty = {
        "total_chars": 0, "sentences": 0, "avg_sentence_len": 0.0,
        "median_sentence_len": 0, "p90_sentence_len": 0, "avg_paragraph_len": 0.0,
        "dialogue_ratio": 0.0, "comma_per_1000": 0.0, "exclam_per_1000": 0.0,
    }
    if total == 0:
        return empty

    sent_lens = sorted(
        min(_SENT_LEN_CAP, _non_blank(s)) for s in _SENT_SPLIT.split(full) if s.strip()
    ) or [0]
    n = len(sent_lens)
    paras = [p.strip() for p in full.split("\n") if p.strip()]
    para_lens = [_non_blank(p) for p in paras] or [0]
    dialogue_paras = sum(1 for p in paras if "“" in p or "”" in p or "「" in p or '"' in p)
    commas = full.count("，") + full.count(",")
    exclam = full.count("！") + full.count("？") + full.count("!") + full.count("?")
    return {
        "total_chars": total,
        "sentences": n,
        "avg_sentence_len": round(sum(sent_lens) / n, 1),
        "median_sentence_len": sent_lens[n // 2],
        "p90_sentence_len": sent_lens[min(n - 1, int(n * 0.9))],
        "avg_paragraph_len": round(sum(para_lens) / len(para_lens), 1),
        "dialogue_ratio": round(dialogue_paras / len(paras), 3),
        "comma_per_1000": round(commas / total * 1000, 1),
        "exclam_per_1000": round(exclam / total * 1000, 1),
    }


def style_note_from_profile(profile: dict) -> str:
    """把指标转成注入 system prompt 的一段文风约束。"""
    try:
        return (
            f"文风参考（作者已写正文的统计画像）：句均 {profile['avg_sentence_len']:.0f} 字"
            f"（九成句子 {profile['p90_sentence_len']:.0f} 字以内），"
            f"含对话段落占比 {profile['dialogue_ratio']:.0%}，"
            f"段均 {profile['avg_paragraph_len']:.0f} 字，"
            f"每千字感叹/问号 {profile['exclam_per_1000']:.1f} 个。"
            "请保持相近的句子长度分布与对话密度，避免整齐排比、避免过度解释，"
            "对话要有声口差异。"
        )
    except (KeyError, TypeError, ValueError):
        return ""
