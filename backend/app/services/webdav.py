"""F12 WebDAV 备份上传 — httpx 直连（零新依赖），PUT/PROPFIND/DELETE。

设计要点：
- 密码经 security.encrypt_key 加密落库，本模块只在发起请求前解密；
- 轮换：文件名含时间戳（mojing-YYYYmmdd-HHMMSS.db），字典序即时间序，
  超出 keep 份时删最旧；
- transport 参数仅测试注入用（httpx.MockTransport），生产路径为 None。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# PROPFIND 响应里的 <D:href>（或 <d:href>/<href>，命名空间前缀不一）。
_HREF = re.compile(r"<(?:[A-Za-z0-9_]+:)?href[^>]*>([^<]+)</(?:[A-Za-z0-9_]+:)?href>", re.IGNORECASE)
_BACKUP_NAME = re.compile(r"^mojing-\d{8}-\d{4,6}\.(db|zip)$")


def _client(cfg, transport=None) -> httpx.Client:
    from ..security import decrypt_key
    password = decrypt_key(cfg.password)
    return httpx.Client(
        base_url=cfg.url.rstrip("/"),
        auth=(cfg.username, password) if (cfg.username or password) else None,
        timeout=httpx.Timeout(60.0, connect=10.0),
        transport=transport,
    )


def probe(cfg, transport=None) -> tuple[bool, str]:
    """连接测试：对根目录 PROPFIND Depth 0。"""
    try:
        with _client(cfg, transport) as client:
            resp = client.request("PROPFIND", "/", headers={"Depth": "0"})
    except httpx.HTTPError as exc:
        return False, f"连接失败：{exc}"
    if resp.status_code in (200, 207):
        return True, "连接成功"
    if resp.status_code == 401:
        return False, "认证失败：检查用户名与应用密码（坚果云等需用应用专用密码）"
    if resp.status_code == 404:
        return False, "目录不存在：检查 URL 是否指向具体目录"
    return False, f"服务返回 {resp.status_code}：{resp.text[:120]}"


def _list_remote_backups(client: httpx.Client) -> list[str]:
    """列出远端目录里的 mojing-*.db / *.zip 备份名（升序 = 旧→新）。"""
    resp = client.request("PROPFIND", "/", headers={"Depth": "1"})
    if resp.status_code not in (200, 207):
        return []
    names = []
    for href in _HREF.findall(resp.text):
        name = href.rstrip("/").rsplit("/", 1)[-1]
        if _BACKUP_NAME.match(name):
            names.append(name)
    return sorted(set(names))


def upload_backup(cfg, local_path: str | Path, remote_name: str, transport=None) -> tuple[bool, str]:
    """上传一个备份文件并做远端轮换。上传成功即视为成功；轮换失败只记日志。"""
    data = Path(local_path).read_bytes()
    with _client(cfg, transport) as client:
        resp = client.put(f"/{remote_name}", content=data)
        if resp.status_code >= 400:
            return False, f"上传失败：{resp.status_code} {resp.text[:120]}"
        try:
            listed = _list_remote_backups(client)
            stale = listed[: max(0, len(listed) - cfg.keep)]
            for name in stale:
                client.delete(f"/{name}")
        except Exception:
            logger.warning("webdav rotation failed (upload unaffected)", exc_info=True)
    return True, remote_name
