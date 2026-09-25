"""Live Comfy session feed: executed → FeedItem, and auth on the new routes."""

import asyncio
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from tests.conftest import csrf_headers, login

EXECUTED = {
    "type": "executed",
    "data": {
        "node": "9",
        "prompt_id": "prompt-1",
        "output": {
            "images": [
                {"filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output"},
                {"filename": "preview.png", "subfolder": "temps", "type": "temp"},
            ]
        },
    },
}


def _event(filename: str, *, prompt_id: str = "prompt-1", node: str = "9", image_type: str = "output", subfolder: str = ""):
    return {
        "type": "executed",
        "data": {
            "node": node,
            "prompt_id": prompt_id,
            "output": {
                "images": [
                    {"filename": filename, "subfolder": subfolder, "type": image_type},
                ]
            },
        },
    }


class _HoldSocket:
    """Comfy socket stand-in. Never dials out."""

    def __init__(self, frames=None):
        self._frames = list(frames or [])

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._frames:
            return self._frames.pop(0)
        await asyncio.sleep(3600)
        raise StopAsyncIteration


def _hold_connector(url: str):
    socket = _HoldSocket()
    socket.url = url
    return socket


def _create_server(client, url="http://127.0.0.1:8188"):
    created = client.post(
        "/api/servers",
        json={"name": "Comfy", "url": url},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    return created.json()["server"]


def _block_network(client):
    client.app.state.comfy_feed.connector = _hold_connector


def test_occurrence_id_is_stable_and_changes_with_each_part():
    from app.comfy_feed import occurrence_id

    material = "prompt-1\x009\x000\x00ComfyUI_00001_.png\x00\x00output"
    expected = hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]
    assert occurrence_id("prompt-1", "9", 0, "ComfyUI_00001_.png", "", "output") == expected
    assert occurrence_id("prompt-1", "9", 0, "ComfyUI_00001_.png", "", "output") == expected
    assert occurrence_id("prompt-2", "9", 0, "ComfyUI_00001_.png", "", "output") != expected
    assert occurrence_id("prompt-1", "10", 0, "ComfyUI_00001_.png", "", "output") != expected
    assert occurrence_id("prompt-1", "9", 1, "ComfyUI_00001_.png", "", "output") != expected
    assert occurrence_id("prompt-1", "9", 0, "other.png", "", "output") != expected
    assert occurrence_id("prompt-1", "9", 0, "ComfyUI_00001_.png", "sub", "output") != expected
    assert occurrence_id("prompt-1", "9", 0, "ComfyUI_00001_.png", "", "temp") != expected


def test_executed_event_maps_to_feed_items_and_filters():
    from app.comfy_feed import feed_item, parse_executed_images, passes_save_node_only

    images = parse_executed_images(EXECUTED)
    assert [image.filename for image in images] == ["ComfyUI_00001_.png", "preview.png"]
    assert images[0].id != images[1].id
    save = feed_item("server-1", images[0])
    preview = feed_item("server-1", images[1])
    assert set(save) == {"id", "name", "thumbUrl", "fullUrl"}
    assert save["name"] == "ComfyUI_00001_.png"
    assert save["id"] == images[0].id
    assert save["thumbUrl"] == (
        "/api/servers/server-1/view?filename=ComfyUI_00001_.png&type=output&subfolder=&preview=webp%3B90"
    )
    assert save["fullUrl"] == (
        "/api/servers/server-1/view?filename=ComfyUI_00001_.png&type=output&subfolder="
    )
    assert "preview=" not in preview["fullUrl"]
    assert "filename=preview.png" in preview["thumbUrl"]
    assert "type=temp" in preview["thumbUrl"]
    assert "subfolder=temps" in preview["thumbUrl"]
    assert preview["name"] == "preview.png"

    assert passes_save_node_only("temp", None, False)
    assert passes_save_node_only("output", None, False)
    assert passes_save_node_only("output", None, True)
    assert not passes_save_node_only("temp", None, True)
    assert not passes_save_node_only("output", "PreviewImage", True)
    assert passes_save_node_only("temp", "SaveImage", True)
    assert not passes_save_node_only("output", "PreviewImage", True)

    detail_only = EXECUTED["data"]
    assert [image.filename for image in parse_executed_images(detail_only)] == [
        "ComfyUI_00001_.png",
        "preview.png",
    ]
    assert parse_executed_images({"type": "status", "data": {"status": {}}}) == []
    assert parse_executed_images({"type": "executed", "data": {"node": "1", "output": {}}}) == []

    classed = {
        "type": "executed",
        "data": {
            "node": "4",
            "class_type": "PreviewImage",
            "prompt_id": "p",
            "output": {"images": [{"filename": "p.png", "subfolder": "", "type": "output"}]},
        },
    }
    parsed = parse_executed_images(classed)
    assert parsed[0].node_class == "PreviewImage"
    assert not passes_save_node_only(parsed[0].image_type, parsed[0].node_class, True)

    grouped = _event("inner.png", node="12:34")
    assert parse_executed_images(grouped)[0].node_id == "12:34"
    spaced = parse_executed_images(_event("my file.png", subfolder="a b"))[0]
    urls = feed_item("sid", spaced)
    assert "filename=my%20file.png" in urls["fullUrl"]
    assert "subfolder=a%20b" in urls["fullUrl"]

    missing_type = {
        "type": "executed",
        "data": {
            "node": "1",
            "prompt_id": "p",
            "output": {"images": [{"filename": "a.png", "subfolder": ""}]},
        },
    }
    assert parse_executed_images(missing_type)[0].image_type == "output"
    poisoned = _event("../secret.png")
    assert parse_executed_images(poisoned) == []


