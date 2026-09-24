# FRONT API expectations

The live contract is [INTEGRATION_CONTRACT_v1.md](../INTEGRATION_CONTRACT_v1.md), implemented in `app/main.py`. The client calls only those routes, on the same origin as the SPA. It does not invent endpoints and it does not proxy ComfyUI.

`GET /` and other non-`/api` GETs serve the built SPA (`client/dist` in the image at `/app/spa`), with `index.html` when the path has no file extension. That is static hosting, not an API route.

CSRF is double-submit, as in `csrf_guard`: `X-CSRF-Token` must equal the `seraframe_csrf` cookie. `GET /api/auth/csrf` returns `{ "csrfToken" }` and sets that cookie to the same value. Thumbnail responses from this baseline are `image/webp`. The client still treats thumb and full responses as opaque image bytes at the URLs in each `Still`.

Image identity is never a bare filename. Listings and media URLs always carry `source_id` plus a POSIX `rel_path` (no leading `/`, no `..`).

## Errors

```json
{ "error": { "code": "unauthorized", "message": "Not signed in." } }
```

Codes the client surfaces as text: `unauthorized`, `forbidden`, `not_found`, `validation`, `locked_out`, `csrf`, `path_rejected`, `io_error`, `conflict`.

`401` on any call drops the UI back to login. `429` with `Retry-After` (delta seconds) is shown on the login form for `locked_out`. A mutating call that fails with `csrf` is retried once after a fresh `GET /api/auth/csrf`.

## Auth

Session cookie: `seraframe_session` (HttpOnly, Secure, SameSite=Lax). The client sends cookies with `credentials: "same-origin"` and never reads this cookie.

CSRF: header `X-CSRF-Token` on `POST`, `PUT`, `PATCH`, and `DELETE`. The value is the `csrfToken` from `GET /api/auth/csrf`. That response also sets a non-HttpOnly cookie `seraframe_csrf`. If the in-memory token is empty, the client falls back to that cookie (double submit).

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/auth/csrf` | — | `{ "csrfToken": string }` and the csrf cookie |
| POST | `/api/auth/login` | `{ "password": string }` + CSRF | `{ "ok": true }` and the session cookie. `401` wrong password. `429` locked, `Retry-After` seconds |
| POST | `/api/auth/logout` | CSRF | `{ "ok": true }` clears this session. Use this to revoke the current session |
| GET | `/api/auth/me` | — | `{ "authenticated": true }` or `401`. No prefs on this body |
| POST | `/api/auth/change-password` | `{ "currentPassword": string, "newPassword": string }` + CSRF | `{ "ok": true }`. Wrong current password is `401` `unauthorized`. Success keeps this cookie and revokes every other session |
| GET | `/api/auth/sessions` | — | `{ "sessions": Session[] }` |
| DELETE | `/api/auth/sessions/{id}` | CSRF | `{ "ok": true }`. The current session id is `400` `validation` |

```ts
type Session = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
};
```

`id` is not the `seraframe_session` token. The list is oldest first. `current: true` is the cookie this browser is using.

Unauthenticated `/api/sources*`, `/api/servers*`, `/api/media*`, `/api/prefs`, change-password, and session list/revoke return **401** when CSRF is satisfied (mutations without CSRF are still `403` `csrf`). The grid and the servers list are not shown until `me` succeeds.

## Prefs

Draft 2.1.4. One admin. The server stores Appearance and whether the first-run picker is done. Feature toggles stay in the browser. Do not POST them here and do not copy `localStorage` onto the server.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/prefs` | — | `{ "appearance": "light" \| "dark" \| null, "firstRunAppearanceDone": boolean }` |
| PUT | `/api/prefs` | `{ "appearance"?: "light" \| "dark", "firstRunAppearanceDone"?: true }` + CSRF | the stored object, same shape as GET |

After login, GET prefs. If `firstRunAppearanceDone` is false, show the picker once, then PUT `{ "appearance": "light" | "dark", "firstRunAppearanceDone": true }`. A later Appearance change PUTs `{ "appearance" }` only. `null` appearance means unset. The flag does not go back to false.

