from tests.conftest import PASSWORD, csrf_headers, login


def test_login_me_and_logout(client):
    denied = client.get("/api/auth/me")
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "unauthorized"

    wrong = login(client, "not-the-password")
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "unauthorized"

    ok = login(client, PASSWORD)
    assert ok.status_code == 200
    assert ok.json() == {"ok": True}
    session_cookie = ok.headers["set-cookie"]
    assert "seraframe_session=" in session_cookie
    assert "HttpOnly" in session_cookie
    assert "samesite=lax" in session_cookie.lower()

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"authenticated": True}

    logged_out = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert logged_out.status_code == 200
    assert logged_out.json() == {"ok": True}
    assert client.get("/api/auth/me").status_code == 401


def test_lockout_after_five_failures(client):
    for _ in range(4):
        response = login(client, "wrong-password")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    locked = login(client, "wrong-password")
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "locked_out"
    retry = int(locked.headers["Retry-After"])
    assert 1 <= retry <= 15 * 60

    still_locked = login(client, PASSWORD)
    assert still_locked.status_code == 429
    assert still_locked.json()["error"]["code"] == "locked_out"
    assert "Retry-After" in still_locked.headers


def test_successful_login_resets_failure_count(client):
    for _ in range(4):
        assert login(client, "wrong-password").status_code == 401
    assert login(client, PASSWORD).status_code == 200
    client.post("/api/auth/logout", headers=csrf_headers(client))

    for _ in range(4):
        response = login(client, "wrong-password")
        assert response.status_code == 401
    assert login(client, PASSWORD).status_code == 200
