"""Live Comfy session image feed.

SeraFrame listens on a configured server's Comfy websocket for node ``executed``
events and keeps those images in process memory. Bytes are proxied from that
server's ``/view`` endpoint so the SPA can use same-origin URLs.

This is the current observation window, not a history-folder listing. Comfy
delivers ``executed`` only to the websocket ``clientId`` that queued the prompt.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

import httpx

from app.errors import APIError

logger = logging.getLogger("seraframe")

FEED_MAX_ITEMS = 500
_VIEW_MAX_BYTES = 64 * 1024 * 1024
_IMAGE_TYPES = frozenset({"output", "input", "temp"})
_PREVIEW = "webp;90"
_KEEPALIVE_SECONDS = 15.0
_CONNECT_BACKOFF_START = 0.5
_CONNECT_BACKOFF_MAX = 30.0

DisconnectCheck = Callable[[], Awaitable[bool]]


class _Socket(Protocol):
    def __aiter__(self) -> _Socket: ...

    async def __anext__(self) -> str | bytes: ...


class _Connector(Protocol):
    def __call__(self, url: str) -> _AsyncConnect: ...


class _AsyncConnect(Protocol):
    async def __aenter__(self) -> _Socket: ...

    async def __aexit__(self, exc_type, exc, tb) -> None: ...


@dataclass(frozen=True)
class ParsedImage:
    prompt_id: str
    node_id: str
    node_class: str | None
    index: int
    filename: str
    subfolder: str
    image_type: str

    @property
    def id(self) -> str:
        return occurrence_id(
            self.prompt_id,
            self.node_id,
            self.index,
            self.filename,
            self.subfolder,
            self.image_type,
        )


@dataclass
class _Session:
    server_id: str
    url: str
    client_id: str
    items: list[ParsedImage]
    subscribers: list[asyncio.Queue]
    task: asyncio.Task | None = None
    stop: bool = False
    listening: bool = False
    error: str | None = None


def occurrence_id(
    prompt_id: str,
    node_id: str,
    index: int,
    filename: str,
    subfolder: str,
    image_type: str,
) -> str:
    """Stable id for one image occurrence in one executed event."""
    material = "\0".join((prompt_id, node_id, str(index), filename, subfolder, image_type))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


def passes_save_node_only(
    image_type: str,
    node_class: str | None,
    save_node_only: bool,
) -> bool:
    """Default off: PreviewImage and SaveImage both stay.

    When the filter is on, an explicit node class must be ``SaveImage``.
    Comfy's ``executed`` payload usually has no class. In that case ``type``
    ``output`` is kept (SaveImage's folder) and ``temp`` is dropped
    (PreviewImage's folder).
    """
    if not save_node_only:
        return True
    if node_class is not None:
        return node_class == "SaveImage"
    return image_type == "output"


def parse_executed_images(payload: object) -> list[ParsedImage]:
    """Images from a Comfy websocket ``executed`` frame or the frontend detail."""
    detail = _executed_detail(payload)
    if detail is None:
        return []
    output = detail.get("output")
    if not isinstance(output, dict):
        return []
    images = output.get("images")
    if not isinstance(images, list):
        return []
    prompt_id = _as_text(detail.get("prompt_id")) or ""
    node_id = _as_text(detail.get("node")) or ""
    node_class = _node_class(detail)
    parsed: list[ParsedImage] = []
    for index, image in enumerate(images):
        if not isinstance(image, dict):
            continue
        filename = image.get("filename")
        if not isinstance(filename, str):
            continue
        subfolder = image.get("subfolder", "")
        if not isinstance(subfolder, str):
            continue
        raw_type = image.get("type", "output")
        if raw_type is None:
            raw_type = "output"
        if not isinstance(raw_type, str):
            continue
        image_type = raw_type or "output"
        if image_type not in _IMAGE_TYPES:
            continue
        if view_param_error(filename, image_type, subfolder, None) is not None:
            continue
        image_class = _node_class(image) or node_class
        parsed.append(
            ParsedImage(
                prompt_id=prompt_id,
                node_id=node_id,
                node_class=image_class,
                index=index,
                filename=filename,
                subfolder=subfolder,
                image_type=image_type,
            )
        )
    return parsed


def feed_item(server_id: str, image: ParsedImage) -> dict[str, str]:
    thumb, full = feed_item_urls(server_id, image.filename, image.image_type, image.subfolder)
    return {
        "id": image.id,
        "name": image.filename,
        "thumbUrl": thumb,
        "fullUrl": full,
    }


def feed_item_urls(
    server_id: str,
    filename: str,
    image_type: str,
    subfolder: str,
) -> tuple[str, str]:
    """Same-origin view URLs. The thumb asks Comfy for a webp preview."""
    base = f"/api/servers/{quote(server_id, safe='')}/view"
    common = [("filename", filename), ("type", image_type), ("subfolder", subfolder)]
    full = f"{base}?{_query(common)}"
    thumb = f"{base}?{_query([*common, ('preview', _PREVIEW)])}"
    return thumb, full


def comfy_ws_url(server_url: str, client_id: str) -> str:
    parts = urlsplit(server_url.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise APIError(400, "validation", "url must be http or https")
    scheme = "wss" if parts.scheme == "https" else "ws"
    path = _join_path(parts.path, "ws")
    return urlunsplit((scheme, parts.netloc, path, _query([("clientId", client_id)]), ""))


def comfy_http_origin(server_url: str) -> str:
    parts = urlsplit(server_url.strip())
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def comfy_view_url(
    server_url: str,
    filename: str,
    image_type: str,
    subfolder: str,
    preview: str | None,
) -> str:
    parts = urlsplit(server_url.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise APIError(400, "validation", "url must be http or https")
    query: list[tuple[str, str]] = [
        ("filename", filename),
        ("type", image_type),
        ("subfolder", subfolder),
    ]
    if preview is not None:
        query.append(("preview", preview))
    path = _join_path(parts.path, "view")
    return urlunsplit((parts.scheme, parts.netloc, path, _query(query), ""))


def view_param_error(
    filename: str,
    image_type: str,
    subfolder: str,
    preview: str | None,
) -> APIError | None:
    if not isinstance(filename, str) or not filename or len(filename) > 512 or "\x00" in filename:
        return APIError(400, "validation", "filename is required")
    if _has_traversal(filename) or "/" in filename or "\\" in filename:
        return APIError(400, "path_rejected", "path rejected")
    if image_type not in _IMAGE_TYPES:
        return APIError(400, "validation", "type must be output, input, or temp")
    if (
        not isinstance(subfolder, str)
        or len(subfolder) > 1024
        or "\x00" in subfolder
        or "\\" in subfolder
        or subfolder.startswith("/")
        or _has_traversal(subfolder)
    ):
        return APIError(400, "path_rejected", "path rejected")
    if preview is not None:
        preview_error = _preview_error(preview)
        if preview_error is not None:
            return preview_error
    return None


def format_sse(event: str, data: dict) -> str:
    body = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {body}\n\n"


def default_connector(url: str) -> _AsyncConnect:
    """WebSocket client for Comfy ``/ws``. Origin matches the Comfy host.

    Comfy's loopback middleware rejects a browser Origin that does not match
    Host. A server-side client sets Origin to the Comfy HTTP origin.
    """
    import websockets

    parts = urlsplit(url)
    scheme = "https" if parts.scheme == "wss" else "http"
    origin = urlunsplit((scheme, parts.netloc, "", "", ""))
    return websockets.connect(
        url,
        origin=origin,
        open_timeout=5,
        close_timeout=2,
        ping_interval=20,
        ping_timeout=20,
        max_size=16 * 1024 * 1024,
    )


class ComfyFeedService:
    """In-memory session feeds and one Comfy websocket listener per server."""

    def __init__(
        self,
        *,
        max_items: int = FEED_MAX_ITEMS,
        connector: _Connector | None = None,
    ) -> None:
        self.max_items = max_items
        self.connector: _Connector = connector or default_connector
        self._lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._http: httpx.AsyncClient | None = None

    def snapshot(self, server_id: str, *, save_node_only: bool) -> dict:
        with self._lock:
            session = self._sessions.get(server_id)
            if session is None:
                return {
                    "items": [],
                    "clientId": "",
                    "listening": False,
                    "error": None,
                }
            return self._snapshot_locked(session, save_node_only)

    def ingest_payload(self, server_id: str, payload: object) -> list[dict[str, str]]:
        """Record images from one executed payload. Safe to call off the loop."""
        parsed = parse_executed_images(payload)
        if not parsed:
            return []
        added: list[tuple[ParsedImage, dict[str, str]]] = []
        subscribers: list[asyncio.Queue] = []
        loop: asyncio.AbstractEventLoop | None = None
        with self._lock:
            session = self._sessions.get(server_id)
            if session is None:
                session = _Session(
                    server_id=server_id,
                    url="",
                    client_id=secrets.token_hex(16),
                    items=[],
                    subscribers=[],
                )
                self._sessions[server_id] = session
            for image in parsed:
                if any(existing.id == image.id for existing in session.items):
                    continue
                session.items.append(image)
                while len(session.items) > self.max_items:
                    session.items.pop(0)
                added.append((image, feed_item(server_id, image)))
            subscribers = list(session.subscribers)
            loop = self._loop
        if added and subscribers:
            self._publish_items(loop, subscribers, added)
        return [item for _image, item in added]

    def has_occurrence(
        self,
        server_id: str,
        filename: str,
        image_type: str,
        subfolder: str,
    ) -> bool:
        with self._lock:
            session = self._sessions.get(server_id)
            if session is None:
                return False
            return any(
                image.filename == filename
                and image.image_type == image_type
                and image.subfolder == subfolder
                for image in session.items
            )

    async def ensure_listening(self, server_id: str, url: str) -> None:
        loop = asyncio.get_running_loop()
        with self._lock:
            self._loop = loop
            session = self._sessions.get(server_id)
            if session is None:
                session = _Session(
                    server_id=server_id,
                    url=url,
                    client_id=secrets.token_hex(16),
                    items=[],
                    subscribers=[],
                )
                self._sessions[server_id] = session
            session.url = url
            session.stop = False
            task = session.task
            if task is not None and not task.done():
                return
            session.task = loop.create_task(
                self._run(server_id),
                name=f"comfy-feed-{server_id}",
            )

    def drop(self, server_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(server_id, None)
            loop = self._loop
        if session is None:
            return
        session.stop = True
        self._signal_stop(loop, session)

    async def iter_events(
        self,
        server_id: str,
        *,
        save_node_only: bool,
        is_disconnected: DisconnectCheck,
    ):
        queue: asyncio.Queue = asyncio.Queue()
        with self._lock:
            session = self._sessions.get(server_id)
            if session is None:
                raise APIError(404, "not_found", "server not found")
            session.subscribers.append(queue)
            snapshot = self._snapshot_locked(session, save_node_only)
        seen = {item["id"] for item in snapshot["items"]}
        try:
            yield format_sse("snapshot", snapshot)
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    if await is_disconnected():
                        break
                    yield ": keepalive\n\n"
                    continue
                if message is None:
                    break
                if await is_disconnected():
                    break
                if message["kind"] == "status":
                    yield format_sse(
                        "status",
                        {"listening": message["listening"], "error": message["error"]},
                    )
                    continue
                image: ParsedImage = message["image"]
                if image.id in seen:
                    continue
                if not passes_save_node_only(image.image_type, image.node_class, save_node_only):
                    continue
                seen.add(image.id)
                yield format_sse("item", {"item": feed_item(server_id, image)})
        finally:
            with self._lock:
                current = self._sessions.get(server_id)
                if current is not None and queue in current.subscribers:
                    current.subscribers.remove(queue)

    async def fetch_view(
        self,
        server_url: str,
        filename: str,
        image_type: str,
        subfolder: str,
        preview: str | None,
    ) -> tuple[str, bytes]:
        upstream = comfy_view_url(server_url, filename, image_type, subfolder, preview)
        client = self._http_client()
        try:
            response = await client.get(upstream)
        except httpx.HTTPError as exc:
            raise APIError(502, "io_error", "comfy view unavailable") from exc
        return _view_result(response)

    async def shutdown(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
        tasks = [session.task for session in sessions if session.task is not None]
        for session in sessions:
            self.drop(session.server_id)
        for task in tasks:
            if task.done():
                continue
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.debug("comfy feed listener stopped", exc_info=True)
        http = self._http
        self._http = None
        if http is not None:
            await http.aclose()

    async def _run(self, server_id: str) -> None:
        delay = _CONNECT_BACKOFF_START
        try:
            while True:
                with self._lock:
                    session = self._sessions.get(server_id)
                    if session is None or session.stop:
                        return
                    url = session.url
                    client_id = session.client_id
                try:
                    ws_url = comfy_ws_url(url, client_id)
                    async with self.connector(ws_url) as socket:
                        self._mark(server_id, listening=True, error=None)
                        delay = _CONNECT_BACKOFF_START
                        async for raw in socket:
                            with self._lock:
                                session = self._sessions.get(server_id)
                                if session is None or session.stop:
                                    return
                            self._handle_raw(server_id, raw)
                except asyncio.CancelledError:
                    self._mark(server_id, listening=False, error=None)
                    raise
                except Exception as exc:
                    logger.warning(
                        "comfy feed listener failed for %s: %s",
                        server_id,
                        type(exc).__name__,
                    )
                    self._mark(server_id, listening=False, error="comfy websocket unavailable")
                with self._lock:
                    session = self._sessions.get(server_id)
                    if session is None or session.stop:
                        return
                await asyncio.sleep(delay)
                delay = min(delay * 2, _CONNECT_BACKOFF_MAX)
        except asyncio.CancelledError:
            self._mark(server_id, listening=False, error=None)
            raise

    def _handle_raw(self, server_id: str, raw: object) -> None:
        if isinstance(raw, (bytes, bytearray, memoryview)):
            return
        if not isinstance(raw, str):
            return
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return
        self.ingest_payload(server_id, payload)

    def _mark(self, server_id: str, *, listening: bool, error: str | None) -> None:
        with self._lock:
            session = self._sessions.get(server_id)
            if session is None:
                return
            session.listening = listening
            session.error = error
            subscribers = list(session.subscribers)
            loop = self._loop
        if not subscribers:
            return
        message = {"kind": "status", "listening": listening, "error": error}
        self._put_all(loop, subscribers, message)

    def _snapshot_locked(self, session: _Session, save_node_only: bool) -> dict:
        items = [
            feed_item(session.server_id, image)
            for image in session.items
            if passes_save_node_only(image.image_type, image.node_class, save_node_only)
        ]
        return {
            "items": items,
            "clientId": session.client_id,
            "listening": session.listening,
            "error": session.error,
        }

    def _http_client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                follow_redirects=False,
                timeout=httpx.Timeout(30.0, connect=5.0),
                headers={"User-Agent": "SeraFrame"},
            )
        return self._http

    def _publish_items(
        self,
        loop: asyncio.AbstractEventLoop | None,
        subscribers: list[asyncio.Queue],
        added: list[tuple[ParsedImage, dict[str, str]]],
    ) -> None:
        for image, _item in added:
            self._put_all(loop, subscribers, {"kind": "item", "image": image})

    def _put_all(
        self,
        loop: asyncio.AbstractEventLoop | None,
        subscribers: list[asyncio.Queue],
        message: dict,
    ) -> None:
        def _put() -> None:
            for queue in subscribers:
                try:
                    queue.put_nowait(message)
                except asyncio.QueueFull:
                    pass

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is not None and running is loop:
            _put()
            return
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(_put)
            return
        _put()

    def _signal_stop(self, loop: asyncio.AbstractEventLoop | None, session: _Session) -> None:
        def _stop() -> None:
            task = session.task
            if task is not None and not task.done():
                task.cancel()
            for queue in list(session.subscribers):
                try:
                    queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass

        if loop is not None and loop.is_running():
            try:
                if asyncio.get_running_loop() is loop:
                    _stop()
                    return
            except RuntimeError:
                pass
            loop.call_soon_threadsafe(_stop)
            return
        _stop()


def _executed_detail(payload: object) -> dict | None:
    if not isinstance(payload, dict):
        return None
    kind = payload.get("type")
    data = payload.get("data")
    if kind == "executed" and isinstance(data, dict):
        return data
    if kind is None and isinstance(payload.get("output"), dict):
        return payload
    return None


def _node_class(source: dict) -> str | None:
    for key in ("class_type", "classType", "node_type", "nodeType"):
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _as_text(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return None


def _query(pairs: list[tuple[str, str]]) -> str:
    return urlencode(pairs, quote_via=quote, safe="")


def _join_path(prefix: str, leaf: str) -> str:
    base = prefix.rstrip("/")
    return f"{base}/{leaf}" if base else f"/{leaf}"


def _has_traversal(value: str) -> bool:
    return any(part in {".", ".."} for part in value.split("/"))


def _preview_error(preview: str) -> APIError | None:
    if not isinstance(preview, str) or not preview or len(preview) > 32:
        return APIError(400, "validation", "preview must be webp or jpeg")
    kind, separator, quality = preview.partition(";")
    if kind not in {"webp", "jpeg"}:
        return APIError(400, "validation", "preview must be webp or jpeg")
    if not separator:
        return None
    if not quality.isdigit() or not 1 <= int(quality) <= 100:
        return APIError(400, "validation", "preview quality must be 1 to 100")
    return None


def _view_result(response: httpx.Response) -> tuple[str, bytes]:
    status = response.status_code
    if status == 404:
        raise APIError(404, "not_found", "image not found")
    if status in {301, 302, 303, 307, 308}:
        raise APIError(502, "io_error", "comfy view unavailable")
    if status in {400, 403}:
        raise APIError(400, "path_rejected", "path rejected")
    if status != 200:
        raise APIError(502, "io_error", "comfy view unavailable")
    body = response.content
    if len(body) > _VIEW_MAX_BYTES:
        raise APIError(502, "io_error", "comfy view unavailable")
    return _safe_media_type(response.headers.get("content-type", "")), body


def _safe_media_type(header: str) -> str:
    media = header.split(";", 1)[0].strip().lower()
    if media.startswith("image/") and media != "image/svg+xml":
        return media
    return "application/octet-stream"
