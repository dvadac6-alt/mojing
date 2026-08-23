"""F12 WebDAV 备份 — 上传/轮换/探活（MockTransport 模拟服务器）+ 配置端点。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402

from app.services.webdav import probe, upload_backup  # noqa: E402


class _FakeCfg:
    def __init__(self, keep=2):
        self.url = "https://dav.example.com/mojing/"
        self.username = "user"
        from app.security import encrypt_key
        self.password = encrypt_key("secret")
        self.keep = keep


def _mock_server(state: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(f"{request.method} {request.url.path}")
        if request.method == "PROPFIND":
            hrefs = "".join(
                f"<D:href>/mojing/{name}</D:href>" for name in state["files"]
            )
            return httpx.Response(207, text=f'<?xml version="1.0"?><D:multistatus>{hrefs}</D:multistatus>')
        if request.method == "PUT":
            name = request.url.path.rsplit("/", 1)[-1]
            state["files"] = sorted(set(state["files"] + [name]))
            return httpx.Response(201)
        if request.method == "DELETE":
            name = request.url.path.rsplit("/", 1)[-1]
            state["files"] = [f for f in state["files"] if f != name]
            return httpx.Response(204)
        return httpx.Response(405)
    return httpx.MockTransport(handler)


def test_probe_success_and_auth_failure():
    state = {"requests": [], "files": []}
    ok, detail = probe(_FakeCfg(), transport=_mock_server(state))
    assert ok and "成功" in detail
    # 401 → 认证失败提示
    def deny(request):
        return httpx.Response(401, text="denied")
    ok, detail = probe(_FakeCfg(), transport=httpx.MockTransport(deny))
    assert not ok and "认证失败" in detail


def test_upload_and_rotation_keeps_newest(tmp_path):
    local = tmp_path / "mojing-20260101-0900.db"
    local.write_bytes(b"backup-bytes")
    state = {"requests": [], "files": [
        "mojing-20250101-0900.db", "mojing-20250201-0900.db",
    ]}
    cfg = _FakeCfg(keep=2)
    ok, name = upload_backup(cfg, local, local.name, transport=_mock_server(state))
    assert ok and name == local.name
    # 上传后 3 份、keep=2 → 最旧一份被删除。
    assert state["files"] == ["mojing-20250201-0900.db", "mojing-20260101-0900.db"]
    assert "DELETE /mojing/mojing-20250101-0900.db" in " ".join(state["requests"])


def test_webdav_config_endpoints():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}

    # 默认未配置。
    assert client.get("/api/webdav/config", headers=headers).json()["configured"] is False

    # 保存（密码加密落库，响应只回 has_password）。
    r = client.put("/api/webdav/config", headers=headers,
                   json={"url": "https://dav.example.com/mojing/", "username": "user",
                         "password": "secret", "keep": 3})
    body = r.json()
    assert body == {"configured": True, "url": "https://dav.example.com/mojing",
                    "username": "user", "has_password": True, "keep": 3}

    # 只改 keep 不动密码（password 省略 = 保留）。
    r = client.put("/api/webdav/config", headers=headers, json={"keep": 5})
    assert r.json()["keep"] == 5 and r.json()["has_password"] is True

    # 测试端点对不可达地址返回 ok=False 与原因（真实 DNS 失败，不依赖网络内容）。
    probe_result = client.post("/api/webdav/config/test", headers=headers).json()
    assert probe_result["ok"] is False and probe_result["detail"]
