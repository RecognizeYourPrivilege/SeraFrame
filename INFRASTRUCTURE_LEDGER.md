# Infrastructure ledger

SeraFrame service, contract v1. This file records how the image is built, how HTTP is served, and where state is kept. It matches `main` baseline `6109125` plus the SPA bake on `054f4b0`.

## Runtime

- Image base: `debian:bookworm-slim`
- Python: 3.12.14, built from the upstream CPython tarball into `/usr/local`, then a virtualenv at `/opt/venv`. Bookworm's archive only ships Python 3.11.
- Process: `uvicorn app.main:create_app --factory --host 0.0.0.0 --port $SERAFRAME_PORT`
- User: `seraframe` (uid/gid 10001). The image sets `USER seraframe`. If the entrypoint is started as root, it chowns `SERAFRAME_DATA_DIR` and `exec`s `runuser` so the server is still non-root.
- Listen: `0.0.0.0:8080` (`SERAFRAME_PORT`)
- Compose service: `seraframe`, host port `8080`, restart `unless-stopped`
- Healthcheck: HTTP GET `/` inside the container. `/` is the SPA document, so a healthy container returns HTML 200.

## SPA bake

`Dockerfile` is multi-stage.

- Stage `spa` is `node:22-bookworm-slim` with `WORKDIR /src/client`. It copies `client/package.json` and `client/package-lock.json`, runs `npm ci`, copies `client/`, then runs `npm run build` (`client/package.json`: `tsc --noEmit && vite build`). `client/vite.config.ts` sets `build.outDir` to `dist`, so the stage writes `/src/client/dist`. `.dockerignore` excludes `client/dist`, so the bundle is built in that stage.
- The runtime stage stays `debian:bookworm-slim` with `WORKDIR /app`. `COPY --from=spa /src/client/dist ./spa` places the bundle at `/app/spa`. The `chown` for uid/gid 10001 covers `/data`, `/home/seraframe`, and `/app/spa`.

The image sets `SERAFRAME_SPA_DIR=/app/spa`. `app/main.py` `_spa_root()` uses that value. When the variable is empty, the fallback is `Path(__file__).resolve().parent.parent / "spa"`. Compose leaves `SERAFRAME_SPA_DIR` at the image default. `.env.example` and `docker-compose.yml` do not list it.

`docker compose up` serves the client at `/` on port 8080. With no session, `client/src/App.tsx` renders `LoginScreen`, so the published port is a login-capable app.

FastAPI serving in `app/main.py`:

- `GET /` and the catch-all `GET /{full_path:path}` call `_spa_response`.
- A file that exists under `SERAFRAME_SPA_DIR` is returned as that file.
- A path outside `/api` with no file extension falls back to `index.html` when that file exists (`Cache-Control: no-cache`).
- A missing path that has a file extension returns JSON 404 `not_found`. `_spa_asset` rejects `..`, a leading `/`, a backslash, or NUL before it resolves a file.
- Registered `/api/*` routes are unchanged. `_spa_response` returns JSON 404 `not_found` for `api` and `api/...`, including unknown API paths.
- When `index.html` is absent, the response is the built-in placeholder HTML.

`SERAFRAME_SPA_DIR` is the only new `SERAFRAME_*` variable. The others are unchanged in `app/config.py` and `docker-compose.yml`: `SERAFRAME_ADMIN_PASSWORD`, `SERAFRAME_SECRET_KEY`, `SERAFRAME_DATA_DIR` (`/data`), `SERAFRAME_PORT` (`8080`), and `SERAFRAME_TRUST_PROXY` (default `0`). Compose volume `seraframe-data` mounted at `/data` is unchanged. The non-root user remains `seraframe`, uid/gid 10001.

## Persistence

Compose volume `seraframe-data` mounted at `/data` (`SERAFRAME_DATA_DIR`).

| Path | Contents |
| --- | --- |
| `/data/seraframe.sqlite` | Admin hash, sessions, sources, servers, SFTP host-key fingerprints |
| `/data/thumbs/{source_id}/{hash}-{version}.webp` | Thumbnail cache |

Deleting a source removes that source's thumbnail directory. The cache key is source id, relative path, and file mtime (or SFTP mtime). Long edge is 256px, WebP.

Images larger than 64 MiB are refused.

## Network

- Inbound: TCP 8080 only
- Outbound: SFTP to hosts an authenticated admin configures
- No ComfyUI reverse proxy. The API stores `http` or `https` URLs. The frontend opens them.

## Secrets and auth

- One admin. `SERAFRAME_ADMIN_PASSWORD` is Argon2-hashed on first boot when the admin row is absent.
- Five failed logins lock the account for 15 minutes. Further attempts get HTTP 429 and `Retry-After`.
- Session cookie `seraframe_session`: HttpOnly, SameSite=Lax, 7 days. `Secure` when `SERAFRAME_TRUST_PROXY=1`.
- CSRF: `GET /api/auth/csrf` returns `csrfToken` and sets non-HttpOnly cookie `seraframe_csrf`. `POST`, `PUT`, `PATCH`, and `DELETE` under `/api/` must send `X-CSRF-Token` equal to that cookie.
- `SERAFRAME_SECRET_KEY` (at least 32 bytes) is hashed with SHA-256 and used as a Fernet key (AES-128-CBC with HMAC-SHA256). SFTP passwords and private keys are stored as Fernet tokens. GET responses expose only `hasPassword` and `hasPrivateKey`.
- SFTP host keys are trust-on-first-use. The fingerprint is stored in `host_keys`. A changed key is rejected.
- The client does not use ssh-agent or default `~/.ssh` identity files.
- Relative paths with `..`, a leading `/`, a backslash, or NUL are rejected with `path_rejected`. A symlink whose target resolves outside the source root is rejected the same way and omitted from listings.

## Reset

Delete `/data/seraframe.sqlite` and restart to bootstrap the admin password from the environment again. Sources, servers, sessions, and host keys in that file are removed. Thumbnail files under `/data/thumbs` can be deleted separately.

## Build

```bash
docker compose build
docker compose up
```

`SERAFRAME_ADMIN_PASSWORD` and `SERAFRAME_SECRET_KEY` must be set in the shell or in a `.env` file next to `docker-compose.yml`. Open `http://127.0.0.1:8080/` and sign in with `SERAFRAME_ADMIN_PASSWORD`.