## Sources

| Method | Path | Body / query | Success |
| --- | --- | --- | --- |
| GET | `/api/sources` | — | `{ "sources": Source[] }` — never includes SFTP secrets |
| GET | `/api/sources/suggestions` | — | `{ "paths": string[] }` display-only candidates matching `/opt/comfyui_*` |
| POST | `/api/sources` | `CreateSource` + CSRF | `{ "source": Source }` `201` |
| DELETE | `/api/sources/{id}` | CSRF | `{ "ok": true }` — purges that source’s thumb cache |
| GET | `/api/sources/{id}/tree` | `path` optional folder rel | `{ "path": string, "entries": TreeEntry[] }` |
| GET | `/api/sources/{id}/stills` | `path` optional folder rel, default `""` | `{ "path": string, "stills": Still[] }` locale-aware path sort |

The client omits `path` when the folder is the source root (`""`). Ids and paths are percent-encoded.

```ts
type Source = {
  id: string;
  type: "local" | "sftp";
  label: string;
  rootPath?: string;
  host?: string;
  port?: number;
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
  thumbUrl: string; // path only, e.g. /api/media/{id}/thumb?path=...
  fullUrl: string; // /api/media/{id}/full?path=...
};
```

The sidebar renders `kind: "dir"` only. The grid renders `stills` from the stills route, in the order given. A blank label is omitted so the server can derive one. A blank SFTP port is omitted (server default 22).

`rel_path` values with `..`, an absolute segment, or NUL are `400` `path_rejected`. The client does not offer a way to type those into folder navigation; it still displays `path_rejected` if a request fails that way.

Suggestions are not created until the user saves. Picking one only fills the local path field.

## Media

The client does not call these with `fetch`. The grid and the filmstrip use `thumbUrl` as an `<img src>`. The overlay is the only place that uses `fullUrl`.

| Method | Path | Query | Success |
| --- | --- | --- | --- |
| GET | `/api/media/{sourceId}/thumb` | `path` = rel_path | `image/webp` or `image/jpeg`, long edge about 256px. `401` without a session |
| GET | `/api/media/{sourceId}/full` | `path` = rel_path | original bytes and `Content-Type`. `401` without a session |

Dev mocks return `image/svg+xml` placeholders so the UI can run without a thumbnail encoder. That content type is not part of the contract.

## Servers

No proxy routes. The client puts `url` in a sandboxed iframe (`allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals`, no top navigation). If the frame is blocked, blank, or still loading after 8 seconds, the panel tells the user and shows **Open externally** (`target="_blank"`, `rel="noopener noreferrer"`). The same link stays in the frame toolbar even when the embed looks healthy, because frame blocking is not always detectable.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/servers` | — | `{ "servers": Server[] }` |
| POST | `/api/servers` | `{ "name": string, "url": string }` + CSRF | `{ "server": Server }` `201` |
| DELETE | `/api/servers/{id}` | CSRF | `{ "ok": true }` |

```ts
type Server = { id: string; name: string; url: string }; // url must be http(s)
```

The client rejects non-http(s) URLs and URLs with embedded credentials before POST, and sends the trimmed URL. `app/main.py` stores that string after the same http(s) check (`_normalize_url`). Local `rootPath` and SFTP `remotePath` must be absolute, matching `_local_fields` and `_sftp_fields`.

## Not called by FRONT

- FTP, file write or delete, favorites, multi-user admin
- Any reverse proxy of a ComfyUI URL
- Bootstrap env (`SERAFRAME_ADMIN_PASSWORD`, `SERAFRAME_SECRET_KEY`, `SERAFRAME_DATA_DIR`, `SERAFRAME_PORT`, `SERAFRAME_TRUST_PROXY`). Those are BACK-owned. The login form collects the password only; it does not know the env var.

## Dev wiring

`npm run dev` mocks every route above when `VITE_USE_MOCKS` is not `false`. Set `VITE_USE_MOCKS=false` and the Vite server proxies `/api` to `http://127.0.0.1:18880`.
