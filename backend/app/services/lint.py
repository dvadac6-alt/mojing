"""F3 发布前自检 — 纯本地检查引擎（不依赖 AI、不发网络请求）。

敏感词不内置任何词库：完全由用户手动维护（自检面板添加或导入 txt），
词库文件存 DATA_DIR/wordlists/sensitive.txt，每行一词。
"""
from __future__ import annotations

import re
from pathlib import Path

# 疑似叠字重复（几乎总是手误；"谢谢/慢慢/刚刚"等合法叠词不在列）。
# 命中只提示不改动——"为了了解"这类正常句式也会含"了了"，交给作者人工确认。
_SUSPECT_DUPLICATES = (
    "的的", "了了", "在在", "是是", "地地", "得得", "很很", "不不", "和和",
    "就就", "也也", "都都", "到到", "又又", "再再", "最最", "更更",
)
# 连续 3 个及以上相同标点。省略号 U+2026 除外——中文省略号"……"本身就是两个字符。
_REPEATED_PUNCT = re.compile(r"([。！？，、；：,!?;:])\1{2,}")
# 中英标点直接相邻（如 ",。" "？."）——输入法切换手误的典型痕迹。
_MIXED_PUNCT = re.compile(r"[,.!?;:][，。？！；：、]|[，。？！；：、][,.!?;:]")

WORDLIST_DIR = "wordlists"
WORDLIST_FILE = "sensitive.txt"


def wordlist_path(data_dir: Path) -> Path:
    return Path(data_dir) / WORDLIST_DIR / WORDLIST_FILE


def load_sensitive_words(data_dir: Path) -> list[str]:
    path = wordlist_path(data_dir)
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    return [w.strip() for w in lines if w.strip()]


def save_sensitive_words(data_dir: Path, words: list[str]) -> int:
    """整表替换写入；返回落库词数。"""
    path = wordlist_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    cleaned = sorted({w.strip() for w in words if w.strip()})
    path.write_text("\n".join(cleaned) + ("\n" if cleaned else ""), encoding="utf-8")
    return len(cleaned)


def parse_wordlist_text(content: str) -> list[str]:
    """导入文本解析：每行一词，行内允许逗号/顿号分隔多个词。"""
    words: set[str] = set()
    for line in content.splitlines():
        for part in re.split(r"[,，、;；\t]+", line):
            part = part.strip()
            if part:
                words.add(part)
    return sorted(words)


def lint_text(text: str, sensitive_words: list[str]) -> list[dict]:
    """返回按 offset 升序的检查结果：{type, word, offset, message}。
    offset 为正文字符偏移（Python 码点；含 emoji 的正文与 JS UTF-16 偏移可能有
    瑕疵，前端跳转时会以词文就近重定位兜底）。"""
    issues: list[dict] = []
    if not text:
        return issues
    # 1) 敏感词（用户词库）
    for word in sorted({w for w in sensitive_words if w}, key=len, reverse=True):
        start = 0
        while True:
            idx = text.find(word, start)
            if idx < 0:
                break
            issues.append({"type": "sensitive", "word": word, "offset": idx,
                           "message": f"命中自定义敏感词「{word}」"})
            start = idx + len(word)
    # 2) 疑似叠字
    for pair in _SUSPECT_DUPLICATES:
        start = 0
        while True:
            idx = text.find(pair, start)
            if idx < 0:
                break
            issues.append({"type": "duplicate", "word": pair, "offset": idx,
                           "message": f"疑似叠字「{pair}」，请人工确认"})
            start = idx + len(pair)
    # 3) 连续标点
    for match in _REPEATED_PUNCT.finditer(text):
        issues.append({"type": "punct", "word": match.group(0), "offset": match.start(),
                       "message": f"连续标点「{match.group(0)}」"})
    # 4) 中英标点相邻
    for match in _MIXED_PUNCT.finditer(text):
        issues.append({"type": "punct", "word": match.group(0), "offset": match.start(),
                       "message": "中英标点相邻混用"})
    # 5) 引号不配对（全章一条）
    opens, closes = text.count("“"), text.count("”")
    if opens != closes:
        issues.append({"type": "punct", "word": "“”", "offset": 0,
                       "message": f"全章引号不配对（“ {opens} 处 / ” {closes} 处）"})
    issues.sort(key=lambda i: (i["offset"], i["type"]))
    return issues
