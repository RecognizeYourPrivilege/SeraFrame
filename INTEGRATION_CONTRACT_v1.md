# SeraFrame — INTEGRATION CONTRACT v1
Draft 2, extended by Draft 2.1.4 (change-password, session list/revoke, server Appearance) and Draft 2.1.6a (live Comfy session image feed). Contract version remains **v1**. The feed routes are additive. Base URL: same origin as the SPA. All JSON unless noted. Cookie session after login.

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
| POST | `/api/auth/logout` | CSRF | `{ "ok": true }` clears **this** session. This is how the current session is revoked |
| GET | `/api/auth/me` | — | `{ "authenticated": true }` or 401. Does **not** include prefs or first-run state |
| POST | `/api/auth/change-password` | `{ "currentPassword": string, "newPassword": string }` + auth + CSRF | `{ "ok": true }` |
| GET | `/api/auth/sessions` | auth | `{ "sessions": Session[] }` |
| DELETE | `/api/auth/sessions/{id}` | auth + CSRF | `{ "ok": true }` revokes that session |

`GET /api/auth/me` stays `{ "authenticated": true }`. Appearance and first-run live on `/api/prefs`.

Unauthenticated `POST /api/auth/change-password`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/{id}`, `GET /api/prefs`, and `PUT /api/prefs` → **401** `unauthorized`. The same applies to any `/api/sources*`, `/api/servers*`, `/api/media*`. `GET /api/auth/csrf` and `POST /api/auth/login` stay public. `POST /api/auth/logout` with a valid CSRF token still returns `{ "ok": true }` when no session cookie is present. A mutating call with a missing or mismatched CSRF token is **403** `csrf` before the session check, same as the other `/api/` mutations.

### Change password
- Auth + CSRF. Wrong or unusable `currentPassword` → **401** `unauthorized`, message `current password is incorrect`. The hash and other sessions stay as they were. This route does not increment the login lockout counter.
- `newPassword` must be 1–1024 characters (same bounds as login). Otherwise **400** `validation`, message `new password must be 1 to 1024 characters`. Passwords are kept exactly (not trimmed).
- Success updates the Argon2 hash for the single admin and deletes **every session except the caller**. The current `seraframe_session` cookie is not rotated and remains valid. No new `Set-Cookie` is required. `SERAFRAME_ADMIN_PASSWORD` is not rewritten; a later start does not copy the environment value over the stored hash.
- There is one admin. The hash lives on that row.

### Sessions
```ts
type Session = {
  id: string;              // opaque id, not the cookie token
  createdAt: string;       // ISO-8601 UTC, second precision, e.g. 2026-09-24T15:04:05Z
  lastSeenAt: string;      // same format; updated on authenticated requests
  userAgent: string | null; // captured at login; not replaced by later requests
  ip: string | null;       // captured at login. X-Forwarded-For is used only when SERAFRAME_TRUST_PROXY=1
  current: boolean;        // true only for the session that matches this request's cookie
};
```
- Ordered by `createdAt` ascending, then `id`.
- `id` is distinct from the raw `seraframe_session` token. The token is never returned.
- `userAgent` and `ip` are written at login. Later requests do not replace a value that is already set. A row migrated from an older database has nulls until the next authenticated request, which fills each null once.
- `DELETE /api/auth/sessions/{id}` of the **current** session → **400** `validation`, message `cannot revoke the current session`. Sign out with `POST /api/auth/logout`.
- Delete of another live session → `{ "ok": true }`. That cookie then gets **401** on authenticated routes.
- Unknown id → **404** `not_found`, message `session not found`.
- Expired sessions are omitted and purged.

### Types
```ts
type ChangePasswordBody = { currentPassword: string; newPassword: string };
```

## Prefs
Server store for the single admin's Appearance and first-run completion. Feature toggles (servers auto-hide, show full photo, blur sensitive thumbs) are **not** accepted, stored, or returned. The server does not read `localStorage` and does not migrate a browser theme.

| Method | Path | Body / notes | Success |
|--------|------|--------------|---------|
| GET | `/api/prefs` | auth | `{ "appearance": "light" \| "dark" \| null, "firstRunAppearanceDone": boolean }` |
| PUT | `/api/prefs` | partial body + auth + CSRF | the stored prefs object, same shape as GET |

```ts
type Prefs = {
  appearance: "light" | "dark" | null; // null means not set yet
  firstRunAppearanceDone: boolean;
};

