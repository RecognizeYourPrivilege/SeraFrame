import asyncssh

from tests.conftest import csrf_headers, login


def test_sftp_secrets_are_encrypted_and_omitted_from_get(client, tmp_path):
    assert login(client).status_code == 200
    key = asyncssh.generate_private_key("ssh-ed25519")
    private_key = key.export_private_key("openssh").decode()
    password = "s3cret-password"
    created = client.post(
        "/api/sources",
        json={
            "type": "sftp",
            "host": "files.example",
            "username": "alice",
            "remotePath": "/srv/stills",
            "password": password,
            "privateKey": private_key,
            "label": "Remote",
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    source = created.json()["source"]
    assert source["type"] == "sftp"
    assert source["port"] == 22
    assert source["hasPassword"] is True
    assert source["hasPrivateKey"] is True
    assert password not in created.text
    assert "OPENSSH PRIVATE KEY" not in created.text

    listed = client.get("/api/sources")
    assert password not in listed.text
    assert "OPENSSH PRIVATE KEY" not in listed.text
    assert listed.json()["sources"][0]["remotePath"] == "/srv/stills"

    database = b"".join(path.read_bytes() for path in (tmp_path / "data").glob("seraframe.sqlite*"))
    assert password.encode() not in database
    assert b"OPENSSH PRIVATE KEY" not in database

    neither = client.post(
        "/api/sources",
        json={
            "type": "sftp",
            "host": "files.example",
            "username": "alice",
            "remotePath": "/srv/stills",
        },
        headers=csrf_headers(client),
    )
    assert neither.status_code == 400
    assert neither.json()["error"]["code"] == "validation"

    relative = client.post(
        "/api/sources",
        json={"type": "local", "rootPath": "relative/path"},
        headers=csrf_headers(client),
    )
    assert relative.status_code == 400
    assert relative.json()["error"]["code"] == "validation"


def test_server_crud(client):
    assert login(client).status_code == 200
    created = client.post(
        "/api/servers",
        json={"name": "Comfy", "url": "https://gpu.example/comfy"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    server = created.json()["server"]
    listed = client.get("/api/servers")
    assert listed.json()["servers"] == [server]
    deleted = client.delete(f"/api/servers/{server['id']}", headers=csrf_headers(client))
    assert deleted.json() == {"ok": True}
    assert client.get("/api/servers").json() == {"servers": []}
    missing = client.delete(f"/api/servers/{server['id']}", headers=csrf_headers(client))
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
