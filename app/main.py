"""SeraFrame HTTP API, contract v1."""

from __future__ import annotations

import logging
import math
import os
import posixpath
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote, urlsplit

from fastapi import Body, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import (
    CSRF_COOKIE,
    CSRF_TTL_SECONDS,
    LOCKOUT_ATTEMPTS,
    LOCKOUT_SECONDS,
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    Settings,
    load_settings,
)
from app.db import Database
from app.errors import APIError
from app.paths import is_still_name, locale_sort_key, sanitize_rel_path
from app.security import (
    encrypt_secret,
    fernet_for_secret,
    hash_password,
    password_needs_rehash,
    tokens_equal,
    verify_password,
)
from app.storage import inspect_directory, read_still, validate_private_key
from app.thumbs import cached_thumb, purge_source_cache

logger = logging.getLogger("seraframe")

_INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SeraFrame</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; color: #1c1c1c; background: #f7f6f3; }
    main { max-width: 36rem; }
  </style>
</head>
<body>
  <main>
    <h1>SeraFrame</h1>
    <p>The API is running. The browser UI is served separately.</p>
  </main>
</body>
</html>
"""


def _spa_root() -> Path:
    configured = os.environ.get("SERAFRAME_SPA_DIR", "").strip()
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent.parent / "spa"


def _spa_asset(root: Path, rel: str) -> Path | None:
    if not rel or "\x00" in rel or "\\" in rel or rel.startswith("/"):
        return None
    parts = rel.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return None
    try:
        root_real = root.resolve(strict=False)
        candidate = (root_real.joinpath(*parts)).resolve(strict=False)
        candidate.relative_to(root_real)
    except (OSError, ValueError):
        return None
    if candidate.is_file():
        return candidate
    return None


def _spa_response(rel: str) -> Response:
    """Serve the built client. `/api/*` is never handled here."""
    rel = rel.lstrip("/")
    if rel == "api" or rel.startswith("api/"):
        return json_error(404, "not_found", "not found")
    root = _spa_root()
    index = root / "index.html"
    asset = _spa_asset(root, rel) if rel else None
    if asset is not None:
        return FileResponse(asset)
    has_suffix = bool(rel) and bool(posixpath.splitext(rel)[1])
    if index.is_file() and not has_suffix:
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    if has_suffix:
        return json_error(404, "not_found", "not found")
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return HTMLResponse(_INDEX_HTML)

_CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


class LoginBody(BaseModel):
    password: str


class LocalSourceIn(BaseModel):
    type: Literal["local"]
    rootPath: str
    label: str | None = None


class SftpSourceIn(BaseModel):
    type: Literal["sftp"]
    host: str
    port: int | None = None
    username: str
    remotePath: str
    password: str | None = None
    privateKey: str | None = None
    label: str | None = None


SourceIn = Annotated[LocalSourceIn | SftpSourceIn, Field(discriminator="type")]


class ServerIn(BaseModel):
    name: str
    url: str


def json_error(
    status_code: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers=headers,
    )


def _set_locale() -> None:
    import locale

    for name in ("C.UTF-8", "C.utf8", "en_US.UTF-8"):
        try:
            locale.setlocale(locale.LC_COLLATE, name)
            return
        except locale.Error:
            continue


def create_app() -> FastAPI:
    settings = load_settings()
    _set_locale()
    logging.basicConfig(level=logging.INFO)
    db = Database(settings.db_path)
    if db.fetchone("SELECT id FROM admin WHERE id = 1") is None:
        db.ensure_admin(hash_password(settings.admin_password))
    db.purge_expired_sessions()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.thumb_dir.mkdir(parents=True, exist_ok=True)
    fernet = fernet_for_secret(settings.secret_key)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        app.state.db.close()

    app = FastAPI(title="SeraFrame", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.db = db
    app.state.fernet = fernet

    @app.exception_handler(APIError)
    async def api_error(_request: Request, exc: APIError) -> JSONResponse:
        return json_error(exc.status_code, exc.code, exc.message, exc.headers or None)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return json_error(400, "validation", "invalid request")

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return json_error(404, "not_found", "not found")
        if exc.status_code == 401:
            return json_error(401, "unauthorized", "authentication required")
        if exc.status_code == 403:
            return json_error(403, "forbidden", "forbidden")
        return json_error(exc.status_code, "io_error", "request failed")

    @app.exception_handler(Exception)
    async def unhandled(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error: %s", type(exc).__name__)
        return json_error(500, "io_error", "internal error")

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/"):
            header = request.headers.get("x-csrf-token", "")
            cookie = request.cookies.get(CSRF_COOKIE, "")
            if not tokens_equal(header, cookie):
                return json_error(403, "csrf", "csrf token missing or invalid")
        return await call_next(request)

    @app.get("/", response_model=None)
    def index() -> Response:
        return _spa_response("")

    @app.get("/api/auth/csrf")
    def issue_csrf(request: Request) -> JSONResponse:
        token = secrets.token_urlsafe(32)
        response = JSONResponse({"csrfToken": token}, headers={"Cache-Control": "no-store"})
        _set_csrf_cookie(response, request.app.state.settings, token)
        return response

    @app.post("/api/auth/login")
    def login(request: Request, body: LoginBody) -> JSONResponse:
        response_token, failure = _attempt_login(request.app.state.db, body.password)
        if failure is not None:
            raise failure
        assert response_token is not None
        response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
        response.set_cookie(
            SESSION_COOKIE,
            response_token,
            max_age=SESSION_TTL_SECONDS,
            httponly=True,
            secure=request.app.state.settings.secure_cookies,
            samesite="lax",
            path="/",
        )
        return response

    @app.post("/api/auth/logout")
    def logout(request: Request) -> JSONResponse:
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            with request.app.state.db.transaction() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            secure=request.app.state.settings.secure_cookies,
            samesite="lax",
            httponly=True,
        )
        return response

    @app.get("/api/auth/me")
    def me(request: Request) -> dict[str, bool]:
        _require_session(request)
        return {"authenticated": True}

    @app.get("/api/sources")
    def list_sources(request: Request) -> dict[str, list]:
        _require_session(request)
        rows = request.app.state.db.fetchall(
            "SELECT * FROM sources ORDER BY created_at, id"
        )
        return {"sources": [_public_source(row) for row in rows]}

    @app.get("/api/sources/suggestions")
    def source_suggestions(request: Request) -> dict[str, list[str]]:
        _require_session(request)
        return {"paths": _comfy_suggestions()}

    @app.post("/api/sources", status_code=201)
    def create_source(request: Request, body: Annotated[SourceIn, Body()]) -> JSONResponse:
        _require_session(request)
        source_id = str(uuid.uuid4())
        now = time.time()
        if isinstance(body, LocalSourceIn):
            fields = _local_fields(body)
            with request.app.state.db.transaction() as conn:
                conn.execute(
                    """
                    INSERT INTO sources (
                        id, type, label, root_path, host, port, username,
                        remote_path, password_enc, private_key_enc, created_at
                    ) VALUES (?, 'local', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)
                    """,
                    (source_id, fields["label"], fields["root_path"], now),
                )
        else:
            fields = _sftp_fields(body, request.app.state.fernet)
            with request.app.state.db.transaction() as conn:
                conn.execute(
                    """
                    INSERT INTO sources (
                        id, type, label, root_path, host, port, username,
                        remote_path, password_enc, private_key_enc, created_at
                    ) VALUES (?, 'sftp', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        source_id,
                        fields["label"],
                        fields["host"],
                        fields["port"],
                        fields["username"],
                        fields["remote_path"],
                        fields["password_enc"],
                        fields["private_key_enc"],
                        now,
                    ),
                )
        row = request.app.state.db.fetchone("SELECT * FROM sources WHERE id = ?", (source_id,))
        return JSONResponse(status_code=201, content={"source": _public_source(row)})

    @app.delete("/api/sources/{source_id}")
    def delete_source(request: Request, source_id: str) -> dict[str, bool]:
        _require_session(request)
        with request.app.state.db.transaction() as conn:
            row = conn.execute("SELECT id FROM sources WHERE id = ?", (source_id,)).fetchone()
            if row is not None:
                conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
        if row is None:
            raise APIError(404, "not_found", "source not found")
        purge_source_cache(request.app.state.settings.thumb_dir, source_id)
        return {"ok": True}

    @app.get("/api/sources/{source_id}/tree")
    async def source_tree(
        request: Request,
        source_id: str,
        path: str = Query(default=""),
    ) -> dict:
        _require_session(request)
        safe = sanitize_rel_path(path)
        source = _source_or_404(request, source_id)
        _safe, items = await inspect_directory(
            source, safe, request.app.state.fernet, request.app.state.db
        )
        return {"path": _safe, "entries": _tree_entries(items)}

    @app.get("/api/sources/{source_id}/stills")
    async def source_stills(
        request: Request,
        source_id: str,
        path: str = Query(default=""),
    ) -> dict:
        _require_session(request)
        safe = sanitize_rel_path(path)
        source = _source_or_404(request, source_id)
        folder, items = await inspect_directory(
            source, safe, request.app.state.fernet, request.app.state.db
        )
        stills = [
            _still_payload(source_id, rel_path)
            for _name, is_dir, rel_path, _count in items
            if not is_dir
        ]
        stills.sort(key=lambda item: locale_sort_key(item["relPath"]))
        return {"path": folder, "stills": stills}

    @app.get("/api/media/{source_id}/thumb")
    async def media_thumb(
        request: Request,
        source_id: str,
        path: str | None = Query(default=None),
    ) -> Response:
        _require_session(request)
        if path is None:
            raise APIError(400, "validation", "path is required")
        source, safe, data, version = await _load_still(request, source_id, path)
        payload = await _render_cached(
            request.app.state.settings.thumb_dir,
            source["id"],
            safe,
            version,
            data,
        )
        return Response(
            content=payload,
            media_type="image/webp",
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/media/{source_id}/full")
    async def media_full(
        request: Request,
        source_id: str,
        path: str | None = Query(default=None),
    ) -> Response:
        _require_session(request)
        if path is None:
            raise APIError(400, "validation", "path is required")
        _source, safe, data, _version = await _load_still(request, source_id, path)
        return Response(
            content=data,
            media_type=_content_type(safe),
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/servers")
    def list_servers(request: Request) -> dict[str, list]:
        _require_session(request)
        rows = request.app.state.db.fetchall(
            "SELECT id, name, url FROM servers ORDER BY created_at, id"
        )
        return {"servers": [_public_server(row) for row in rows]}

    @app.post("/api/servers", status_code=201)
    def create_server(request: Request, body: ServerIn) -> JSONResponse:
        _require_session(request)
        name = body.name.strip()
        if not name or len(name) > 200:
            raise APIError(400, "validation", "name is required")
        url = _normalize_url(body.url)
        server_id = str(uuid.uuid4())
        now = time.time()
        with request.app.state.db.transaction() as conn:
            conn.execute(
                "INSERT INTO servers (id, name, url, created_at) VALUES (?, ?, ?, ?)",
                (server_id, name, url, now),
            )
        return JSONResponse(
            status_code=201,
            content={"server": {"id": server_id, "name": name, "url": url}},
        )

    @app.delete("/api/servers/{server_id}")
    def delete_server(request: Request, server_id: str) -> dict[str, bool]:
        _require_session(request)
        with request.app.state.db.transaction() as conn:
            row = conn.execute("SELECT id FROM servers WHERE id = ?", (server_id,)).fetchone()
            if row is not None:
                conn.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        if row is None:
            raise APIError(404, "not_found", "server not found")
        return {"ok": True}

    @app.get("/{full_path:path}", response_model=None)
    def spa_fallback(full_path: str) -> Response:
        return _spa_response(full_path)

    return app


def _attempt_login(db: Database, password: str) -> tuple[str | None, APIError | None]:
    now = time.time()
    failure: APIError | None = None
    token: str | None = None
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT password_hash, failed_attempts, locked_until FROM admin WHERE id = 1"
        ).fetchone()
        if row is None:
            failure = APIError(500, "io_error", "admin is not initialized")
        else:
            attempts = int(row["failed_attempts"])
            locked_until = row["locked_until"]
            if locked_until is not None and float(locked_until) > now:
                retry = max(1, math.ceil(float(locked_until) - now))
                failure = APIError(
                    429,
                    "locked_out",
                    "too many login attempts",
                    {"Retry-After": str(retry)},
                )
            else:
                if locked_until is not None:
                    attempts = 0
                accepted = False
                replacement_hash = None
                if isinstance(password, str) and 1 <= len(password) <= 1024:
                    accepted = verify_password(row["password_hash"], password)
                    if accepted and password_needs_rehash(row["password_hash"]):
                        replacement_hash = hash_password(password)
                if not accepted:
                    attempts += 1
                    new_lock = None
                    headers = None
                    status = 401
                    code = "unauthorized"
                    message = "invalid password"
                    if attempts >= LOCKOUT_ATTEMPTS:
                        new_lock = now + LOCKOUT_SECONDS
                        status = 429
                        code = "locked_out"
                        message = "too many login attempts"
                        headers = {"Retry-After": str(LOCKOUT_SECONDS)}
                    conn.execute(
                        "UPDATE admin SET failed_attempts = ?, locked_until = ? WHERE id = 1",
                        (attempts, new_lock),
                    )
                    failure = APIError(status, code, message, headers)
                else:
                    conn.execute(
                        """
                        UPDATE admin
                        SET failed_attempts = 0,
                            locked_until = NULL,
                            password_hash = COALESCE(?, password_hash)
                        WHERE id = 1
                        """,
                        (replacement_hash,),
                    )
                    token = secrets.token_urlsafe(32)
                    conn.execute(
                        "INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)",
                        (token, now, now + SESSION_TTL_SECONDS),
                    )
                    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    return token, failure


def _require_session(request: Request) -> None:
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token or not _session_live(request.app.state.db, token):
        raise APIError(401, "unauthorized", "authentication required")


def _session_live(db: Database, token: str) -> bool:
    row = db.fetchone("SELECT expires_at FROM sessions WHERE token = ?", (token,))
    if row is None:
        return False
    if float(row["expires_at"]) <= time.time():
        with db.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return False
    return True


def _set_csrf_cookie(response: JSONResponse, settings: Settings, token: str) -> None:
    response.set_cookie(
        CSRF_COOKIE,
        token,
        max_age=CSRF_TTL_SECONDS,
        httponly=False,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def _source_or_404(request: Request, source_id: str):
    row = request.app.state.db.fetchone("SELECT * FROM sources WHERE id = ?", (source_id,))
    if row is None:
        raise APIError(404, "not_found", "source not found")
    return row


def _public_source(row) -> dict:
    payload = {"id": row["id"], "type": row["type"], "label": row["label"]}
    if row["type"] == "local":
        payload["rootPath"] = row["root_path"]
    else:
        payload["host"] = row["host"]
        payload["port"] = row["port"]
        payload["username"] = row["username"]
        payload["remotePath"] = row["remote_path"]
        payload["hasPrivateKey"] = bool(row["private_key_enc"])
        payload["hasPassword"] = bool(row["password_enc"])
    return payload


def _public_server(row) -> dict[str, str]:
    return {"id": row["id"], "name": row["name"], "url": row["url"]}


def _label(explicit: str | None, fallback: str) -> str:
    label = (explicit or "").strip()
    if not label:
        label = posixpath.basename(fallback.rstrip("/")) or fallback
    if len(label) > 200:
        raise APIError(400, "validation", "label is too long")
    return label


def _local_fields(body: LocalSourceIn) -> dict[str, str]:
    root = body.rootPath.strip()
    if "\x00" in root or not Path(root).is_absolute():
        raise APIError(400, "validation", "rootPath must be an absolute path")
    if len(root) > 4096:
        raise APIError(400, "validation", "rootPath is too long")
    if root != "/":
        root = root.rstrip("/")
    return {"label": _label(body.label, root), "root_path": root}


def _sftp_fields(body: SftpSourceIn, fernet) -> dict:
    host = body.host.strip()
    if not host or len(host) > 255 or any(ch in host for ch in " \t\r\n/\\") or "\x00" in host:
        raise APIError(400, "validation", "host is invalid")
    username = body.username.strip()
    if not username or len(username) > 128 or any(ch in username for ch in " \t\r\n") or "\x00" in username:
        raise APIError(400, "validation", "username is invalid")
    remote = body.remotePath.strip()
    if "\x00" in remote or not remote.startswith("/") or len(remote) > 4096:
        raise APIError(400, "validation", "remotePath must be an absolute path")
    remote = posixpath.normpath(remote)
    if not remote.startswith("/"):
        raise APIError(400, "validation", "remotePath must be an absolute path")
    if body.port is None:
        port = 22
    elif isinstance(body.port, bool) or not 1 <= body.port <= 65535:
        raise APIError(400, "validation", "port is invalid")
    else:
        port = body.port
    password = body.password or ""
    private_key = body.privateKey.strip() if body.privateKey else ""
    if password and len(password) > 1024:
        raise APIError(400, "validation", "password is too long")
    if private_key and len(private_key) > 65536:
        raise APIError(400, "validation", "private key is too large")
    if not password and not private_key:
        raise APIError(400, "validation", "sftp source requires a password or private key")
    if private_key:
        validate_private_key(private_key, password or None)
    return {
        "label": _label(body.label, remote),
        "host": host,
        "port": port,
        "username": username,
        "remote_path": remote,
        "password_enc": encrypt_secret(fernet, password) if password else None,
        "private_key_enc": encrypt_secret(fernet, private_key) if private_key else None,
    }


def _normalize_url(url: str) -> str:
    cleaned = url.strip()
    if not cleaned or len(cleaned) > 2000 or "\x00" in cleaned:
        raise APIError(400, "validation", "url must be http or https")
    parsed = urlsplit(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise APIError(400, "validation", "url must be http or https")
    if parsed.username or parsed.password:
        raise APIError(400, "validation", "url must not include credentials")
    return cleaned


def _comfy_suggestions() -> list[str]:
    base = Path("/opt")
    if not base.is_dir():
        return []
    found: list[str] = []
    try:
        for entry in base.iterdir():
            if entry.name.startswith("comfyui_") and entry.is_dir():
                found.append(str(entry))
    except OSError:
        logger.warning("unable to read /opt for source suggestions")
        return []
    found.sort(key=locale_sort_key)
    return found


def _tree_entries(items: list[tuple]) -> list[dict]:
    directories = [item for item in items if item[1]]
    stills = [item for item in items if not item[1]]
    directories.sort(key=lambda item: locale_sort_key(item[0]))
    stills.sort(key=lambda item: locale_sort_key(item[0]))
    entries: list[dict] = []
    for name, _is_dir, rel_path, count in directories:
        entries.append(
            {"kind": "dir", "name": name, "relPath": rel_path, "stillCount": int(count or 0)}
        )
    for name, _is_dir, rel_path, _count in stills:
        entries.append({"kind": "still", "name": name, "relPath": rel_path})
    return entries


def _still_payload(source_id: str, rel_path: str) -> dict[str, str]:
    encoded = quote(rel_path, safe="/")
    return {
        "sourceId": source_id,
        "relPath": rel_path,
        "name": posixpath.basename(rel_path),
        "thumbUrl": f"/api/media/{source_id}/thumb?path={encoded}",
        "fullUrl": f"/api/media/{source_id}/full?path={encoded}",
    }


def _content_type(rel_path: str) -> str:
    return _CONTENT_TYPES.get(posixpath.splitext(rel_path)[1].lower(), "application/octet-stream")


async def _load_still(request: Request, source_id: str, path: str):
    _require_session(request)
    safe = sanitize_rel_path(path)
    if not safe or not is_still_name(posixpath.basename(safe)):
        raise APIError(404, "not_found", "still not found")
    source = _source_or_404(request, source_id)
    data, version = await read_still(source, safe, request.app.state.fernet, request.app.state.db)
    return source, safe, data, version


async def _render_cached(
    thumb_root: Path,
    source_id: str,
    rel_path: str,
    version: str,
    data: bytes,
) -> bytes:
    import asyncio

    return await asyncio.to_thread(cached_thumb, thumb_root, source_id, rel_path, version, data)
