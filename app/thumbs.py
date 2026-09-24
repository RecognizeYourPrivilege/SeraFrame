"""Disk cache of ~256px WebP thumbnails."""

from __future__ import annotations

import hashlib
import io
import os
import shutil
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app.config import THUMB_EDGE_PX
from app.errors import APIError
from app.paths import is_within

Image.MAX_IMAGE_PIXELS = 40_000_000


def cache_dir_for(thumb_root: Path, source_id: str) -> Path:
    if (
        not source_id
        or source_id in {".", ".."}
        or "/" in source_id
        or "\\" in source_id
        or "\x00" in source_id
    ):
        raise APIError(404, "not_found", "source not found")
    root = thumb_root.resolve()
    dest = (root / source_id).resolve()
    if not is_within(root, dest):
        raise APIError(404, "not_found", "source not found")
    return dest


def purge_source_cache(thumb_root: Path, source_id: str) -> None:
    directory = cache_dir_for(thumb_root, source_id)
    if directory.exists():
        shutil.rmtree(directory)


def cached_thumb(
    thumb_root: Path,
    source_id: str,
    rel_path: str,
    version: str,
    data: bytes,
) -> bytes:
    directory = cache_dir_for(thumb_root, source_id)
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(rel_path.encode("utf-8")).hexdigest()
    ver = hashlib.sha256(version.encode("utf-8")).hexdigest()[:20]
    dest = directory / f"{digest}-{ver}.webp"
    if dest.is_file() and dest.stat().st_size > 0:
        return dest.read_bytes()
    rendered = render_thumb(data)
    temporary = directory / f".{digest}-{ver}.{os.getpid()}.tmp"
    temporary.write_bytes(rendered)
    os.replace(temporary, dest)
    for old in directory.glob(f"{digest}-*.webp"):
        if old.name != dest.name:
            try:
                old.unlink()
            except OSError:
                pass
    return rendered


def render_thumb(data: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            if getattr(image, "is_animated", False):
                image.seek(0)
            frame = _normalize(image)
            frame.thumbnail((THUMB_EDGE_PX, THUMB_EDGE_PX), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            frame.save(buffer, format="WEBP", quality=80, method=4)
            return buffer.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise APIError(500, "io_error", "unable to read image") from exc


def _normalize(image: Image.Image) -> Image.Image:
    if image.mode == "P":
        converted = image.convert("RGBA" if "transparency" in image.info else "RGB")
    elif image.mode == "LA":
        converted = image.convert("RGBA")
    elif image.mode == "CMYK":
        converted = image.convert("RGB")
    elif image.mode not in {"RGB", "RGBA"}:
        converted = image.convert("RGB")
    else:
        converted = image.copy()
    return converted
