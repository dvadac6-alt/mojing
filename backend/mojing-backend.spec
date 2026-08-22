# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Mojing local backend.

Produces a single-file executable (`mojing-backend.exe` on Windows) that
embeds the FastAPI app + all Python deps, so the install package no longer
depends on the end user having Python installed.

Build:  pyinstaller backend/mojing-backend.spec           (run from new/)
Output: backend/dist/mojing-backend(.exe)
"""
import sys
from pathlib import Path

block_cipher = None

# The spec is in backend/, sources are under backend/app + backend/main.py.
here = Path(SPECPATH).resolve()  # noqa: F821 (SPECPATH is injected by PyInstaller)

a = Analysis(
    [str(here / "main.py")],
    pathex=[str(here)],
    binaries=[],
    datas=[],
    hiddenimports=[
        # httpx is imported lazily/optionally; force-include so the OpenAI
        # provider and the connectivity test always work in the frozen build.
        "httpx",
        "h11",
        "anyio",
        "cryptography",
        # app/ai_env.py imports dotenv at module scope — without this the
        # frozen exe silently loses .env AI-config import/export.
        "dotenv",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="mojing-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # windowless: the desktop shell owns all UI; hide the console so a black
    # cmd window doesn't flash on every app launch.
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
