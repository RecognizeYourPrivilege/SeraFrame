"""Secret-key persistence and required admin password."""

import os

import pytest
from fastapi.testclient import TestClient

from app.config import SECRET_KEY_FILENAME, load_settings
from app.main import create_app
from tests.conftest import PASSWORD, login

PERSISTED = "persisted-secret-key-value-at-least-32-bytes\n"
ENV_SECRET = "environment-secret-key-must-be-32-bytes!"


def stat_mode(path):
    return path.stat().st_mode & 0o777


def _prepare(monkeypatch, data_dir, password=PASSWORD, secret=None):
    monkeypatch.setenv("SERAFRAME_DATA_DIR", str(data_dir))
    monkeypatch.setenv("SERAFRAME_PORT", "8080")
    monkeypatch.setenv("SERAFRAME_TRUST_PROXY", "0")
    if password is None:
        monkeypatch.delenv("SERAFRAME_ADMIN_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("SERAFRAME_ADMIN_PASSWORD", password)
    if secret is None:
        monkeypatch.delenv("SERAFRAME_SECRET_KEY", raising=False)
    else:
        monkeypatch.setenv("SERAFRAME_SECRET_KEY", secret)


def _secret_path(data_dir):
    return data_dir / SECRET_KEY_FILENAME


def test_missing_admin_password_fails_without_writing_secret(tmp_path, monkeypatch):
    data = tmp_path / "data"
    _prepare(monkeypatch, data, password=None)
    with pytest.raises(RuntimeError, match="SERAFRAME_ADMIN_PASSWORD is required"):
        load_settings()
    assert not data.exists()


def test_empty_admin_password_fails_without_writing_secret(tmp_path, monkeypatch):
    data = tmp_path / "data"
    _prepare(monkeypatch, data, password="")
    with pytest.raises(RuntimeError, match="SERAFRAME_ADMIN_PASSWORD is required"):
        load_settings()
    assert not data.exists()


def test_whitespace_admin_password_fails_without_writing_secret(tmp_path, monkeypatch):
    data = tmp_path / "data"
    _prepare(monkeypatch, data, password=" \t")
    with pytest.raises(RuntimeError, match="SERAFRAME_ADMIN_PASSWORD is required"):
        load_settings()
    assert not data.exists()


def test_admin_password_is_kept_exactly(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path, password="  keep-spaces  ", secret=ENV_SECRET)
    settings = load_settings()
    assert settings.admin_password == "  keep-spaces  "


def test_generates_secret_file_and_reuses_it(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path)
    first = load_settings()
    path = _secret_path(tmp_path)
    raw = path.read_bytes()
    assert first.secret_key == raw.decode("utf-8").strip()
    assert len(first.secret_key.encode("utf-8")) >= 32
    assert stat_mode(path) == 0o600
    assert not list(tmp_path.glob(".secret_key.*.tmp"))

    second = load_settings()
    assert second.secret_key == first.secret_key
    assert path.read_bytes() == raw


def test_empty_secret_env_generates_and_reuses_file(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path, secret="")
    first = load_settings()
    path = _secret_path(tmp_path)
    assert path.is_file()
    assert load_settings().secret_key == first.secret_key


def test_distinct_data_dirs_get_distinct_keys(tmp_path, monkeypatch):
    left = tmp_path / "left"
    right = tmp_path / "right"
    _prepare(monkeypatch, left)
    left_key = load_settings().secret_key
    _prepare(monkeypatch, right)
    right_key = load_settings().secret_key
    assert left_key != right_key


def test_env_secret_is_used_and_existing_file_is_untouched(tmp_path, monkeypatch):
    path = _secret_path(tmp_path)
    path.write_bytes(PERSISTED.encode("utf-8"))
    os.chmod(path, 0o640)
    before = path.read_bytes()
    stamp = path.stat().st_mtime_ns
    _prepare(monkeypatch, tmp_path, secret=ENV_SECRET)
    settings = load_settings()
    assert settings.secret_key == ENV_SECRET
    assert path.read_bytes() == before
    assert path.stat().st_mtime_ns == stamp
    assert stat_mode(path) == 0o640


def test_env_secret_does_not_create_file(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path, secret=ENV_SECRET)
    settings = load_settings()
    assert settings.secret_key == ENV_SECRET
    assert not _secret_path(tmp_path).exists()


def test_short_env_secret_fails_and_leaves_file_alone(tmp_path, monkeypatch):
    path = _secret_path(tmp_path)
    path.write_text(PERSISTED, encoding="utf-8")
    before = path.read_bytes()
    _prepare(monkeypatch, tmp_path, secret="short-key")
    with pytest.raises(RuntimeError, match="SERAFRAME_SECRET_KEY must be at least 32 bytes"):
        load_settings()
    assert path.read_bytes() == before


def test_short_env_secret_does_not_create_file(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path, secret="short-key")
    with pytest.raises(RuntimeError, match="SERAFRAME_SECRET_KEY must be at least 32 bytes"):
        load_settings()
    assert not _secret_path(tmp_path).exists()


def test_short_persisted_secret_is_not_replaced(tmp_path, monkeypatch):
    path = _secret_path(tmp_path)
    path.write_text("too-short\n", encoding="utf-8")
    before = path.read_bytes()
    _prepare(monkeypatch, tmp_path)
    with pytest.raises(RuntimeError, match="refusing to replace it"):
        load_settings()
    assert path.read_bytes() == before


def test_invalid_persisted_secret_is_not_replaced(tmp_path, monkeypatch):
    path = _secret_path(tmp_path)
    path.write_bytes(b"\xff" * 40)
    before = path.read_bytes()
    _prepare(monkeypatch, tmp_path)
    with pytest.raises(RuntimeError, match="refusing to replace it"):
        load_settings()
    assert path.read_bytes() == before


def test_raced_persist_keeps_the_file_that_won(tmp_path, monkeypatch):
    path = _secret_path(tmp_path)

    def lose_the_race(src, dst):
        path.write_bytes(PERSISTED.encode("utf-8"))
        raise FileExistsError(dst)

    monkeypatch.setattr(os, "link", lose_the_race)
    _prepare(monkeypatch, tmp_path)
    settings = load_settings()
    assert settings.secret_key == PERSISTED.strip()
    assert path.read_bytes() == PERSISTED.encode("utf-8")
    assert not list(tmp_path.glob(".secret_key.*.tmp"))


def test_app_reuses_persisted_secret_across_boots(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path)
    with TestClient(create_app()) as client:
        assert login(client).status_code == 200
    path = _secret_path(tmp_path)
    stored = path.read_bytes()
    with TestClient(create_app()) as client:
        assert login(client).status_code == 200
        assert client.app.state.settings.secret_key == stored.decode("utf-8").strip()
    assert path.read_bytes() == stored
