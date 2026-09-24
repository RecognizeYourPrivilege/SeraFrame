"""Process configuration from the environment."""

from __future__ import annotations

import logging
import os
import secrets
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
SECRET_KEY_FILENAME = "secret_key"
MIN_SECRET_BYTES = 32

_TRUE = {"1", "true", "yes", "on"}
logger = logging.getLogger(__name__)


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

    @property
    def secret_key_path(self) -> Path:
        return self.data_dir / SECRET_KEY_FILENAME


def load_settings() -> Settings:
    password = os.environ.get("SERAFRAME_ADMIN_PASSWORD")
    data_dir = Path(os.environ.get("SERAFRAME_DATA_DIR", "/data"))
    port_raw = os.environ.get("SERAFRAME_PORT", "18880")
    trust_raw = os.environ.get("SERAFRAME_TRUST_PROXY", "0")

    if password is None or password.strip() == "":
        raise RuntimeError("SERAFRAME_ADMIN_PASSWORD is required")
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise RuntimeError("SERAFRAME_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError("SERAFRAME_PORT must be between 1 and 65535")

    secret = resolve_secret_key(data_dir)

    return Settings(
        admin_password=password,
        secret_key=secret,
        data_dir=data_dir,
        port=port,
        trust_proxy=trust_raw.strip().lower() in _TRUE,
    )


def resolve_secret_key(data_dir: Path) -> str:
    """Use SERAFRAME_SECRET_KEY when set; otherwise reuse or create the data-dir file.

    A set value is used as-is and the persisted file is not read or written.
    An unset or empty value reads ``data_dir/secret_key``. If that file is
    missing, a new key is written there (mode 0600) and reused on later starts.
    """
    env = os.environ.get("SERAFRAME_SECRET_KEY")
    if env:
        if len(env.encode("utf-8")) < MIN_SECRET_BYTES:
            raise RuntimeError("SERAFRAME_SECRET_KEY must be at least 32 bytes")
        logger.info("using SERAFRAME_SECRET_KEY from the environment")
        return env

    path = data_dir / SECRET_KEY_FILENAME
    if path.is_file():
        key = _read_persisted_secret(path)
        logger.info("using persisted secret key at %s", path)
        return key

    key = _generate_and_persist(path)
    logger.info("generated and persisted secret key at %s", path)
    return key


def _read_persisted_secret(path: Path) -> str:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise RuntimeError(f"could not read persisted secret key at {path}") from exc
    try:
        text = raw.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise RuntimeError(
            f"persisted secret key at {path} is not valid text; refusing to replace it"
        ) from exc
    if len(text.encode("utf-8")) < MIN_SECRET_BYTES:
        raise RuntimeError(
            f"persisted secret key at {path} must be at least 32 bytes; refusing to replace it"
        )
    return text


def _generate_and_persist(path: Path) -> str:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(f"could not create data directory {path.parent}") from exc

    key = secrets.token_urlsafe(32)
    payload = (key + "\n").encode("ascii")
    tmp = path.parent / f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.fchmod(fd, 0o600)
            written = os.write(fd, payload)
            if written != len(payload):
                raise OSError(f"short write to {tmp}")
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            os.link(tmp, path)
        except FileExistsError:
            key = _read_persisted_secret(path)
    except OSError as exc:
        raise RuntimeError(f"could not persist secret key to {path}") from exc
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
    except OSError:
        return key
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
    return key