type PrefsPatch = {
  appearance?: "light" | "dark";       // omit to leave unchanged; null is rejected
  firstRunAppearanceDone?: true;       // omit to leave unchanged; false and null are rejected
};
```

Rules:
- A new admin row is `{ "appearance": null, "firstRunAppearanceDone": false }` until PUT. A browser that already has a local theme still sees first-run as incomplete until this store says otherwise.
- `firstRunAppearanceDone` is the only completion signal. A non-null `appearance` with `firstRunAppearanceDone: false` still means the picker should be shown.
- FRONT finishes first run by sending both fields together: `{ "appearance": "light" | "dark", "firstRunAppearanceDone": true }`. Sending only `firstRunAppearanceDone: true` is allowed when an appearance is already stored; if appearance is still null, **400** `validation`, message `appearance is required to finish first run`.
- Setting `appearance` does not by itself mark first-run done.
- The flag is one-way. After it is true, later PUTs leave it true. `false` is **400** `validation`.
- Empty object `{}` → **400** `validation`, message `no preference fields to update`.
- Unknown fields, including feature toggles (`serversAutoHide`, `showFullPhoto`, `blurSensitiveThumbs`) or a client `theme` key → **400** `validation`.
- After first-run is done, `{ "appearance": "light" | "dark" }` updates the theme for every session of this admin.

FRONT, once wired: after login, `GET /api/prefs`. If `firstRunAppearanceDone` is false, show the Appearance picker once, then PUT both fields and continue to the gallery. Later Appearance changes in the profile menu PUT `appearance` only. Do not copy `localStorage` onto the server.

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

`GET` / `POST` / `DELETE /api/servers` stay metadata only. FRONT still embeds `url` in a sandboxed iframe; on block, open externally. The live session feed below is an extra set of GET routes. It does not change the `Server` object and it does not list Comfy history.

### Live session image feed (Draft 2.1.6a)

Populates an S-2 feed from the Comfy websocket for one configured server. The current SPA does not call these routes yet. Unauthenticated calls → **401** `unauthorized`, same as other `/api/servers*`. No CSRF (all three are GET). Unknown `{id}` → **404** `not_found`, message `server not found`.

| Method | Path | Query | Success |
|--------|------|-------|---------|
| GET | `/api/servers/{id}/feed` | `saveNodeOnly` bool, default `false` | feed snapshot, `Cache-Control: no-store` |
| GET | `/api/servers/{id}/feed/events` | same | `text/event-stream` |
| GET | `/api/servers/{id}/view` | `filename`, `type`, `subfolder`, optional `preview` | image bytes |

```ts
type FeedItem = {
  id: string;       // stable per image occurrence; 32 lowercase hex chars
  name: string;     // Comfy filename, not the subfolder
  thumbUrl: string; // same-origin path
  fullUrl: string;  // same-origin path
};

type ServerFeed = {
  items: FeedItem[];          // oldest first
  clientId: string;           // Comfy /ws clientId this process is listening as
  listening: boolean;         // that socket is open now
  error: string | null;       // null, or "comfy websocket unavailable"
};
```

`items` are the current observation window: node `executed` events seen on this process's Comfy websocket since the listener attached. Oldest first (index 0 is the earliest image still held). At most **500** occurrences are kept; older ones are dropped. Memory only. Deleted with the server row, or when the process stops. Comfy `/history` and the output folder are not read to fill the list. A down Comfy host still returns **200** with `listening: false`.

Opening `GET .../feed` or `GET .../feed/events` starts the listener if it is not running. The first snapshot can report `listening: false` and `error: null` while the socket is still opening. The event stream then sends `status`.

`saveNodeOnly` defaults to **false**: PreviewImage and SaveImage both stay (any executed image with `type` `output`, `input`, or `temp`). When `true`, an image is kept only if the event includes node class `SaveImage` (`class_type` or `node_type` on the detail or on that image). The usual Comfy `executed` frame has no class. Then `type=output` is kept and `type=temp` is dropped (SaveImage writes `output`, PreviewImage writes `temp`). Ids that contain `:` are kept. pysssss hides those only when the live graph says the parent is a group; this service does not have that graph.

`id` is the first 32 hex characters of SHA-256 over `prompt_id`, `node`, the image's index in that event, `filename`, `subfolder`, and `type`, joined by NUL (`\0`). The same occurrence is stored once.

#### FeedItem URLs

Same-origin, so the SPA can put them in `<img src>` without Comfy cookies or CORS. `{id}` is the SeraFrame server id. Query values are percent-encoded (`quote`, spaces as `%20`).

- `fullUrl` = `/api/servers/{id}/view?filename={filename}&type={type}&subfolder={subfolder}`
- `thumbUrl` = the same query plus `&preview=webp%3B90` (`preview=webp;90`)

These are not absolute Comfy `/view` URLs.

`GET /api/servers/{id}/view` proxies `{server url}/view` with the same `filename`, `type`, `subfolder`, and `preview`. The server URL's query and fragment are ignored; a path prefix is kept (`https://gpu.example/comfy` → `https://gpu.example/comfy/view?...`). Redirects are not followed.

