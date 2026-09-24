# Infrastructure ledger

SeraFrame service, contract v1. This file records how the image is built, how HTTP is served, and where state is kept. The image bakes the client and serves it at `/`. Secret persistence and the GHCR publish path are recorded below.

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

`SERAFRAME_SPA_DIR` is the SPA root. `SERAFRAME_DATA_DIR` stays `/data`, `SERAFRAME_PORT` stays `8080`, and `SERAFRAME_TRUST_PROXY` still defaults to `0`. Compose volume `seraframe-data` mounted at `/data` is unchanged. The non-root user remains `seraframe`, uid/gid 10001. `SERAFRAME_ADMIN_PASSWORD` is required. `SERAFRAME_SECRET_KEY` is optional; persistence is under Secrets and auth.

## Persistence

Compose volume `seraframe-data` mounted at `/data` (`SERAFRAME_DATA_DIR`).

| Path | Contents |
| --- | --- |
| `/data/seraframe.sqlite` | Admin hash, sessions, sources, servers, SFTP host-key fingerprints |
| `/data/secret_key` | Persisted Fernet key material when `SERAFRAME_SECRET_KEY` is unset or empty. Mode `0600`. Not created or overwritten when the variable is set. |
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
- `SERAFRAME_ADMIN_PASSWORD` has no default. A missing or empty value stops startup before any secret file is written.
- `SERAFRAME_SECRET_KEY`, when set and at least 32 bytes, is the key material for that process. The file `/data/secret_key` is left untouched (not read, not created, not replaced).
- When `SERAFRAME_SECRET_KEY` is unset or empty, startup reads `/data/secret_key`. If the file is missing, the process generates a key (`secrets.token_urlsafe(32)`), writes it with mode `0600`, and reuses it on the next start. A file that is too short or not valid text is rejected and not replaced.
- The resolved key is hashed with SHA-256 and used as a Fernet key (AES-128-CBC with HMAC-SHA256). SFTP passwords and private keys are stored as Fernet tokens. GET responses expose only `hasPassword` and `hasPrivateKey`. A key that was only supplied through the environment is not copied into the file, so a later start without the variable will not reuse that env value unless the file already holds it.
- SFTP host keys are trust-on-first-use. The fingerprint is stored in `host_keys`. A changed key is rejected.
- The client does not use ssh-agent or default `~/.ssh` identity files.
- Relative paths with `..`, a leading `/`, a backslash, or NUL are rejected with `path_rejected`. A symlink whose target resolves outside the source root is rejected the same way and omitted from listings.

## Reset

Delete `/data/seraframe.sqlite` and restart to bootstrap the admin password from the environment again. Sources, servers, sessions, and host keys in that file are removed. Thumbnail files under `/data/thumbs` can be deleted separately. `/data/secret_key` is independent of the database. Deleting it while `SERAFRAME_SECRET_KEY` is unset generates a new key on the next start, and SFTP secrets already stored in SQLite will not decrypt.

## Build

```bash
docker compose build
docker compose up
```

`SERAFRAME_ADMIN_PASSWORD` must be set in the shell or in a `.env` file next to `docker-compose.yml`. `SERAFRAME_SECRET_KEY` may be omitted. Compose then passes an empty value, which the process treats as unset. Open `http://127.0.0.1:8080/` and sign in with `SERAFRAME_ADMIN_PASSWORD`.

## Publish

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs on git tags `v*.*.*`. The image includes the baked client, so `/` is the login screen.

- Registry image: `ghcr.io/recognizeyourprivilege/seraframe` (GHCR lowercases the repository name)
- First proposed tag: `v0.1.0`, also pushed as `0.1.0`, `0.1`, and `latest`
- The same workflow creates a GitHub Release for that tag
- Registry login uses `GITHUB_TOKEN` (`packages: write`). The release step needs `contents: write`

```bash
docker pull ghcr.io/recognizeyourprivilege/seraframe:v0.1.0
```

Pull and run notes are in [RELEASE.md](RELEASE.md). Runtime still requires `SERAFRAME_ADMIN_PASSWORD`. Omit `SERAFRAME_SECRET_KEY` to persist the key in the data volume.