def test_comfy_urls_keep_a_path_prefix():
    from app.comfy_feed import comfy_view_url, comfy_ws_url

    assert comfy_ws_url("http://127.0.0.1:8188", "abc") == "ws://127.0.0.1:8188/ws?clientId=abc"
    assert (
        comfy_ws_url("https://gpu.example/comfy/", "abc")
        == "wss://gpu.example/comfy/ws?clientId=abc"
    )
    assert (
        comfy_view_url("http://127.0.0.1:8188/", "a.png", "output", "", None)
        == "http://127.0.0.1:8188/view?filename=a.png&type=output&subfolder="
    )
    assert (
        comfy_view_url("https://gpu.example/comfy", "a.png", "temp", "s", "webp;90")
        == "https://gpu.example/comfy/view?filename=a.png&type=temp&subfolder=s&preview=webp%3B90"
    )


def test_trim_drops_oldest_occurrences():
    from app.comfy_feed import ComfyFeedService

    service = ComfyFeedService(max_items=2, connector=_hold_connector)
    service.ingest_payload("s", _event("a.png", prompt_id="1"))
    service.ingest_payload("s", _event("b.png", prompt_id="2"))
    service.ingest_payload("s", _event("c.png", prompt_id="3"))
    service.ingest_payload("s", _event("b.png", prompt_id="2"))
    names = [item["name"] for item in service.snapshot("s", save_node_only=False)["items"]]
    assert names == ["b.png", "c.png"]


def test_listener_ingests_executed_frames():
    from app.comfy_feed import ComfyFeedService

    frames = [
        b"\x01\x02binary-preview",
        "not-json",
        json.dumps({"type": "status", "data": {}}),
        json.dumps(EXECUTED),
    ]
    seen = {}

    def connector(url):
        seen["url"] = url
        return _HoldSocket(frames)

    service = ComfyFeedService(connector=connector)

    async def run():
        try:
            await service.ensure_listening("server-1", "http://127.0.0.1:8188/prefix")
            snap = {}
            for _ in range(50):
                snap = service.snapshot("server-1", save_node_only=False)
                if len(snap["items"]) == 2 and snap["listening"]:
                    break
                await asyncio.sleep(0.01)
            else:
                raise AssertionError(snap)
            assert seen["url"] == f"ws://127.0.0.1:8188/prefix/ws?clientId={snap['clientId']}"
            assert [item["name"] for item in snap["items"]] == ["ComfyUI_00001_.png", "preview.png"]
            filtered = service.snapshot("server-1", save_node_only=True)
            assert [item["name"] for item in filtered["items"]] == ["ComfyUI_00001_.png"]
        finally:
            await service.shutdown()

    asyncio.run(run())


