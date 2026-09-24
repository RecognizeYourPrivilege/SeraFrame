"""Local and SFTP directory listings and file reads."""

from __future__ import annotations

import asyncio
import logging
import os
import posixpath
import sqlite3
import stat
from pathlib import Path
from typing import Any

import asyncssh
from cryptography.fernet import Fernet

from app.config import MAX_IMAGE_BYTES
from app.db import Database
from app.errors import APIError, PathRejected
from app.paths import (
    child_rel,
    is_still_name,
    is_within,
    join_remote,
    remote_within,
    resolve_local,
    sanitize_rel_path,
)
from app.security import decrypt_secret, tokens_equal

logger = logging.getLogger("seraframe.storage")

Listed = tuple[str, bool, str, int | None]


def validate_private_key(private_key: str, password: str | None) -> None:
    try:
        asyncssh.import_private_key(private_key)
        return
    except asyncssh.KeyImportError:
        pass
    if password:
        try:
            asyncssh.import_private_key(private_key, passphrase=password)
            return
        except asyncssh.KeyImportError:
            pass
    raise APIError(400, "validation", "invalid private key")


async def inspect_directory(
    source: sqlite3.Row,
    rel: str,
    fernet: Fernet,
    db: Database,
) -> tuple[str, list[Listed]]:
    safe = sanitize_rel_path(rel)
    if source["type"] == "local":
        entries = await asyncio.to_thread(_inspect_local, source["root_path"], safe)
        return safe, entries
    if source["type"] == "sftp":
        entries = await _inspect_sftp(source, safe, fernet, db)
        return safe, entries
    raise APIError(500, "io_error", "unknown source type")


async def read_still(
    source: sqlite3.Row,
    rel: str,
    fernet: Fernet,
    db: Database,
) -> tuple[bytes, str]:
    safe = sanitize_rel_path(rel)
    if source["type"] == "local":
        return await asyncio.to_thread(_read_local, source["root_path"], safe)
    if source["type"] == "sftp":
        return await _read_sftp(source, safe, fernet, db)
    raise APIError(500, "io_error", "unknown source type")


def _inspect_local(root: str, rel: str) -> list[Listed]:
    children = _list_local(root, rel)
    listed: list[Listed] = []
    for name, is_dir, rel_path in children:
        count = None
        if is_dir:
            try:
                nested = _list_local(root, rel_path)
            except APIError:
                count = 0
            else:
                count = sum(1 for _name, nested_dir, _rel in nested if not nested_dir)
        listed.append((name, is_dir, rel_path, count))
    return listed


def _list_local(root: str, rel: str) -> list[tuple[str, bool, str]]:
    safe = sanitize_rel_path(rel)
    directory = resolve_local(root, safe)
    try:
        exists = directory.exists()
        is_dir = directory.is_dir()
    except OSError as exc:
        raise APIError(500, "io_error", "unable to list directory") from exc
    if not exists:
        raise APIError(404, "not_found", "directory not found")
    if not is_dir:
        raise APIError(400, "validation", "not a directory")
    root_real = resolve_local(root, "")
    items: list[tuple[str, bool, str]] = []
    try:
        iterator = os.scandir(directory)
    except OSError as exc:
        raise APIError(500, "io_error", "unable to list directory") from exc
    with iterator:
        for entry in iterator:
            name = entry.name
            if name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
                continue
            try:
                resolved = Path(entry.path).resolve(strict=False)
                if not is_within(root_real, resolved):
                    continue
                entry_is_dir = entry.is_dir(follow_symlinks=True)
            except OSError:
                continue
            if not entry_is_dir and not is_still_name(name):
                continue
            items.append((name, entry_is_dir, child_rel(safe, name)))
    return items


def _read_local(root: str, rel: str) -> tuple[bytes, str]:
    path = resolve_local(root, rel)
    try:
        if not path.is_file():
            raise APIError(404, "not_found", "still not found")
        stat_result = path.stat()
        if stat_result.st_size > MAX_IMAGE_BYTES:
            raise APIError(500, "io_error", "image is too large")
        data = path.read_bytes()
    except APIError:
        raise
    except OSError as exc:
        raise APIError(500, "io_error", "unable to read file") from exc
    return data, str(stat_result.st_mtime_ns)


