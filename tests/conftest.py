import os

import pytest
from fastapi.testclient import TestClient

PASSWORD = "correct-horse-battery"
SECRET = "test-secret-key-must-be-at-least-32-bytes"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SERAFRAME_ADMIN_PASSWORD", PASSWORD)
    monkeypatch.setenv("SERAFRAME_SECRET_KEY", SECRET)
    monkeypatch.setenv("SERAFRAME_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SERAFRAME_TRUST_PROXY", "0")
    monkeypatch.setenv("SERAFRAME_PORT", "8080")
    from app.main import create_app

    application = create_app()
    with TestClient(application) as test_client:
        yield test_client


def csrf_headers(client: TestClient) -> dict[str, str]:
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200, response.text
    token = response.json()["csrfToken"]
    assert token
    assert client.cookies.get("seraframe_csrf") == token
    return {"X-CSRF-Token": token}


def login(client: TestClient, password: str = PASSWORD, headers: dict[str, str] | None = None):
    merged = csrf_headers(client)
    if headers:
        merged.update(headers)
    return client.post(
        "/api/auth/login",
        json={"password": password},
        headers=merged,
    )


def write_png(path, size=(32, 16), color=(20, 80, 200)):
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, format="PNG")
