"""Default listen port and SERAFRAME_PORT override."""

import os
import subprocess

from app.config import load_settings
from tests.conftest import PASSWORD, SECRET


def _prepare(monkeypatch, data_dir):
    monkeypatch.setenv("SERAFRAME_ADMIN_PASSWORD", PASSWORD)
    monkeypatch.setenv("SERAFRAME_SECRET_KEY", SECRET)
    monkeypatch.setenv("SERAFRAME_DATA_DIR", str(data_dir))
    monkeypatch.delenv("SERAFRAME_PORT", raising=False)


def test_default_port_is_8081(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path)
    assert load_settings().port == 8081


def test_port_env_override(tmp_path, monkeypatch):
    _prepare(monkeypatch, tmp_path)
    monkeypatch.setenv("SERAFRAME_PORT", "8080")
    assert load_settings().port == 8080


def _entrypoint_port(tmp_path, port_env):
    tmp_path.mkdir(parents=True, exist_ok=True)
    bindir = tmp_path / "bin"
    bindir.mkdir()
    captured = tmp_path / "args"
    fake = bindir / "uvicorn"
    fake.write_text(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$SERAFRAME_UVICORN_ARGS\"\nexit 0\n"
    )
    fake.chmod(0o755)
    env = os.environ.copy()
    env["PATH"] = f"{bindir}{os.pathsep}{env.get('PATH', '')}"
    env["SERAFRAME_DATA_DIR"] = str(tmp_path / "data")
    env["SERAFRAME_UVICORN_ARGS"] = str(captured)
    env.pop("SERAFRAME_PORT", None)
    if port_env is not None:
        env["SERAFRAME_PORT"] = port_env
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    subprocess.run(
        ["sh", "docker/entrypoint.sh"],
        env=env,
        check=True,
        cwd=root,
    )
    args = captured.read_text().splitlines()
    return args[args.index("--port") + 1]


def test_entrypoint_default_port_is_8081(tmp_path):
    assert _entrypoint_port(tmp_path, None) == "8081"


def test_entrypoint_port_override_binds_requested_port(tmp_path):
    assert _entrypoint_port(tmp_path / "override-8080", "8080") == "8080"
    assert _entrypoint_port(tmp_path / "override-9099", "9099") == "9099"
