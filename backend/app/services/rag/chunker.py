"""小说定制的切块器（RAG设计方案.md §四）。

不用通用滑窗：正文按空行分段、相邻段贪心聚合成 500-800 字块、块间重叠一段；
超长单段按句号硬切。资料库 TXT 识别行首标题作切分锚点，无结构则回退正文策略。
"""
from __future__ import annotations

MIN_CHARS, MAX_CHARS = 500, 800


def _split_paragraphs(text: str) -> list[str]:
    paras = [p.strip() for p in text.split("\n") if p.strip()]
    return [p for p in paras if p]


def _hard_split_long(paragraph: str) -> list[str]:
    """A single paragraph longer than MAX_CHARS gets split at sentence marks."""
    if len(paragraph) <= MAX_CHARS:
        return [paragraph]
    out: list[str] = []
    buf = ""
    for sentence in _split_sentences(paragraph):
        if len(buf) + len(sentence) > MAX_CHARS and buf:
            out.append(buf)
            buf = sentence
        else:
            buf += sentence
    if buf:
        out.append(buf)
    return out


def _split_sentences(text: str) -> list[str]:
    """Split keeping the trailing punctuation attached to each sentence.
    Slice-based (not buf += ch): 2MB of unpunctuated input would otherwise
    degrade to O(n²) string concatenation."""
    sentences: list[str] = []
    start = 0
    for i, ch in enumerate(text):
        if ch in "。！？!?":
            sentences.append(text[start:i + 1])
            start = i + 1
    if start < len(text):
        sentences.append(text[start:])
    return sentences


def chunk_chapter(title: str, content: str) -> list[tuple[int, str]]:
    """Chunk chapter body → [(chunk_index, text)]. Adjacent chunks share the
    previous chunk's last paragraph so key sentences straddling a boundary
    stay retrievable."""
    paragraphs: list[str] = []
    for p in _split_paragraphs(content):
        paragraphs.extend(_hard_split_long(p))
    if not paragraphs:
        return []

    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for para in paragraphs:
        if size + len(para) > MAX_CHARS and buf and size >= MIN_CHARS:
            chunks.append("\n".join(buf))
            # 重叠一段：下一块以本块最后一段开头。
            last = buf[-1]
            buf, size = ([last] if len(last) <= MAX_CHARS else []), min(len(last), MAX_CHARS)
        buf.append(para)
        size += len(para)
    if buf:
        tail = "\n".join(buf)
        if chunks and len(tail) < MIN_CHARS // 2:
            chunks[-1] += "\n" + tail   # 太短的尾巴并入前块
        else:
            chunks.append(tail)

    return [(i, c) for i, c in enumerate(chunks) if c.strip()]


_HEADING_MARKS = ("第", "一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、", "#")


def _looks_like_heading(line: str) -> bool:
    l = line.strip()
    if not l or len(l) > 30:
        return False
    if l.startswith("#"):
        return True
    for mark in _HEADING_MARKS:
        if l.startswith(mark) and any(k in l[:8] for k in ("章", "节", "篇", "、", "回", "部分")):
            return True
    return False


def chunk_library(doc_name: str, content: str) -> list[tuple[int, str]]:
    """Chunk reference material: split at detected headings, aggregate the
    section's paragraphs to ~MIN_CHARS..MAX_CHARS per chunk."""
    sections: list[tuple[str, list[str]]] = [("", [])]
    for line in content.split("\n"):
        if _looks_like_heading(line):
            sections.append((line.strip().lstrip("#").strip(), []))
        else:
            t = line.strip()
            if t:
                sections[-1][1].append(t)

    chunks: list[str] = []
    for heading, paras in sections:
        if not paras:
            continue
        body = "\n".join(_hard_split_long("\n".join(paras)) if len("\n".join(paras)) > MAX_CHARS else ["\n".join(paras)])
        prefix = f"{doc_name} · {heading}\n" if heading else f"{doc_name}\n"
        # 标题拼进块首：检索命中时能看出处，向量里也带上语义锚点。
        pieces = body.split("\n")
        buf, size = [], 0
        for piece in pieces:
            if size + len(piece) > MAX_CHARS and buf and size >= MIN_CHARS:
                chunks.append(prefix + "\n".join(buf))
                buf, size = [], 0
            buf.append(piece)
            size += len(piece)
        if buf:
            text = prefix + "\n".join(buf)
            if len("\n".join(buf)) < MIN_CHARS // 2 and chunks:
                chunks[-1] += "\n" + text
            else:
                chunks.append(text)

    return [(i, c) for i, c in enumerate(chunks) if c.strip()]