def _client_factory(db: Database) -> type[asyncssh.SSHClient]:
    class HostKeyClient(asyncssh.SSHClient):
        def validate_host_public_key(self, host: str, addr: str, port: int, key: Any) -> bool:
            fingerprint = key.get_fingerprint()
            try:
                stored = db.remember_host_key(host, int(port), fingerprint)
            except Exception:
                logger.exception("failed to store sftp host key")
                return False
            return tokens_equal(stored, fingerprint)

    return HostKeyClient


def _load_credentials(
    source: sqlite3.Row, fernet: Fernet
) -> tuple[list[Any] | None, str | None]:
    password = None
    private_key = None
    try:
        if source["password_enc"]:
            password = decrypt_secret(fernet, source["password_enc"])
        if source["private_key_enc"]:
            private_key = decrypt_secret(fernet, source["private_key_enc"])
    except ValueError as exc:
        raise APIError(500, "io_error", "stored secret could not be decrypted") from exc

    client_keys = None
    user_password = password
    if private_key:
        try:
            key = asyncssh.import_private_key(private_key)
        except asyncssh.KeyImportError:
            if not password:
                raise APIError(500, "io_error", "stored private key is unusable") from None
            try:
                key = asyncssh.import_private_key(private_key, passphrase=password)
            except asyncssh.KeyImportError as exc:
                raise APIError(500, "io_error", "stored private key is unusable") from exc
            user_password = None
        client_keys = [key]
    if not client_keys and not user_password:
        raise APIError(500, "io_error", "sftp source has no credentials")
    return client_keys, user_password


def _connection_options(
    source: sqlite3.Row,
    db: Database,
    client_keys: list[Any] | None,
    user_password: str | None,
) -> asyncssh.SSHClientConnectionOptions:
    if client_keys and user_password:
        preferred: list[str] = ["publickey", "password"]
    elif client_keys:
        preferred = ["publickey"]
    else:
        preferred = ["password"]
    options = asyncssh.SSHClientConnectionOptions(
        username=source["username"],
        password=user_password,
        client_keys=client_keys,
        known_hosts=b"# seraframe\n",
        agent_path=None,
        login_timeout=20,
        connect_timeout=20,
        server_host_key_algs="default",
        client_factory=_client_factory(db),
        preferred_auth=preferred,
    )
    if options.agent_path == "":
        options.agent_path = None
    options.pkcs11_provider = None
    return options


async def _open_sftp(source: sqlite3.Row, fernet: Fernet, db: Database):
    client_keys, user_password = _load_credentials(source, fernet)
    options = _connection_options(source, db, client_keys, user_password)
    try:
        conn = await asyncssh.connect(
            source["host"],
            port=int(source["port"] or 22),
            options=options,
        )
    except (asyncssh.Error, OSError, TimeoutError, ValueError) as exc:
        logger.warning("sftp connect failed: %s", type(exc).__name__)
        raise APIError(502, "io_error", "sftp request failed") from exc
    return conn


async def _real_inside(sftp: Any, root: str, full: str) -> str:
    try:
        real = await sftp.realpath(full)
    except asyncssh.SFTPNoSuchFile as exc:
        raise APIError(404, "not_found", "not found") from exc
    except (asyncssh.Error, OSError) as exc:
        raise APIError(502, "io_error", "sftp request failed") from exc
    if isinstance(real, bytes):
        text = real.decode("utf-8", "surrogateescape")
    else:
        text = str(real)
    text = posixpath.normpath(text)
    if not remote_within(root, text):
        raise PathRejected()
    return text


def _is_dir_attr(attrs: Any) -> bool:
    permissions = getattr(attrs, "permissions", None)
    if permissions is not None:
        return stat.S_ISDIR(permissions)
    return int(getattr(attrs, "type", 0) or 0) == 2


