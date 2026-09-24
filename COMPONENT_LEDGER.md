# Component ledger

FRONT lives in `client/`. `npm run build` writes `client/dist`. The Docker image copies that directory to `/app/spa` and FastAPI serves it at `/`. The API remains `app/main.py`. Routes are [INTEGRATION_CONTRACT_v1.md](INTEGRATION_CONTRACT_v1.md). Call notes are in `docs/front-api-expectations.md`.

## Shell

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `main.tsx` | `client/src/main.tsx` | Starts MSW in dev, mounts the tree | `browser.ts`, `App.tsx`, `global.css` |
| `App.tsx` | `client/src/App.tsx` | Splash, login, then `GET /api/prefs`. First-run Appearance when the server flag is false, otherwise the shell | `AuthProvider.tsx`, `serverPrefs.tsx`, `AppearancePicker.tsx` |
| `AppearancePicker.tsx` | `client/src/components/AppearancePicker.tsx` | One-time light (Photos) / dark (Neon) picker. Continue sends `PUT /api/prefs` with `appearance` and `firstRunAppearanceDone: true` | `prefs.tsx`, `serverPrefs.tsx` |
| `AuthProvider.tsx` | `client/src/auth/AuthProvider.tsx` | `GET /api/auth/me`, login, logout; `401` returns to login except a wrong current password | `client.ts` |
| `LoginScreen.tsx` | `client/src/components/LoginScreen.tsx` | Password form, lockout message, demo hint | `AuthProvider.tsx` |
| `AppShell.tsx` | `client/src/components/AppShell.tsx` | Library / For You / Albums, search, profile, idle chrome, Servers rail | `GalleryView.tsx`, `ServersRail.tsx`, `ProfileMenu.tsx`, `ServerFrame.tsx` |
| `ProfileMenu.tsx` | `client/src/components/ProfileMenu.tsx` | Appearance `PUT`, local feature toggles, change password, session list/revoke, About, sign out | `prefs.tsx`, `serverPrefs.tsx`, `client.ts`, `AuthProvider.tsx` |
| `ProfileButton.tsx` | `client/src/components/ProfileButton.tsx` | Locked ring icon. Top bar chip and floating button. Green badge when a server frame is ready | — |
| `ServersRail.tsx` | `client/src/components/ServersRail.tsx` | Server list. Fully removed with the top bar after idle. Not a peek rail | `AddServerDialog.tsx` |
| `prefs.tsx` | `client/src/lib/prefs.tsx` | Display cache for light/dark plus auto-hide, full photo, and blur. `localStorage` key `seraframe.prefs`. Feature toggles stay here and are never sent to the server. A saved theme does not finish first-run | — |
| `serverPrefs.tsx` | `client/src/lib/serverPrefs.tsx` | After login, `GET /api/prefs`. Applies a stored appearance. `PUT` is only the picker finish or a later Appearance change | `client.ts`, `prefs.tsx` |
| `Dialog.tsx` | `client/src/components/Dialog.tsx` | Modal, focus trap, Escape, portaled so the page can be `inert` | — |

## Gallery

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `GalleryView.tsx` | `client/src/components/GalleryView.tsx` | Library album cards, For You, Albums, photo grid, viewer | `AlbumCard.tsx`, `ThumbGrid.tsx`, `Lightbox.tsx`, `AddSourceDialog.tsx` |
| `AlbumCard.tsx` | `client/src/components/AlbumCard.tsx` | Album cover, title, photo count. Contain or cover from Show full photo | `route.ts` |
| `SourceSidebar.tsx` | `client/src/components/SourceSidebar.tsx` | Folder tree kept in the repo. The mounted gallery uses album cards instead | `AddSourceDialog.tsx`, `Dialog.tsx`, `client.ts` |
| `AddSourceDialog.tsx` | `client/src/components/AddSourceDialog.tsx` | Local vs SFTP explanation, `/opt/comfyui_*` suggestions | `client.ts`, `forms.ts` |
| `ThumbGrid.tsx` | `client/src/components/ThumbGrid.tsx` | Lazy `thumbUrl` only. Arrow keys move. Cover, or contain when Show full photo is on. Optional blur | `types.ts` |
| `Lightbox.tsx` | `client/src/components/Lightbox.tsx` | Full-res overlay. Contain/letterbox when Show full photo is on. Filmstrip can blur | `types.ts` |

Filmstrip thumbs also use `thumbUrl`. `fullUrl` is requested only by `Lightbox.tsx`.

## Servers

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `AddServerDialog.tsx` | `client/src/components/AddServerDialog.tsx` | Name + http(s) URL | `forms.ts` |
| `ServerFrame.tsx` | `client/src/components/ServerFrame.tsx` | Sandboxed iframe with address, back, refresh, and open externally. Toolbar stays while shell chrome is hidden. Ready state lights the profile badge | `types.ts` |

## API and forms

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `types.ts` | `client/src/api/types.ts` | Contract v1 wire types | — |
| `errors.ts` | `client/src/api/errors.ts` | `ApiError`, `Retry-After`, display text | — |
| `client.ts` | `client/src/api/client.ts` | Typed `fetch` for every v1 JSON route, including change-password, sessions, and prefs. `X-CSRF-Token` is kept equal to `seraframe_csrf`. A wrong current password stays signed in | `types.ts`, `errors.ts` |
| `forms.ts` | `client/src/lib/forms.ts` | Create-source and create-server validation | `types.ts` |
| `hooks.ts` | `client/src/lib/hooks.ts` | `useMediaQuery` | — |
| `route.ts` | `client/src/lib/route.ts` | Hash routes: `#/library`, `#/foryou`, `#/albums`, `#/album/…`, `#/server/…`. `#/gallery` and `#/servers` open Library | — |

## Mocks (dev only)

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `browser.ts` | `client/src/mocks/browser.ts` | MSW browser worker | `handlers.ts` |
| `handlers.ts` | `client/src/mocks/handlers.ts` | In-memory contract v1, including change-password, sessions, prefs, and `401` before login | `data.ts`, `images.ts` |
| `data.ts` | `client/src/mocks/data.ts` | Sources, folders, stills, suggestions, demo password | `types.ts` |
| `images.ts` | `client/src/mocks/images.ts` | SVG stand-ins. Full images are marked `FULL` | — |
| `comfy.html` | `client/public/mock/comfy.html` | Same-origin page for the iframe demo | — |

## Styles

`client/src/styles/global.css` — mobile-first layout, 44px targets, focus rings, reduced motion. No component library.

## Tests

| File | Covers |
| --- | --- |
| `client/src/api/client.test.ts` | CSRF header, cookie fallback, one csrf retry, `401`, wrong-password stays signed in, sessions, prefs, `Retry-After`, path encoding |
| `client/src/lib/forms.test.ts` | Local/SFTP bodies, http(s) URL check |
| `client/src/lib/prefs.test.ts` | Feature toggles and theme cache. A stored theme is not a first-run flag |
| `tests/test_spa_static.py` | `GET /` serves the SPA shell; `/api` stays JSON |
