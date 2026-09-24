"""Process configuration from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SESSION_COOKIE = "seraframe_session"
CSRF_COOKIE = "seraframe_csrf"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
CSRF_TTL_SECONDS = 12 * 60 * 60
LOCKOUT_ATTEMPTS = 5
LOCKOUT_SECONDS = 15 * 60
THUMB_EDGE_PX = 256
MAX_IMAGE_BYTES = 64 * 1024 * 1024
STILL_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".gif")

_TRUE = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    admin_password: str
    secret_key: str
    data_dir: Path
    port: int
    trust_proxy: bool

    @property
    def secure_cookies(self) -> bool:
        return self.trust_proxy

    @property
    def db_path(self) -> Path:
        return self.data_dir / "seraframe.sqlite"

    @property
    def thumb_dir(self) -> Path:
        return self.data_dir / "thumbs"


def load_settings() -> Settings:
    password = os.environ.get("SERAFRAME_ADMIN_PASSWORD", "")
    secret = os.environ.get("SERAFRAME_SECRET_KEY", "")
    data_dir = Path(os.environ.get("SERAFRAME_DATA_DIR", "/data"))
    port_raw = os.environ.get("SERAFRAME_PORT", "8080")
    trust_raw = os.environ.get("SERAFRAME_TRUST_PROXY", "0")

    if not password:
        raise RuntimeError("SERAFRAME_ADMIN_PASSWORD is required")
    if len(secret.encode("utf-8")) < 32:
        raise RuntimeError("SERAFRAME_SECRET_KEY must be at least 32 bytes")
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise RuntimeError("SERAFRAME_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError("SERAFRAME_PORT must be between 1 and 65535")

    return Settings(
        admin_password=password,
        secret_key=secret,
        data_dir=data_dir,
        port=port,
        trust_proxy=trust_raw.strip().lower() in _TRUE,
    )
