"""Draft 2.1.4: change-password, session revoke, server Appearance (DoD 33–37)."""

import re
import sqlite3
import time

from fastapi.testclient import TestClient

from app.security import hash_password, verify_password
from tests.conftest import PASSWORD, SECRET, csrf_headers, login

NEW_PASSWORD = "replacement-horse-battery"
_ISO = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"


def _token(client: TestClient) -> str:
    matches = [
        cookie.value
        for cookie in client.cookies.jar
        if cookie.name == "seraframe_session" and cookie.domain == "testserver.local"
    ]
    assert len(matches) == 1
    return matches[0]


def _use(client: TestClient, token: str) -> None:
    client.cookies.set("seraframe_session", token, domain="testserver.local", path="/")


def test_dod33_change_password_rejects_wrong_current_and_revokes_other_sessions(client):
    assert login(client, headers={"User-Agent": "BrowserA/1.0"}).status_code == 200
    token_a = _token(client)
    assert login(client, headers={"User-Agent": "BrowserB/2.0"}).status_code == 200
    token_b = _token(client)
    assert token_a != token_b

    wrong = client.post(
        "/api/auth/change-password",
        json={"currentPassword": "not-the-password", "newPassword": NEW_PASSWORD},
        headers=csrf_headers(client),
    )
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "unauthorized"
    assert wrong.json()["error"]["message"] == "current password is incorrect"
    _use(client, token_a)
    assert client.get("/api/auth/me").status_code == 200
    _use(client, token_b)
    assert client.get("/api/auth/me").status_code == 200

    too_long = client.post(
        "/api/auth/change-password",
        json={"currentPassword": PASSWORD, "newPassword": "x" * 1025},
        headers=csrf_headers(client),
    )
    assert too_long.status_code == 400
    assert too_long.json()["error"]["code"] == "validation"
    stored = client.app.state.db.fetchone("SELECT password_hash FROM admin WHERE id = 1")
    assert verify_password(stored["password_hash"], PASSWORD)
    assert not verify_password(stored["password_hash"], NEW_PASSWORD)

    changed = client.post(
        "/api/auth/change-password",
        json={"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD},
        headers=csrf_headers(client),
    )
    assert changed.status_code == 200
    assert changed.json() == {"ok": True}
    assert _token(client) == token_b
    assert "seraframe_session=" not in changed.headers.get("set-cookie", "")
    assert client.get("/api/auth/me").json() == {"authenticated": True}

    _use(client, token_a)
    revoked = client.get("/api/auth/me")
    assert revoked.status_code == 401
    assert revoked.json()["error"]["code"] == "unauthorized"

    _use(client, token_b)
    listed = client.get("/api/auth/sessions")
    assert listed.status_code == 200
    sessions = listed.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["current"] is True
    assert sessions[0]["id"] != token_b
    assert token_b not in listed.text

    client.post("/api/auth/logout", headers=csrf_headers(client))
    assert login(client, PASSWORD).status_code == 401
    assert login(client, NEW_PASSWORD).status_code == 200

    restarted = client.app
    from app.main import create_app

    fresh = create_app()
    with TestClient(fresh) as other:
        assert login(other, PASSWORD).status_code == 401
        assert login(other, NEW_PASSWORD).status_code == 200
    assert restarted.state.db.fetchone("SELECT id FROM admin WHERE id = 1") is not None


def test_dod33_wrong_change_password_does_not_lock_login(client):
    assert login(client).status_code == 200
    for _ in range(4):
        response = client.post(
            "/api/auth/change-password",
            json={"currentPassword": "nope", "newPassword": NEW_PASSWORD},
            headers=csrf_headers(client),
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"
    client.post("/api/auth/logout", headers=csrf_headers(client))
    assert login(client, PASSWORD).status_code == 200


def test_dod34_revoke_other_session_and_reject_current(client):
    assert login(client, headers={"User-Agent": "BrowserA/1.0"}).status_code == 200
    token_a = _token(client)
    assert login(client, headers={"User-Agent": "BrowserB/2.0", "X-Forwarded-For": "203.0.113.9"}).status_code == 200
    token_b = _token(client)

    listed = client.get("/api/auth/sessions", headers={"User-Agent": "ListCaller/9"})
    assert listed.status_code == 200
    body = listed.json()
    assert set(body) == {"sessions"}
    sessions = body["sessions"]
    assert [item["userAgent"] for item in sessions] == ["BrowserA/1.0", "BrowserB/2.0"]
    assert all(item["ip"] == "testclient" for item in sessions)
    assert [item["current"] for item in sessions] == [False, True]
    for item in sessions:
        assert item["id"] not in {token_a, token_b}
        assert re.fullmatch(_ISO, item["createdAt"])
        assert re.fullmatch(_ISO, item["lastSeenAt"])
    by_agent = {item["userAgent"]: item for item in sessions}
    current_id = by_agent["BrowserB/2.0"]["id"]
    other_id = by_agent["BrowserA/1.0"]["id"]

    reject = client.delete(
        f"/api/auth/sessions/{current_id}",
        headers=csrf_headers(client),
    )
    assert reject.status_code == 400
    assert reject.json()["error"] == {
        "code": "validation",
        "message": "cannot revoke the current session",
    }
    assert client.get("/api/auth/me").status_code == 200

    missing = client.delete(
        "/api/auth/sessions/not-a-session",
        headers=csrf_headers(client),
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"

    disguised = client.delete(
        f"/api/auth/sessions/{token_a}",
        headers=csrf_headers(client),
    )
    assert disguised.status_code == 404

    revoked = client.delete(
        f"/api/auth/sessions/{other_id}",
        headers=csrf_headers(client),
    )
    assert revoked.status_code == 200
    assert revoked.json() == {"ok": True}
    remaining = client.get("/api/auth/sessions").json()["sessions"]
    assert [item["id"] for item in remaining] == [current_id]
    assert remaining[0]["current"] is True

    _use(client, token_a)
    assert client.get("/api/auth/me").status_code == 401
    _use(client, token_b)
    assert client.get("/api/auth/me").status_code == 200


def test_dod35_session_and_prefs_routes_require_auth(client):
    assert client.get("/api/auth/sessions").status_code == 401
    assert client.get("/api/prefs").status_code == 401
    assert client.get("/api/auth/me").json()["error"]["code"] == "unauthorized"

    no_session = client.post(
        "/api/auth/change-password",
        json={"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD},
        headers=csrf_headers(client),
    )
    assert no_session.status_code == 401
    assert no_session.json()["error"]["code"] == "unauthorized"

    delete_missing = client.delete(
        "/api/auth/sessions/whatever",
        headers=csrf_headers(client),
    )
    assert delete_missing.status_code == 401

    put_missing = client.put(
        "/api/prefs",
        json={"appearance": "dark", "firstRunAppearanceDone": True},
        headers=csrf_headers(client),
    )
    assert put_missing.status_code == 401
    assert put_missing.json()["error"]["code"] == "unauthorized"

    assert login(client).status_code == 200
    bare = client.post(
        "/api/auth/change-password",
        json={"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD},
    )
    assert bare.status_code == 403
    assert bare.json()["error"]["code"] == "csrf"
    assert verify_password(
        client.app.state.db.fetchone("SELECT password_hash FROM admin WHERE id = 1")["password_hash"],
        PASSWORD,
    )


def test_dod36_first_run_is_shared_across_sessions(client):
    assert login(client).status_code == 200
    initial = client.get("/api/prefs")
    assert initial.status_code == 200
    assert initial.json() == {"appearance": None, "firstRunAppearanceDone": False}
    assert client.get("/api/auth/me").json() == {"authenticated": True}
    assert "serversAutoHide" not in initial.text
    assert "showFullPhoto" not in initial.text
    assert "blurSensitiveThumbs" not in initial.text

    appearance_only = client.put(
        "/api/prefs",
        json={"appearance": "dark"},
        headers=csrf_headers(client),
    )
    assert appearance_only.status_code == 200
    assert appearance_only.json() == {"appearance": "dark", "firstRunAppearanceDone": False}

    incomplete = client.put(
        "/api/prefs",
        json={"firstRunAppearanceDone": True},
        headers=csrf_headers(client),
    )
    assert incomplete.status_code == 200
    assert incomplete.json() == {"appearance": "dark", "firstRunAppearanceDone": True}

    token_a = _token(client)
    client.cookies.clear()
    assert login(client).status_code == 200
    assert _token(client) != token_a
    seen = client.get("/api/prefs")
    assert seen.json() == {"appearance": "dark", "firstRunAppearanceDone": True}
    assert client.get("/api/auth/me").json() == {"authenticated": True}


def test_dod36_first_run_requires_an_appearance_when_unset(client):
    assert login(client).status_code == 200
    blocked = client.put(
        "/api/prefs",
        json={"firstRunAppearanceDone": True},
        headers=csrf_headers(client),
    )
    assert blocked.status_code == 400
    assert blocked.json()["error"] == {
        "code": "validation",
        "message": "appearance is required to finish first run",
    }
    assert client.get("/api/prefs").json() == {
        "appearance": None,
        "firstRunAppearanceDone": False,
    }

    finished = client.put(
        "/api/prefs",
        json={"appearance": "light", "firstRunAppearanceDone": True},
        headers=csrf_headers(client),
    )
    assert finished.status_code == 200
    assert finished.json() == {"appearance": "light", "firstRunAppearanceDone": True}

    client.cookies.clear()
    assert login(client).status_code == 200
    assert client.get("/api/prefs").json() == {
        "appearance": "light",
        "firstRunAppearanceDone": True,
    }


def test_dod37_appearance_persists_for_a_second_client(client):
    assert login(client).status_code == 200
    done = client.put(
        "/api/prefs",
        json={"appearance": "dark", "firstRunAppearanceDone": True},
        headers=csrf_headers(client),
    )
    assert done.status_code == 200
    updated = client.put(
        "/api/prefs",
        json={"appearance": "light"},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json() == {"appearance": "light", "firstRunAppearanceDone": True}

    row = client.app.state.db.fetchone(
        "SELECT appearance, first_run_appearance_done FROM admin WHERE id = 1"
    )
    assert row["appearance"] == "light"
    assert row["first_run_appearance_done"] == 1

    client.cookies.clear()
    assert login(client).status_code == 200
    assert client.get("/api/prefs").json() == {
        "appearance": "light",
        "firstRunAppearanceDone": True,
    }

    again = client.put(
        "/api/prefs",
        json={"appearance": "dark"},
        headers=csrf_headers(client),
    )
    assert again.json()["firstRunAppearanceDone"] is True
    assert again.json()["appearance"] == "dark"


def test_prefs_reject_client_only_fields_and_do_not_import_local_theme(client):
    assert login(client).status_code == 200
    for body in (
        {},
        {"theme": "light"},
        {"serversAutoHide": False},
        {"appearance": None},
        {"firstRunAppearanceDone": False},
        {"appearance": "neon"},
    ):
        response = client.put("/api/prefs", json=body, headers=csrf_headers(client))
        assert response.status_code == 400, body
        assert response.json()["error"]["code"] == "validation"
    assert client.get("/api/prefs").json() == {
        "appearance": None,
        "firstRunAppearanceDone": False,
    }


def test_expired_session_is_removed(client):
    assert login(client).status_code == 200
    with client.app.state.db.transaction() as conn:
        conn.execute("UPDATE sessions SET expires_at = ?", (time.time() - 5,))
    denied = client.get("/api/auth/me")
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "unauthorized"
    assert client.app.state.db.fetchone("SELECT token FROM sessions") is None


def test_last_seen_advances_and_login_user_agent_sticks(client):
    assert login(client, headers={"User-Agent": "BrowserA/1.0"}).status_code == 200
    with client.app.state.db.transaction() as conn:
        conn.execute("UPDATE sessions SET last_seen_at = ?", (1_700_000_000,))
    assert client.get("/api/auth/me", headers={"User-Agent": "Other/1"}).status_code == 200
    listed = client.get("/api/auth/sessions").json()["sessions"]
    assert len(listed) == 1
    assert listed[0]["userAgent"] == "BrowserA/1.0"
    assert listed[0]["lastSeenAt"] != "2023-11-14T22:13:20Z"
    stored = client.app.state.db.fetchone("SELECT last_seen_at FROM sessions")
    assert float(stored["last_seen_at"]) > 1_700_000_000


def test_trust_proxy_stores_forwarded_ip(client):
    from dataclasses import replace

    headers = csrf_headers(client)
    client.app.state.settings = replace(client.app.state.settings, trust_proxy=True)
    headers["X-Forwarded-For"] = "203.0.113.9, 10.0.0.8"
    headers["User-Agent"] = "BrowserA/1.0"
    ok = client.post("/api/auth/login", json={"password": PASSWORD}, headers=headers)
    assert ok.status_code == 200
    row = client.app.state.db.fetchone("SELECT ip, user_agent FROM sessions")
    assert row["ip"] == "203.0.113.9"
    assert row["user_agent"] == "BrowserA/1.0"


def test_legacy_sqlite_gains_columns_without_wiping_rows(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    database = data / "seraframe.sqlite"
    created = 1_700_000_000.0
    token = "legacy-session-token"
    stored_hash = hash_password(PASSWORD)
    with sqlite3.connect(database) as conn:
        conn.executescript(
            """
            CREATE TABLE admin (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                password_hash TEXT NOT NULL,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until REAL
            );
            CREATE TABLE sessions (
                token TEXT PRIMARY KEY,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            );
            CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                label TEXT NOT NULL,
                root_path TEXT,
                host TEXT,
                port INTEGER,
                username TEXT,
                remote_path TEXT,
                password_enc TEXT,
                private_key_enc TEXT,
                created_at REAL NOT NULL
            );
            CREATE TABLE servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE host_keys (
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                fingerprint TEXT NOT NULL,
                PRIMARY KEY (host, port)
            );
            """
        )
        conn.execute(
            """
            INSERT INTO admin (id, password_hash, failed_attempts, locked_until)
            VALUES (1, ?, 2, NULL)
            """,
            (stored_hash,),
        )
        conn.execute(
            "INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)",
            (token, created, time.time() + 86_400),
        )
        conn.execute(
            """
            INSERT INTO sources (id, type, label, root_path, created_at)
            VALUES ('src-1', 'local', 'Kept', '/opt/kept', ?)
            """,
            (created,),
        )
        conn.execute(
            """
            INSERT INTO servers (id, name, url, created_at)
            VALUES ('srv-1', 'Kept server', 'http://127.0.0.1:9', ?)
            """,
            (created,),
        )
        conn.execute(
            """
            INSERT INTO host_keys (host, port, fingerprint)
            VALUES ('example.test', 22, 'SHA256:kept')
            """
        )

    monkeypatch.setenv("SERAFRAME_ADMIN_PASSWORD", "env-password-should-not-replace")
    monkeypatch.setenv("SERAFRAME_SECRET_KEY", SECRET)
    monkeypatch.setenv("SERAFRAME_DATA_DIR", str(data))
    monkeypatch.setenv("SERAFRAME_TRUST_PROXY", "0")
    from app.main import create_app

    application = create_app()
    admin = application.state.db.fetchone(
        """
        SELECT password_hash, failed_attempts, appearance, first_run_appearance_done
        FROM admin WHERE id = 1
        """
    )
    assert admin["password_hash"] == stored_hash
    assert admin["failed_attempts"] == 2
    assert admin["appearance"] is None
    assert admin["first_run_appearance_done"] == 0
    legacy = application.state.db.fetchone(
        "SELECT id, token, last_seen_at, user_agent, ip FROM sessions WHERE token = ?",
        (token,),
    )
    assert legacy["id"] and legacy["id"] != token
    assert float(legacy["last_seen_at"]) == created
    assert legacy["user_agent"] is None
    assert application.state.db.fetchone("SELECT label FROM sources WHERE id = 'src-1'")["label"] == "Kept"
    assert application.state.db.fetchone("SELECT fingerprint FROM host_keys")["fingerprint"] == "SHA256:kept"

    with TestClient(application) as test_client:
        test_client.cookies.set("seraframe_session", token)
        assert test_client.get("/api/auth/me").json() == {"authenticated": True}
        prefs = test_client.get("/api/prefs")
        assert prefs.json() == {"appearance": None, "firstRunAppearanceDone": False}
        sources = test_client.get("/api/sources").json()["sources"]
        assert sources[0]["label"] == "Kept"
        sessions = test_client.get("/api/auth/sessions").json()["sessions"]
        assert len(sessions) == 1
        assert sessions[0]["id"] == legacy["id"]
        assert sessions[0]["current"] is True
        assert sessions[0]["createdAt"] == "2023-11-14T22:13:20Z"
        assert token not in test_client.get("/api/auth/sessions").text
