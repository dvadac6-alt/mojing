"""OpenAI 兼容 provider 的 SSE 容错 — 空 choices 收尾块不应炸掉整次生成。

回归背景：部分兼容端点在流结束时发送只带 usage、choices 为空列表的块，
旧代码 `chunk.get("choices", [{}])[0]` 因 key 存在而取到空列表，[0] 抛
IndexError("list index out of range")，正文已生成却在最后一块上报错。"""
import asyncio
import json
import sys
from pathlib import Path

import pytest

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


def _collect(provider, messages, max_tokens=64):
    async def run():
        out = []
        async for piece in provider.stream(messages, temperature=0.7, max_tokens=max_tokens):
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
    # usage 收尾块被正常记录而不是炸掉（无缓存字段的服务商 → cached_tokens 0）
    assert p.last_usage == {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12, "cached_tokens": 0}


def test_stream_records_cached_tokens(monkeypatch):
    """DeepSeek 风格 usage（prompt_cache_hit_tokens）与 OpenAI 风格
    （prompt_tokens_details.cached_tokens）都应归一为 cached_tokens。"""
    def run_case(usage_obj, expected_cached):
        lines = [
            "data: " + json.dumps({"choices": [{"delta": {"content": "x"}}]}, ensure_ascii=False),
            "data: " + json.dumps({"choices": [], "usage": usage_obj}, ensure_ascii=False),
            "data: [DONE]",
        ]
        _FakeClient.lines = lines
        monkeypatch.setattr(oc.httpx, "AsyncClient", _FakeClient, raising=False)
        p = oc.OpenAICompatProvider(model="m", base_url="http://x/v1", api_key="k")
        _collect(p, [{"role": "user", "content": "hi"}])
        assert p.last_usage["cached_tokens"] == expected_cached

    run_case({"prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105,
              "prompt_cache_hit_tokens": 60, "prompt_cache_miss_tokens": 40}, 60)
    run_case({"prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105,
              "prompt_tokens_details": {"cached_tokens": 25}}, 25)
    run_case({"prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105}, 0)


class _ErrStream:
    """顶替 4xx 响应：provider 在状态码 >= 400 时会 aread() 错误体。"""
    status_code = 400

    def __init__(self, body: str):
        self._body = body

    async def aread(self):
        return self._body.encode("utf-8")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def test_stream_retries_at_provider_max_tokens_cap(monkeypatch):
    """超限拒绝（DeepSeek 式 [1, N] 范围错误）应按错误体里的上限自动降档重试一次，
    而不是让整次生成失败 —— 默认 max_tokens=50000 正是靠这个兜底才能安全下发。"""
    calls: list[int] = []

    class _CapClient:
        def __init__(self, *args, **kwargs):
            pass

        def stream(self, method: str, url: str, **kwargs):
            requested = kwargs["json"]["max_tokens"]
            calls.append(requested)
            if requested > 8192:
                return _ErrStream('{"error":{"message":"Invalid max_tokens value, '
                                  '"the valid range of max_tokens is [1, 8192]"}}')
            lines = ["data: " + json.dumps({"choices": [{"delta": {"content": "续写"}}]}, ensure_ascii=False),
                     "data: [DONE]"]
            return _FakeStream(lines)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(oc.httpx, "AsyncClient", _CapClient, raising=False)
    p = oc.OpenAICompatProvider(model="m", base_url="http://x/v1", api_key="k")
    assert _collect(p, [{"role": "user", "content": "hi"}], max_tokens=50000) == ["续写"]
    assert calls == [50000, 8192]


def test_stream_reraises_unrelated_400(monkeypatch):
    """与 max_tokens 无关的 4xx 不重试、原样抛出。"""
    class _AlwaysErr:
        def __init__(self, *args, **kwargs):
            pass

        def stream(self, method: str, url: str, **kwargs):
            return _ErrStream('{"error":{"message":"Authentication Fails"}}')

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(oc.httpx, "AsyncClient", _AlwaysErr, raising=False)
    p = oc.OpenAICompatProvider(model="m", base_url="http://x/v1", api_key="k")
    with pytest.raises(RuntimeError, match="Authentication Fails"):
        _collect(p, [{"role": "user", "content": "hi"}], max_tokens=50000)
