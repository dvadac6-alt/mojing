"""OpenAI 兼容 provider 的 SSE 容错 — 空 choices 收尾块不应炸掉整次生成。

回归背景：部分兼容端点在流结束时发送只带 usage、choices 为空列表的块，
旧代码 `chunk.get("choices", [{}])[0]` 因 key 存在而取到空列表，[0] 抛
IndexError("list index out of range")，正文已生成却在最后一块上报错。"""
import asyncio
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import app.services.ai.providers.openai_compat as oc  # noqa: E402


class _FakeStream:
    status_code = 200

    def __init__(self, lines: list[str]):
        self._lines = lines

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class _FakeClient:
    """顶替 httpx.AsyncClient：只实现 provider 用到的最小面。"""
    lines: list[str] = []

    def __init__(self, *args, **kwargs):
        pass

    def stream(self, method: str, url: str, **kwargs):
        return _FakeStream(_FakeClient.lines)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _collect(provider, messages):
    async def run():
        out = []
        async for piece in provider.stream(messages, temperature=0.7, max_tokens=64):
            out.append(piece)
        return out
    return asyncio.run(run())


def test_stream_survives_empty_choices_chunk(monkeypatch):
    lines = []
    for obj in (
        {"choices": [{"delta": {"content": "断仙渊"}}]},
        {"choices": [{"delta": {"content": "的风"}}]},
        # 事故块：choices 为空列表、只带 usage（key 存在 → get 默认值不生效）
        {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}},
        # delta 为 None 的块也应被容忍
        {"choices": [{"delta": None}]},
    ):
        lines.append("data: " + json.dumps(obj, ensure_ascii=False))
    lines.append("data: [DONE]")
    _FakeClient.lines = lines
    monkeypatch.setattr(oc.httpx, "AsyncClient", _FakeClient, raising=False)

    p = oc.OpenAICompatProvider(model="m", base_url="http://x/v1", api_key="k")
    assert _collect(p, [{"role": "user", "content": "hi"}]) == ["断仙渊", "的风"]
    # usage 收尾块被正常记录而不是炸掉
    assert p.last_usage == {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}