The proxy only fetches a `filename` + `type` + `subfolder` that is still in that server's session feed. Any other tuple → **404** `not_found`, message `image not found`, and Comfy is not called. This is not a general file browser.

- Missing `filename` → **400** `validation`, message `filename is required`
- `type` other than `output`, `input`, or `temp` → **400** `validation`, message `type must be output, input, or temp`
- `..`, a slash or backslash in `filename`, an absolute `subfolder`, or `..` inside `subfolder` → **400** `path_rejected`
- `preview`, when present, must be `webp` or `jpeg`, optional `;` and a quality from 1 to 100. Otherwise **400** `validation`
- Comfy HTTP 404 → **404** `not_found`, message `image not found`
- Comfy HTTP 400 or 403 → **400** `path_rejected`
- Connection failure, redirect, other upstream status, or a body over 64MiB → **502** `io_error`, message `comfy view unavailable`

Raster `Content-Type` values (`image/*` except `image/svg+xml`) pass through. Anything else is `application/octet-stream`. `Cache-Control: private, max-age=3600`. `X-Content-Type-Options: nosniff`.

#### Event stream

`GET /api/servers/{id}/feed/events` uses the session cookie (same-origin `EventSource` or `fetch`). `Content-Type` is `text/event-stream`.

- First frame: `event: snapshot` and `data` is a `ServerFeed` (already filtered by `saveNodeOnly`)
- Then `event: item` with `data` `{ "item": FeedItem }` for each new occurrence that passes the filter
- `event: status` with `data` `{ "listening": boolean, "error": string | null }` when the socket opens or drops
- A comment line `: keepalive` about every 15 seconds

#### Comfy websocket

SeraFrame connects to `ws://` or `wss://` `{base}/ws?clientId={clientId}` (`http` → `ws`, `https` → `wss`). `clientId` is 32 hex characters, stable until that server's feed session is dropped, and is the `clientId` field in `ServerFeed`. The socket `Origin` is the Comfy HTTP origin (scheme + host) so Comfy's loopback Host/Origin check can pass. Text frames are parsed. Binary preview frames are ignored.

Accepted payload (websocket frame, or the `data` object alone):

```json
{
  "type": "executed",
  "data": {
    "node": "9",
    "prompt_id": "…",
    "output": {
      "images": [
        { "filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output" }
      ]
    }
  }
}
```

`type` on an image defaults to `output` when it is missing. Entries without a usable `filename`, or with a `type` outside `output` / `input` / `temp`, are skipped.

**Live Comfy blocker.** Current Comfy sends `executed` only to the websocket whose id equals the prompt's `client_id`. The embedded Comfy page uses its own id, so generations queued there are not delivered to SeraFrame's socket. Events show up when the prompt is queued with this feed's `clientId`, or if a future Comfy broadcasts `executed`. This service does not poll `/history` to fill that gap. No live Comfy host was required to test the mapping.

## Bootstrap / env (infra, not FRONT calls)
- `SERAFRAME_ADMIN_PASSWORD` — **required**. Process exits if missing or empty. No default and no generated password. Hashed on first boot if no user row. After that, only `POST /api/auth/change-password` changes the stored hash.
- `SERAFRAME_SECRET_KEY` — optional session + Fernet key material. If set, the value (≥32 bytes) is used and `$SERAFRAME_DATA_DIR/secret_key` is not read or written. If unset or empty, that file is reused, or created (mode `0600`) on first start and reused after that.
- `SERAFRAME_DATA_DIR` — default `/data` (sqlite, `secret_key`, thumb cache)
- `SERAFRAME_PORT` — default `18880`
- `SERAFRAME_TRUST_PROXY` — `1` when HTTPS terminated upstream (Secure cookies)

Published image (tag push `v*.*.*`, first proposed tag `v0.1.0`): `ghcr.io/recognizeyourprivilege/seraframe`. See [RELEASE.md](RELEASE.md).

## Versioning
Contract **v1**. Breaking changes = new version bump posted in SeraFrame room before FRONT adopts.
