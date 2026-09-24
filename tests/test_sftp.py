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
