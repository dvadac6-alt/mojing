"""Tests for the key encryption round-trip + legacy plaintext fallback (#1 core).

Covers the four correctness-sensitive behaviours of security.py:
encrypt → decrypt returns the original; empty stays empty; legacy plaintext
passes through; mask_key never reveals more than the last 4 chars.
"""
from app import security


def test_encrypt_decrypt_roundtrip():
    plain = "sk-test-key-1234567890abcdef"
    encrypted = security.encrypt_key(plain)
    assert encrypted != plain  # actually encrypted
    assert security.decrypt_key(encrypted) == plain


def test_empty_key_stays_empty():
    assert security.encrypt_key("") == ""
    assert security.decrypt_key("") == ""


def test_legacy_plaintext_falls_through():
    """A key saved before encryption existed should still be usable (returned
    as-is) and get re-encrypted on next save."""
    legacy = "sk-old-plaintext-key"
    assert security.decrypt_key(legacy) == legacy


def test_mask_key_hides_all_but_tail():
    assert security.mask_key("sk-1234567890abcdef") == "••••••••cdef"
    assert security.mask_key("short") == "••••••••"  # too short to show tail
    assert security.mask_key("") == ""


def test_token_is_stable_within_session():
    t1 = security.get_auth_token()
    t2 = security.get_auth_token()
    assert t1 == t2
    assert len(t1) > 20  # sufficiently long random token
