# SeraFrame

Backend for browsing stills from local directories and SFTP, plus a list of ComfyUI server URLs. The HTTP contract is [INTEGRATION_CONTRACT_v1.md](INTEGRATION_CONTRACT_v1.md). Infrastructure notes are in [INFRASTRUCTURE_LEDGER.md](INFRASTRUCTURE_LEDGER.md).

The browser UI lives in `client/`. `npm run build` writes it to `client/dist`. The Docker image builds that bundle and the API serves it at `/`. `/api/*` is unchanged.

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

The app listens on port 8080. Open `http://127.0.0.1:8080/` for the login screen (same origin as `/api`). SQLite and thumbnails persist in the `seraframe-data` volume, mounted at `/data`. The image copies `client/dist` to `/app/spa` (`SERAFRAME_SPA_DIR`).

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

## FRONT (client UI)

The client is a Vite + React + TypeScript SPA in `client/`. Production output is `client/dist` (`build.outDir` in `client/vite.config.ts`). The image's Node stage runs `npm run build` and copies that directory to `/app/spa`. FastAPI serves those files for `GET /` and other non-`/api` paths, with `index.html` for extension-less client routes. It calls the routes in [INTEGRATION_CONTRACT_v1.md](INTEGRATION_CONTRACT_v1.md) as implemented in `app/main.py`. Notes on how the client uses that contract are in [docs/front-api-expectations.md](docs/front-api-expectations.md). The component map is [COMPONENT_LEDGER.md](COMPONENT_LEDGER.md).

`uvicorn` without `SERAFRAME_SPA_DIR` (and without a built `/app/spa`) still returns a short placeholder at `/`. Point `SERAFRAME_SPA_DIR` at `client/dist` after `npm run build` to serve the login UI the same way the image does.

### Run the UI

From the repo root:

```bash
npm install
npm run dev
```

Vite serves the app at `http://127.0.0.1:5173`. In development, MSW answers `/api` so the gallery works without the API process. Sign in with the demo password `seraframe-demo`. A reload clears the mock session.

To call the API on port 8080 instead of the mocks, create `client/.env.development.local`:

```bash
VITE_USE_MOCKS=false
```

The dev server then proxies `/api` to `http://127.0.0.1:8080`. Production builds never start the mock worker. Sign in with `SERAFRAME_ADMIN_PASSWORD`.

Mutating requests send `X-CSRF-Token`. The API accepts the call only when that header equals the `seraframe_csrf` cookie set by `GET /api/auth/csrf`. A `401` returns the UI to login. Gallery and server data are not rendered until `GET /api/auth/me` succeeds.
