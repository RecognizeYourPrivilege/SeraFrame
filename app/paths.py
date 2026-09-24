"""Relative-path sandbox. Rejects escape attempts before any IO."""

from __future__ import annotations

import locale
import posixpath
from pathlib import Path, PurePosixPath

from app.config import STILL_SUFFIXES
from app.errors import APIError, PathRejected


def sanitize_rel_path(rel: str | None) -> str:
    """Return a normalized POSIX relative path, or raise PathRejected."""
    if rel is None:
        rel = ""
    if not isinstance(rel, str):
        raise PathRejected()
    if "\x00" in rel or "\\" in rel:
        raise PathRejected()
    if rel.startswith("/") or posixpath.isabs(rel):
        raise PathRejected()
    parts = PurePosixPath(rel).parts if rel else ()
    if any(part in ("..", "") for part in parts):
        raise PathRejected()
    normalized = posixpath.normpath(rel) if rel else ""
    if normalized in (".", ""):
        return ""
    if (
        normalized.startswith("../")
        or normalized == ".."
        or normalized.startswith("/")
        or posixpath.isabs(normalized)
    ):
        raise PathRejected()
    normalized_parts = PurePosixPath(normalized).parts
    if any(part in ("..", "") for part in normalized_parts):
        raise PathRejected()
    return normalized


def is_still_name(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(suffix) for suffix in STILL_SUFFIXES)


def is_within(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def resolve_local(root: str, rel: str) -> Path:
    """Resolve rel inside root. Symlinks that leave root are rejected."""
    safe_rel = sanitize_rel_path(rel)
    root_path = Path(root)
    if not root_path.is_absolute():
        raise APIError(500, "io_error", "source root is not absolute")
    root_real = root_path.resolve(strict=False)
    current = root_real
    if safe_rel:
        for part in PurePosixPath(safe_rel).parts:
            if part in ("", ".", ".."):
                raise PathRejected()
            current = current / part
            try:
                if current.is_symlink():
                    target = current.resolve(strict=False)
                    if not is_within(root_real, target):
                        raise PathRejected()
            except OSError as exc:
                raise APIError(500, "io_error", "unable to read path") from exc
    try:
        final = current.resolve(strict=False)
    except OSError as exc:
        raise APIError(500, "io_error", "unable to read path") from exc
    if not is_within(root_real, final):
        raise PathRejected()
    return final


def remote_within(root: str, path: str) -> bool:
    root_norm = posixpath.normpath(root)
    path_norm = posixpath.normpath(path)
    if root_norm == "/":
        return path_norm.startswith("/")
    return path_norm == root_norm or path_norm.startswith(root_norm + "/")


def join_remote(root: str, rel: str) -> str:
    safe_rel = sanitize_rel_path(rel)
    root_norm = posixpath.normpath(root)
    if not root_norm.startswith("/"):
        raise APIError(500, "io_error", "remote root is not absolute")
    full = root_norm if not safe_rel else posixpath.normpath(posixpath.join(root_norm, safe_rel))
    if not remote_within(root_norm, full):
        raise PathRejected()
    return full


def child_rel(parent: str, name: str) -> str:
    if name in ("", ".", "..") or "/" in name or "\\" in name or "\x00" in name:
        raise PathRejected()
    return f"{parent}/{name}" if parent else name


def locale_sort_key(value: str) -> str:
    folded = value.casefold()
    try:
        return locale.strxfrm(folded)
    except (locale.Error, ValueError):
        return folded
