# SeraFrame — INTEGRATION CONTRACT v1
Draft 2 locked. Base URL: same origin as the SPA. All JSON unless noted. Cookie session after login.

## Conventions
- Auth: session cookie `seraframe_session` (HttpOnly, Secure, SameSite=Lax).
- CSRF: header `X-CSRF-Token` required on POST/PUT/PATCH/DELETE. Token from `GET /api/auth/csrf` (also set as non-HttpOnly cookie `seraframe_csrf` for double-submit).
- Errors: `{ "error": { "code": string, "message": string } }`
- Codes: `unauthorized`, `forbidden`, `not_found`, `validation`, `locked_out`, `csrf`, `path_rejected`, `io_error`, `conflict`
- Image identity: never bare filename. Always `source_id` + `rel_path` (POSIX, no leading `/`, no `..`).
- Still formats listed: `.jpg` `.jpeg` `.png` `.webp` `.gif` (case-insensitive). Others omitted from listings.

## Auth
| Method | Path | Body / notes | Success |
|--------|------|--------------|---------|
| GET | `/api/auth/csrf` | — | `{ "csrfToken": string }` + sets csrf cookie |
| POST | `/api/auth/login` | `{ "password": string }` + CSRF | `{ "ok": true }` + session cookie. 401 wrong; 429 locked (`Retry-After` seconds) |
| POST | `/api/auth/logout` | CSRF | `{ "ok": true }` clears session |
| GET | `/api/auth/me` | — | `{ "authenticated": true }` or 401 |

Unauthenticated access to any `/api/sources*`, `/api/servers*`, `/api/media*` → **401**.

## Sources
| Method | Path | Body / query | Success |
|--------|------|--------------|---------|
| GET | `/api/sources` | — | `{ "sources": Source[] }` — **never** includes SFTP secrets |
| GET | `/api/sources/suggestions` | — | `{ "paths": string[] }` candidates matching `/opt/comfyui_*` that exist; display-only |
| POST | `/api/sources` | see CreateSource + CSRF | `{ "source": Source }` 201 |
| DELETE | `/api/sources/{id}` | CSRF | `{ "ok": true }` — purges thumb cache for that source |
| GET | `/api/sources/{id}/tree` | `?path=` optional folder rel | `{ "path": string, "entries": TreeEntry[] }` dirs + counts |
| GET | `/api/sources/{id}/stills` | `?path=` folder rel (default `""`) | `{ "path": string, "stills": Still[] }` locale-aware path sort |

### Types
```ts
type Source = {
  id: string;           // opaque uuid
  type: "local" | "sftp";
  label: string;        // display name (basename of root or human label)
  // local:
  rootPath?: string;    // absolute host path as configured
  // sftp (metadata only):
  host?: string;
  port?: number;        // default 22
  username?: string;
  remotePath?: string;
  hasPrivateKey?: boolean;
  hasPassword?: boolean;
};

type CreateSource =
  | { type: "local"; rootPath: string; label?: string }
  | {
      type: "sftp";
      host: string;
      port?: number;
      username: string;
      remotePath: string;
      password?: string;
      privateKey?: string;
      label?: string;
    }; // at least one of password | privateKey

type TreeEntry =
  | { kind: "dir"; name: string; relPath: string; stillCount?: number }
  | { kind: "still"; name: string; relPath: string };

type Still = {
  sourceId: string;
  relPath: string;
  name: string;
  thumbUrl: string;   // path only, e.g. /api/media/{id}/thumb?path=...
  fullUrl: string;    // /api/media/{id}/full?path=...
};
```

Path sandbox: any `rel_path` with `..`, absolute segments, or NUL → **400** `path_rejected`. Symlink escape outside root → **400** `path_rejected`.

## Media (bytes)
| Method | Path | Query | Success |
|--------|------|-------|---------|
| GET | `/api/media/{sourceId}/thumb` | `path` = rel_path | image/webp or image/jpeg; long-edge ~256px; **401** if no session |
| GET | `/api/media/{sourceId}/full` | `path` = rel_path | original bytes + Content-Type; **401** if no session |

Cache: server-side disk cache keyed by `(source_id, rel_path, mtime_or_etag)`. Cache miss generates once.

## Servers (ComfyUI)
| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/api/servers` | — | `{ "servers": Server[] }` |
| POST | `/api/servers` | `{ "name": string, "url": string }` + CSRF | `{ "server": Server }` 201 |
| DELETE | `/api/servers/{id}` | CSRF | `{ "ok": true }` |

```ts
type Server = { id: string; name: string; url: string }; // url must be http(s)
```

No proxy endpoints in v1. FRONT embeds `url` in sandboxed iframe; on block, open externally.

## Bootstrap / env (infra, not FRONT calls)
- `SERAFRAME_ADMIN_PASSWORD` — **required**. Process exits if missing or empty. No default and no generated password. Hashed on first boot if no user row.
- `SERAFRAME_SECRET_KEY` — optional session + Fernet key material. If set, the value (≥32 bytes) is used and `$SERAFRAME_DATA_DIR/secret_key` is not read or written. If unset or empty, that file is reused, or created (mode `0600`) on first start and reused after that.
- `SERAFRAME_DATA_DIR` — default `/data` (sqlite, `secret_key`, thumb cache)
- `SERAFRAME_PORT` — default `18880`
- `SERAFRAME_TRUST_PROXY` — `1` when HTTPS terminated upstream (Secure cookies)

Published image (tag push `v*.*.*`, first proposed tag `v0.1.0`): `ghcr.io/recognizeyourprivilege/seraframe`. See [RELEASE.md](RELEASE.md).

## Versioning
Contract **v1**. Breaking changes = new version bump posted in SeraFrame room before FRONT adopts.
