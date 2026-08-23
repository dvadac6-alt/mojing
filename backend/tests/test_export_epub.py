"""F7 EPUB 导出 — 章节成书、目录/Spine 正确、正文 HTML 转义。"""
import io
import sys
import zipfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def test_export_epub():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    novel = client.post("/api/novels", headers=headers,
                        json={"title": "EPUB测试", "author": "墨境"}).json()
    for i in (1, 2):
        client.post(f"/api/novels/{novel['id']}/chapters", headers=headers,
                    json={"title": f"第{i}章 <试>", "content": f"第{i}章正文，含特殊字符 & <b>标签</b>。\n\n第二段。"})

    r = client.post(f"/api/novels/{novel['id']}/export", headers=headers, json={"format": "epub"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/epub+zip"

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    # 书包结构：mimetype + container + nav + 两章 xhtml
    assert "mimetype" in names
    assert any("nav" in n for n in names)
    chapter_files = sorted(n for n in names if "chap000" in n)
    assert len(chapter_files) == 2
    html = zf.read(chapter_files[0]).decode("utf-8")
    assert "第 1 章 · 第1章 &lt;试&gt;" in html      # 标题转义
    assert "&amp; &lt;b&gt;标签&lt;/b&gt;" in html   # 正文转义
    assert "<p>第二段。</p>" in html                 # 空行分段

    # 旧格式不受影响。
    assert client.post(f"/api/novels/{novel['id']}/export", headers=headers,
                       json={"format": "txt"}).status_code == 200
