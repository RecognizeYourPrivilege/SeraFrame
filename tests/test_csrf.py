from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import PASSWORD, csrf_headers, login


def test_mutating_requests_require_matching_csrf_cookie(client):
    missing = client.post("/api/auth/login", json={"password": PASSWORD})
    assert missing.status_code == 403
    assert missing.json()["error"]["code"] == "csrf"

    issued = client.get("/api/auth/csrf")
    token = issued.json()["csrfToken"]
    cookie = issued.headers["set-cookie"]
    assert "seraframe_csrf=" in cookie
    assert "HttpOnly" not in cookie
    assert "samesite=lax" in cookie.lower()

    mismatched = client.post(
        "/api/auth/login",
        json={"password": PASSWORD},
        headers={"X-CSRF-Token": "not-the-cookie-token"},
    )
    assert mismatched.status_code == 403
    assert mismatched.json()["error"]["code"] == "csrf"

    client.cookies.clear()
    no_cookie = client.post(
        "/api/auth/login",
        json={"password": PASSWORD},
        headers={"X-CSRF-Token": token},
    )
    assert no_cookie.status_code == 403
    assert no_cookie.json()["error"]["code"] == "csrf"

    ok = login(client, PASSWORD)
    assert ok.status_code == 200

    blocked = client.post("/api/servers", json={"name": "a", "url": "http://127.0.0.1:8188"})
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "csrf"

    created = client.post(
        "/api/servers",
        json={"name": "local", "url": "http://127.0.0.1:8188"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    assert created.json()["server"]["url"] == "http://127.0.0.1:8188"


def test_secure_cookies_when_proxy_is_trusted(tmp_path, monkeypatch):
    monkeypatch.setenv("SERAFRAME_ADMIN_PASSWORD", PASSWORD)
    monkeypatch.setenv("SERAFRAME_SECRET_KEY", "k" * 32)
    monkeypatch.setenv("SERAFRAME_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SERAFRAME_TRUST_PROXY", "1")
    with TestClient(create_app()) as proxied:
        response = proxied.get("/api/auth/csrf")
        assert "secure" in response.headers["set-cookie"].lower()


def test_bad_server_url_is_validation(client):
    assert login(client).status_code == 200
    response = client.post(
        "/api/servers",
        json={"name": "nope", "url": "javascript:alert(1)"},
        headers=csrf_headers(client),
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation"
