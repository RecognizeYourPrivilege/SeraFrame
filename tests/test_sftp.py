import asyncio
import threading

import asyncssh
import pytest

from tests.conftest import csrf_headers, login, write_png


class _PasswordServer(asyncssh.SSHServer):
    def password_auth_supported(self) -> bool:
        return True

    def validate_password(self, username: str, password: str) -> bool:
        return username == "alice" and password == "pw"


@pytest.fixture
def sftp_server(tmp_path):
    root = (tmp_path / "remote").resolve()
    root.mkdir()
    write_png(root / "frame.png", size=(80, 40), color=(0, 128, 0))
    outside = tmp_path / "outside.png"
    write_png(outside, size=(8, 8), color=(255, 0, 0))
    (root / "escape.png").symlink_to(outside)

    loop = asyncio.new_event_loop()
    holder: dict = {}

    def _run() -> None:
        asyncio.set_event_loop(loop)
        loop.run_forever()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    async def _start() -> None:
        host_key = asyncssh.generate_private_key("ssh-ed25519")
        server = await asyncssh.create_server(
            _PasswordServer,
            "127.0.0.1",
            0,
            server_host_keys=[host_key],
            sftp_factory=asyncssh.SFTPServer,
        )
        holder["server"] = server
        holder["port"] = server.sockets[0].getsockname()[1]

    asyncio.run_coroutine_threadsafe(_start(), loop).result(timeout=10)
    yield {"port": holder["port"], "root": root}

    async def _stop() -> None:
        holder["server"].close()
        await holder["server"].wait_closed()

    asyncio.run_coroutine_threadsafe(_stop(), loop).result(timeout=10)
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=5)


def test_sftp_lists_image_beside_symlink_loop(client, sftp_server):
    """A symlink loop must not fail the whole folder or stall the listing.

    The gallery stays on "Loading library…" until this request returns.
    """
    root = sftp_server["root"]
    (root / "loop1").symlink_to("loop2")
    (root / "loop2").symlink_to("loop1")
    (root / "album").mkdir()
    write_png(root / "album" / "nested.png", size=(16, 16), color=(10, 20, 30))

    assert login(client).status_code == 200
    created = client.post(
        "/api/sources",
        json={
            "type": "sftp",
            "host": "127.0.0.1",
            "port": sftp_server["port"],
            "username": "alice",
            "password": "pw",
            "remotePath": str(root),
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    source_id = created.json()["source"]["id"]

    stills = client.get(f"/api/sources/{source_id}/stills")
    assert stills.status_code == 200, stills.text
    assert [item["name"] for item in stills.json()["stills"]] == ["frame.png"]

    tree = client.get(f"/api/sources/{source_id}/tree")
    assert tree.status_code == 200, tree.text
    albums = [entry for entry in tree.json()["entries"] if entry["kind"] == "dir"]
    assert albums[0]["relPath"] == "album"
    nested = client.get(f"/api/sources/{source_id}/stills", params={"path": "album"})
    assert nested.status_code == 200, nested.text
    assert [item["name"] for item in nested.json()["stills"]] == ["nested.png"]


def test_sftp_listing_does_not_block_on_stat(client, tmp_path):
    """readdir already carries file type. stat() on one name must not wedge the list."""
    root = (tmp_path / "remote").resolve()
    root.mkdir()
    write_png(root / "frame.png", size=(8, 8), color=(1, 2, 3))
    write_png(root / "stall.png", size=(8, 8), color=(4, 5, 6))
    release = threading.Event()

    class _PasswordServer(asyncssh.SSHServer):
        def password_auth_supported(self) -> bool:
            return True

        def validate_password(self, username: str, password: str) -> bool:
            return username == "alice" and password == "pw"

    class _StallStatServer(asyncssh.SFTPServer):
        def stat(self, path: bytes):
            text = path.decode("utf-8", "surrogateescape")
            if text.endswith("/stall.png") or text.endswith("stall.png"):
                release.wait(30)
            return super().stat(path)

    loop = asyncio.new_event_loop()
    holder: dict = {}

    def _run() -> None:
        asyncio.set_event_loop(loop)
        loop.run_forever()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    async def _start() -> None:
        host_key = asyncssh.generate_private_key("ssh-ed25519")
        server = await asyncssh.create_server(
            _PasswordServer,
            "127.0.0.1",
            0,
            server_host_keys=[host_key],
            sftp_factory=_StallStatServer,
        )
        holder["server"] = server
        holder["port"] = server.sockets[0].getsockname()[1]

    asyncio.run_coroutine_threadsafe(_start(), loop).result(timeout=10)
    worker = threading.Thread()
    try:
        assert login(client).status_code == 200
        created = client.post(
            "/api/sources",
            json={
                "type": "sftp",
                "host": "127.0.0.1",
                "port": holder["port"],
                "username": "alice",
                "password": "pw",
                "remotePath": str(root),
            },
            headers=csrf_headers(client),
        )
        assert created.status_code == 201, created.text
        source_id = created.json()["source"]["id"]
        box: dict = {}

        def _fetch() -> None:
            box["response"] = client.get(f"/api/sources/{source_id}/stills")

        worker = threading.Thread(target=_fetch)
        worker.start()
        worker.join(5)
        assert not worker.is_alive(), "SFTP listing blocked on stat()"
        response = box["response"]
        assert response.status_code == 200, response.text
        assert "frame.png" in [item["name"] for item in response.json()["stills"]]
    finally:
        release.set()
        worker.join(35)

        async def _stop() -> None:
            holder["server"].close()
            await holder["server"].wait_closed()

        asyncio.run_coroutine_threadsafe(_stop(), loop).result(timeout=10)
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)


def test_sftp_lists_and_rejects_symlink_escape(client, sftp_server):
    assert login(client).status_code == 200
    created = client.post(
        "/api/sources",
        json={
            "type": "sftp",
            "host": "127.0.0.1",
            "port": sftp_server["port"],
            "username": "alice",
            "password": "pw",
            "remotePath": str(sftp_server["root"]),
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    source_id = created.json()["source"]["id"]

    stills = client.get(f"/api/sources/{source_id}/stills")
    assert stills.status_code == 200, stills.text
    names = [item["name"] for item in stills.json()["stills"]]
    assert names == ["frame.png"]

    thumb = client.get(f"/api/media/{source_id}/thumb", params={"path": "frame.png"})
    assert thumb.status_code == 200, thumb.text
    assert thumb.headers["content-type"].startswith("image/webp")

    escaped = client.get(f"/api/media/{source_id}/full", params={"path": "escape.png"})
    assert escaped.status_code == 400, escaped.text
    assert escaped.json()["error"]["code"] == "path_rejected"
