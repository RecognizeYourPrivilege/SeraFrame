"""The API serves the built SPA without taking over /api."""

from fastapi.testclient import TestClient


def test_root_serves_login_shell_and_api_stays_json(client: TestClient, tmp_path, monkeypatch):
    spa = tmp_path / "spa"
    (spa / "assets").mkdir(parents=True)
    (spa / "index.html").write_text(
        "<!doctype html><title>SeraFrame</title><div id=\"root\"></div>",
        encoding="utf-8",
    )
    (spa / "assets" / "app.js").write_text("/* Sign in */", encoding="utf-8")
    monkeypatch.setenv("SERAFRAME_SPA_DIR", str(spa))

    root = client.get("/")
    assert root.status_code == 200
    assert "text/html" in root.headers["content-type"]
    assert 'id="root"' in root.text

    route = client.get("/gallery")
    assert route.status_code == 200
    assert 'id="root"' in route.text

    asset = client.get("/assets/app.js")
    assert asset.status_code == 200
    assert "Sign in" in asset.text

    missing = client.get("/assets/missing.js")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"

    escaped = client.get("/assets/../../secret.txt")
    assert escaped.status_code == 404

    unknown_api = client.get("/api/does-not-exist")
    assert unknown_api.status_code == 404
    assert unknown_api.json()["error"]["code"] == "not_found"

    me = client.get("/api/auth/me")
    assert me.status_code == 401
    assert me.json()["error"]["code"] == "unauthorized"
