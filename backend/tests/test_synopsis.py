"""AI 帮写作品简介（/ai/synopsis）— 新建作品弹窗的轻量生成端点。

无 novel_id（作品可能尚未创建）、SSE 格式与 /ai/generate 一致（前端
runAIStream 直接复用）。mock 离线模型走同一条通路，因此无需真实 Key。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


def test_synopsis_stream_and_empty_body():
    client, headers = _client()

    # 书名/类型/提示词齐全 → SSE 流（mock 模型同样走 dispatcher 通路）。
    r = client.post("/api/ai/synopsis", headers=headers,
                    json={"title": "雾隐长街", "genre": "悬疑", "hints": "双时间线，结局反转"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert "data:" in r.text
    assert "[DONE]" in r.text

    # 全空请求体也合法（schema 字段全有默认值）：书名回退为「未命名作品」。
    r2 = client.post("/api/ai/synopsis", headers=headers, json={})
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("text/event-stream")