async def _list_sftp_conn(sftp: Any, root: str, rel: str) -> list[tuple[str, bool, str]]:
    safe = sanitize_rel_path(rel)
    full = join_remote(root, safe)
    real_dir = await _real_inside(sftp, root, full)
    try:
        attr = await sftp.stat(real_dir)
    except asyncssh.SFTPNoSuchFile as exc:
        raise APIError(404, "not_found", "directory not found") from exc
    except (asyncssh.Error, OSError) as exc:
        raise APIError(502, "io_error", "unable to list directory") from exc
    if not _is_dir_attr(attr):
        raise APIError(400, "validation", "not a directory")
    try:
        entries = await sftp.readdir(real_dir)
    except asyncssh.SFTPNoSuchFile as exc:
        raise APIError(404, "not_found", "directory not found") from exc
    except (asyncssh.Error, OSError) as exc:
        raise APIError(502, "io_error", "unable to list directory") from exc

    items: list[tuple[str, bool, str]] = []
    for entry in entries:
        name = entry.filename
        if isinstance(name, bytes):
            name = name.decode("utf-8", "surrogateescape")
        if name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
            continue
        child_full = posixpath.join(real_dir, name)
        try:
            real_child = await _real_inside(sftp, root, child_full)
            child_attr = await sftp.stat(real_child)
        except PathRejected:
            continue
        except APIError:
            continue
        is_dir = _is_dir_attr(child_attr)
        if not is_dir and not is_still_name(name):
            continue
        items.append((name, is_dir, child_rel(safe, name)))
    return items


async def _inspect_sftp(
    source: sqlite3.Row,
    rel: str,
    fernet: Fernet,
    db: Database,
) -> list[Listed]:
    root = source["remote_path"]
    conn = await _open_sftp(source, fernet, db)
    try:
        async with conn:
            async with conn.start_sftp_client() as sftp:
                children = await _list_sftp_conn(sftp, root, rel)
                listed: list[Listed] = []
                for name, is_dir, rel_path in children:
                    count = None
                    if is_dir:
                        try:
                            nested = await _list_sftp_conn(sftp, root, rel_path)
                        except APIError:
                            count = 0
                        else:
                            count = sum(1 for _name, nested_dir, _rel in nested if not nested_dir)
                    listed.append((name, is_dir, rel_path, count))
                return listed
    except APIError:
        raise
    except (asyncssh.Error, OSError, TimeoutError) as exc:
        logger.warning("sftp list failed: %s", type(exc).__name__)
        raise APIError(502, "io_error", "sftp request failed") from exc


async def _read_sftp(
    source: sqlite3.Row,
    rel: str,
    fernet: Fernet,
    db: Database,
) -> tuple[bytes, str]:
    root = source["remote_path"]
    full = join_remote(root, rel)
    conn = await _open_sftp(source, fernet, db)
    try:
        async with conn:
            async with conn.start_sftp_client() as sftp:
                real = await _real_inside(sftp, root, full)
                try:
                    attr = await sftp.stat(real)
                except asyncssh.SFTPNoSuchFile as exc:
                    raise APIError(404, "not_found", "still not found") from exc
                except (asyncssh.Error, OSError) as exc:
                    raise APIError(502, "io_error", "unable to read file") from exc
                if _is_dir_attr(attr):
                    raise APIError(404, "not_found", "still not found")
                size = getattr(attr, "size", None)
                if size is not None and int(size) > MAX_IMAGE_BYTES:
                    raise APIError(500, "io_error", "image is too large")
                try:
                    async with sftp.open(real, "rb") as handle:
                        data = await handle.read(MAX_IMAGE_BYTES + 1)
                except asyncssh.SFTPNoSuchFile as exc:
                    raise APIError(404, "not_found", "still not found") from exc
                except (asyncssh.Error, OSError) as exc:
                    raise APIError(502, "io_error", "unable to read file") from exc
                if len(data) > MAX_IMAGE_BYTES:
                    raise APIError(500, "io_error", "image is too large")
                mtime = getattr(attr, "mtime", None) or 0
                mtime_ns = getattr(attr, "mtime_ns", None) or 0
                return data, f"{mtime}.{mtime_ns}"
    except APIError:
        raise
    except (asyncssh.Error, OSError, TimeoutError) as exc:
        logger.warning("sftp read failed: %s", type(exc).__name__)
        raise APIError(502, "io_error", "sftp request failed") from exc
