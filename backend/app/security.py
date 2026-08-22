"""Local-first auth & secret handling.

Two concerns live here:

1. A bearer token that gates every API call. The token is generated once and
   persisted next to the database; the Electron main process reads it (via the
   health endpoint) and injects it into the renderer through the preload script.
   A browser hitting the loopback port without the token is rejected, so a
   malicious page on another origin cannot read or modify the user's data.

2. Symmetric encryption of stored AI API keys (Fernet). Keys are never sent back
   to the frontend in any form — they only travel upstream on create/update, and
   a connectivity check is performed server-side via a dedicated endpoint.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading

from .database import CONFIG_PATH

# ---------------------------------------------------------------------------
# token
# ---------------------------------------------------------------------------
_TOKEN_KEY = "auth_token"
_token_lock = threading.Lock()
_token_cache: str | None = None


def _load_auth_file() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_auth_file(data: dict) -> None:
    existing = _load_auth_file()
    existing.update(data)
    CONFIG_PATH.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")


def get_auth_token() -> str:
    """Return the shared bearer token, generating & persisting it on first use.
    The token is stable across restarts (stored in storage.json) so the desktop
    shell and any long-lived dev session keep working."""
    global _token_cache
    with _token_lock:
        if _token_cache:
            return _token_cache
        data = _load_auth_file()
        token = data.get(_TOKEN_KEY)
        if not token:
            token = secrets.token_urlsafe(32)
            _save_auth_file({_TOKEN_KEY: token})
        _token_cache = token
        return token


# ---------------------------------------------------------------------------
# key encryption
# ---------------------------------------------------------------------------
def _fernet_key() -> bytes:
    """Derive a stable Fernet key from a per-install secret file. The secret is
    random bytes generated once; losing it only means re-entering API keys (the
    data itself is unaffected), so we don't need a user-managed passphrase."""
    secret_path = CONFIG_PATH.parent / ".mojing_secret"
    if secret_path.exists():
        secret = secret_path.read_bytes()
    else:
        secret = os.urandom(32)
        try:
            secret_path.write_bytes(secret)
        except OSError:
            # If the config dir isn't writable, fall back to a process-stable key
            # derived from the token — still better than plaintext.
            secret = get_auth_token().encode()
    digest = hashlib.sha256(secret).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet():
    from cryptography.fernet import Fernet  # local import keeps import cost off startup
    return Fernet(_fernet_key())


def encrypt_key(plaintext: str) -> str:
    """Encrypt an API key for storage. Empty input stays empty (no key set)."""
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_key(stored: str) -> str:
    """Decrypt a stored API key. Legacy plaintext values fall through untouched
    so existing installs keep working until the key is re-saved; a *format-valid*
    Fernet token that fails to decrypt (wrong/lost machine secret) returns ""
    instead of the ciphertext — the latter would be sent to the provider as if
    it were the real key (leaking it) and produce confusing auth errors."""
    if not stored:
        return ""
    try:
        return _fernet().decrypt(stored.encode("ascii")).decode("utf-8")
    except Exception:
        # Fernet tokens always start with the 0x80 version byte → "gAAA" in
        # base64. Looks like a token but won't decrypt ⇒ secret mismatch.
        if stored.startswith("gAAA"):
            return ""
        # Not a Fernet token at all → legacy plaintext, still usable as-is.
        return stored


def mask_key(stored_or_plain: str) -> str:
    """One-way mask for any place that needs to *show* a key hint without
    revealing it. Only the last 4 chars are visible."""
    if not stored_or_plain:
        return ""
    tail = stored_or_plain[-4:] if len(stored_or_plain) >= 8 else ""
    return f"••••••••{tail}" if tail else "••••••••"