def test_event_stream_emits_snapshot_then_new_item():
    from app.comfy_feed import ComfyFeedService

    service = ComfyFeedService(connector=_hold_connector)

    async def disconnected():
        return False

    async def run():
        service.ingest_payload("server-1", EXECUTED)

        async def collect(save_node_only: bool, follow_up: dict):
            generator = service.iter_events(
                "server-1",
                save_node_only=save_node_only,
                is_disconnected=disconnected,
            )
            first = await anext(generator)

            async def later():
                await asyncio.sleep(0.01)
                service.ingest_payload("server-1", follow_up)

            task = asyncio.create_task(later())
            second = await asyncio.wait_for(anext(generator), timeout=1)
            await task
            await generator.aclose()
            return first, second

        snapshot, item = await collect(False, _event("next.png", prompt_id="prompt-2"))
        assert snapshot.startswith("event: snapshot\n")
        payload = json.loads(snapshot.split("data: ", 1)[1].strip())
        assert [entry["name"] for entry in payload["items"]] == [
            "ComfyUI_00001_.png",
            "preview.png",
        ]
        assert item.startswith("event: item\n")
        added = json.loads(item.split("data: ", 1)[1].strip())
        assert added["item"]["name"] == "next.png"

        filtered, nxt = await collect(
            True,
            {
                "type": "executed",
                "data": {
                    "node": "3",
                    "prompt_id": "prompt-3",
                    "output": {
                        "images": [
                            {"filename": "skip.png", "subfolder": "", "type": "temp"},
                            {"filename": "kept.png", "subfolder": "", "type": "output"},
                        ]
                    },
                },
            },
        )
        body = json.loads(filtered.split("data: ", 1)[1].strip())
        assert [entry["name"] for entry in body["items"]] == ["ComfyUI_00001_.png", "next.png"]
        nxt_body = json.loads(nxt.split("data: ", 1)[1].strip())
        assert nxt_body["item"]["name"] == "kept.png"
        await service.shutdown()

    asyncio.run(run())


def test_feed_routes_require_a_session(client):
    missing = "00000000-0000-0000-0000-000000000000"
    probes = [
        f"/api/servers/{missing}/feed",
        f"/api/servers/{missing}/feed/events",
        f"/api/servers/{missing}/view?filename=a.png&type=output&subfolder=",
    ]
    for url in probes:
        response = client.get(url)
        assert response.status_code == 401, url
        assert response.json()["error"]["code"] == "unauthorized"


def test_feed_snapshot_auth_shape_and_save_node_filter(client):
    assert login(client).status_code == 200
    server = _create_server(client)
    _block_network(client)
    unknown = client.get(f"/api/servers/{server['id']}-nope/feed")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["message"] == "server not found"

    service = client.app.state.comfy_feed
    service.ingest_payload(server["id"], EXECUTED)
    response = client.get(f"/api/servers/{server['id']}/feed")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"items", "clientId", "listening", "error"}
    assert len(body["clientId"]) == 32
    assert isinstance(body["listening"], bool)
    assert [item["name"] for item in body["items"]] == ["ComfyUI_00001_.png", "preview.png"]
    assert set(body["items"][0]) == {"id", "name", "thumbUrl", "fullUrl"}
    again = client.get(f"/api/servers/{server['id']}/feed")
    assert again.json()["clientId"] == body["clientId"]
    assert len(again.json()["items"]) == 2

    filtered = client.get(f"/api/servers/{server['id']}/feed", params={"saveNodeOnly": "true"})
    assert [item["name"] for item in filtered.json()["items"]] == ["ComfyUI_00001_.png"]

    deleted = client.delete(f"/api/servers/{server['id']}", headers=csrf_headers(client))
    assert deleted.status_code == 200
    assert service.snapshot(server["id"], save_node_only=False)["items"] == []
    assert client.get(f"/api/servers/{server['id']}/feed").status_code == 404


