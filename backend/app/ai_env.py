"""AI provider config from a root `.env` file (#env-ai).

The API key and provider settings live in an environment file instead of the
UI form; on every backend startup this module loads them and imports them into
the AIConfig table through the SAME encryption path the UI uses (Fernet
encrypt_key → stored at rest → decrypt_key on call). That way the "env file
saves the key, calls decrypt it" flow the app already relies on stays intact,
and the settings page still shows the imported config (editable).

Env keys (root .env):
  MOJING_AI_PROVIDER   provider id, e.g. openai / deepseek / custom
  MOJING_AI_BASE_URL   API endpoint, e.g. https://api.openai.com/v1
  MOJING_AI_MODEL      model id, e.g. gpt-4o-mini
  MOJING_AI_API_KEY    the secret key (encrypted before it is stored)
  MOJING_AI_NAME       optional display name (defaults to "provider (env)")
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AIConfig
from .security import encrypt_key

ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


def import_env_config(database: Session) -> bool:
    """Read .env and upsert the AI config (key encrypted at rest).
    Returns True when the env file actually supplied a key that was applied."""
    if not ENV_FILE.exists():
        return False
    load_dotenv(ENV_FILE)
    api_key = (os.getenv("MOJING_AI_API_KEY") or "").strip()
    if not api_key:
        return False
    provider = (os.getenv("MOJING_AI_PROVIDER") or "openai").strip() or "openai"
    base_url = (os.getenv("MOJING_AI_BASE_URL") or "").strip()
    model = (os.getenv("MOJING_AI_MODEL") or "").strip()
    name = (os.getenv("MOJING_AI_NAME") or f"{provider} (env)").strip()

    cfg = database.scalar(
        select(AIConfig).where(AIConfig.provider == provider).order_by(AIConfig.id.desc()).limit(1)
    )
    if cfg:
        if base_url:
            cfg.base_url = base_url
        if model:
            cfg.model = model
        cfg.name = name
        cfg.api_key = encrypt_key(api_key)  # key changes are always re-encrypted
        cfg.is_active = True
    else:
        cfg = AIConfig(
            provider=provider, name=name, model=model or "mock",
            base_url=base_url, api_key=encrypt_key(api_key),
            temperature=0.85, max_tokens=1200, is_active=True,
        )
        database.add(cfg)
    database.commit()
    return True
