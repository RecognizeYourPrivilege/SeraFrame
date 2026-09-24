# SeraFrame

Backend for browsing stills from local directories and SFTP, plus a list of ComfyUI server URLs. The HTTP contract is [INTEGRATION_CONTRACT_v1.md](INTEGRATION_CONTRACT_v1.md). Infrastructure notes are in [INFRASTRUCTURE_LEDGER.md](INFRASTRUCTURE_LEDGER.md).

`GET /` is a placeholder page. The browser UI is a separate frontend.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SERAFRAME_ADMIN_PASSWORD` | yes | | Single admin password. Hashed with Argon2 on first boot if no admin row exists. |
| `SERAFRAME_SECRET_KEY` | yes | | At least 32 bytes. Derives the Fernet key for SFTP secrets. |
| `SERAFRAME_DATA_DIR` | no | `/data` | SQLite database and thumbnail cache. |
| `SERAFRAME_PORT` | no | `8080` | Listen port. |
| `SERAFRAME_TRUST_PROXY` | no | `0` | Set to `1` when HTTPS is terminated in front of the process. Session and CSRF cookies are then marked `Secure`. |

Copy `.env.example` to `.env` and replace both secrets. Generate a key with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Changing `SERAFRAME_ADMIN_PASSWORD` does not update an existing database. Delete `/data/seraframe.sqlite` to bootstrap again. That also removes saved sources and servers.

## Run with Docker

```bash
docker compose build
docker compose up
```

The API listens on port 8080. SQLite and thumbnails persist in the `seraframe-data` volume, mounted at `/data`.

```bash
curl -sS http://127.0.0.1:8080/api/auth/csrf
```

Login is `POST /api/auth/login` with JSON `{"password":"..."}` and header `X-CSRF-Token` set to the token from the csrf response. The `seraframe_csrf` cookie must be sent with that request.

## Run locally

Python 3.12:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
export SERAFRAME_ADMIN_PASSWORD='change-me'
export SERAFRAME_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export SERAFRAME_DATA_DIR=./data
export SERAFRAME_PORT=8080
export SERAFRAME_TRUST_PROXY=0
uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8080
```

## Tests

```bash
pytest
```

## v1 scope

Sources are local directories or SFTP. Paths are sandboxed. SFTP passwords and private keys are encrypted at rest and are not returned by GET. Thumbnails are generated on demand and cached under the data directory. ComfyUI servers are name and URL only. This service does not proxy ComfyUI, write to sources, or speak FTP.