def test_view_proxies_only_feed_occurrences(client):
    assert login(client).status_code == 200
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.path)
            if self.path.startswith("/view?") and "filename=ComfyUI_00001_.png" in self.path:
                body = b"png-bytes"
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if "missing.png" in self.path:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(500)
            self.end_headers()

        def log_message(self, fmt, *args):
            return

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        port = httpd.server_address[1]
        server = _create_server(client, f"http://127.0.0.1:{port}")
        _block_network(client)
        service = client.app.state.comfy_feed
        service.ingest_payload(server["id"], _event("my file.png", subfolder="a/b"))
        service.ingest_payload(server["id"], EXECUTED)
        feed = client.get(f"/api/servers/{server['id']}/feed").json()
        full = next(item["fullUrl"] for item in feed["items"] if item["name"] == "ComfyUI_00001_.png")
        thumb = next(item["thumbUrl"] for item in feed["items"] if item["name"] == "ComfyUI_00001_.png")
        assert full.startswith(f"/api/servers/{server['id']}/view?")
        proxied = client.get(full)
        assert proxied.status_code == 200, proxied.text
        assert proxied.content == b"png-bytes"
        assert proxied.headers["content-type"].startswith("image/png")
        assert proxied.headers["x-content-type-options"] == "nosniff"
        assert any(
            path.startswith("/view?") and "filename=ComfyUI_00001_.png" in path and "preview=" not in path
            for path in seen
        )
        preview = client.get(thumb)
        assert preview.status_code == 200
        assert any("preview=webp%3B90" in path or "preview=webp;90" in path for path in seen)

        other = client.get(
            f"/api/servers/{server['id']}/view",
            params={"filename": "not-in-feed.png", "type": "output", "subfolder": ""},
        )
        assert other.status_code == 404
        assert other.json()["error"]["message"] == "image not found"
        assert not any("not-in-feed.png" in path for path in seen)

        escaped = client.get(
            f"/api/servers/{server['id']}/view",
            params={"filename": "../secret.png", "type": "output", "subfolder": ""},
        )
        assert escaped.status_code == 400
        assert escaped.json()["error"]["code"] == "path_rejected"
        assert not any("secret.png" in path for path in seen)

        bad_type = client.get(
            f"/api/servers/{server['id']}/view",
            params={"filename": "ComfyUI_00001_.png", "type": "anywhere", "subfolder": ""},
        )
        assert bad_type.status_code == 400
        assert bad_type.json()["error"]["code"] == "validation"
    finally:
        httpd.shutdown()


def test_view_does_not_follow_redirects_and_reports_upstream_failure(client):
    assert login(client).status_code == 200

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:9/followed")
            self.end_headers()

        def log_message(self, fmt, *args):
            return

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    thread = Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        port = httpd.server_address[1]
        server = _create_server(client, f"http://127.0.0.1:{port}/comfy")
        service = client.app.state.comfy_feed
        service.ingest_payload(server["id"], _event("ComfyUI_00001_.png"))
        response = client.get(
            f"/api/servers/{server['id']}/view",
            params={"filename": "ComfyUI_00001_.png", "type": "output", "subfolder": ""},
        )
        assert response.status_code == 502
        assert response.json()["error"] == {
            "code": "io_error",
            "message": "comfy view unavailable",
        }
    finally:
        httpd.shutdown()

    down = _create_server(client, "http://127.0.0.1:1")
    client.app.state.comfy_feed.ingest_payload(down["id"], _event("ComfyUI_00001_.png"))
    failed = client.get(
        f"/api/servers/{down['id']}/view",
        params={"filename": "ComfyUI_00001_.png", "type": "output", "subfolder": ""},
    )
    assert failed.status_code == 502
    assert failed.json()["error"]["code"] == "io_error"


def test_feed_events_http_snapshot(client):
    assert login(client).status_code == 200
    server = _create_server(client)
    _block_network(client)
    client.app.state.comfy_feed.ingest_payload(server["id"], EXECUTED)
    with client.stream("GET", f"/api/servers/{server['id']}/feed/events", timeout=5) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        text = ""
        for chunk in response.iter_text():
            text += chunk
            if "\n\n" in text:
                break
    assert text.startswith("event: snapshot\n")
    payload = json.loads(text.split("data: ", 1)[1].split("\n", 1)[0])
    assert [item["name"] for item in payload["items"]] == ["ComfyUI_00001_.png", "preview.png"]
