# Component ledger

FRONT lives in `client/`. `npm run build` writes `client/dist`. The Docker image copies that directory to `/app/spa` and FastAPI serves it at `/`. The API remains `app/main.py`. Routes are [INTEGRATION_CONTRACT_v1.md](INTEGRATION_CONTRACT_v1.md). Call notes are in `docs/front-api-expectations.md`.

## Shell

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `main.tsx` | `client/src/main.tsx` | Starts MSW in dev, mounts the tree | `browser.ts`, `App.tsx`, `global.css` |
| `App.tsx` | `client/src/App.tsx` | Splash, login, or shell from session status | `AuthProvider.tsx` |
| `AuthProvider.tsx` | `client/src/auth/AuthProvider.tsx` | `GET /api/auth/me`, login, logout; `401` returns to login | `client.ts` |
| `LoginScreen.tsx` | `client/src/components/LoginScreen.tsx` | Password form, lockout message, demo hint | `AuthProvider.tsx` |
| `AppShell.tsx` | `client/src/components/AppShell.tsx` | Skip link, Gallery \| Servers, sources toggle, logout | `GalleryView.tsx`, `ServersView.tsx`, `hooks.ts` |
| `Dialog.tsx` | `client/src/components/Dialog.tsx` | Modal, focus trap, Escape, portaled so the page can be `inert` | — |

## Gallery

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `GalleryView.tsx` | `client/src/components/GalleryView.tsx` | Loads sources and stills, owns the open overlay | `SourceSidebar.tsx`, `ThumbGrid.tsx`, `Lightbox.tsx` |
| `SourceSidebar.tsx` | `client/src/components/SourceSidebar.tsx` | Collapsible source → folder tree, add and remove | `AddSourceDialog.tsx`, `Dialog.tsx`, `client.ts` |
| `AddSourceDialog.tsx` | `client/src/components/AddSourceDialog.tsx` | Local vs SFTP explanation, `/opt/comfyui_*` suggestions | `client.ts`, `forms.ts` |
| `ThumbGrid.tsx` | `client/src/components/ThumbGrid.tsx` | Lazy `thumbUrl` only. Arrow keys move. Does not read `fullUrl` | `types.ts` |
| `Lightbox.tsx` | `client/src/components/Lightbox.tsx` | Full-res overlay, Previous/Next, swipe, opaque filmstrip | `types.ts` |

Filmstrip thumbs also use `thumbUrl`. `fullUrl` is requested only by `Lightbox.tsx`.

## Servers

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `ServersView.tsx` | `client/src/components/ServersView.tsx` | List, add, remove. Not inside the photo sidebar | `AddServerDialog.tsx`, `ServerFrame.tsx` |
| `AddServerDialog.tsx` | `client/src/components/AddServerDialog.tsx` | Name + http(s) URL | `forms.ts` |
| `ServerFrame.tsx` | `client/src/components/ServerFrame.tsx` | Sandboxed iframe. Slow loads stay in the frame. Refused frames explain why. Open externally stays visible | `types.ts` |

## API and forms

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `types.ts` | `client/src/api/types.ts` | Contract v1 wire types | — |
| `errors.ts` | `client/src/api/errors.ts` | `ApiError`, `Retry-After`, display text | — |
| `client.ts` | `client/src/api/client.ts` | Typed `fetch` for every v1 JSON route. `X-CSRF-Token` is kept equal to `seraframe_csrf` | `types.ts`, `errors.ts` |
| `forms.ts` | `client/src/lib/forms.ts` | Create-source and create-server validation | `types.ts` |
| `hooks.ts` | `client/src/lib/hooks.ts` | `useMediaQuery`, hash view (`#/gallery`, `#/servers`) | — |

## Mocks (dev only)

| File | Path | Role | Depends on |
| --- | --- | --- | --- |
| `browser.ts` | `client/src/mocks/browser.ts` | MSW browser worker | `handlers.ts` |
| `handlers.ts` | `client/src/mocks/handlers.ts` | In-memory contract v1, including `401` before login | `data.ts`, `images.ts` |
| `data.ts` | `client/src/mocks/data.ts` | Sources, folders, stills, suggestions, demo password | `types.ts` |
| `images.ts` | `client/src/mocks/images.ts` | SVG stand-ins. Full images are marked `FULL` | — |
| `comfy.html` | `client/public/mock/comfy.html` | Same-origin page for the iframe demo | — |

## Styles

`client/src/styles/global.css` — mobile-first layout, 44px targets, focus rings, reduced motion. No component library.

## Tests

| File | Covers |
| --- | --- |
| `client/src/api/client.test.ts` | CSRF header, cookie fallback, one csrf retry, `401`, `Retry-After`, path encoding |
| `client/src/lib/forms.test.ts` | Local/SFTP bodies, http(s) URL check |
| `tests/test_spa_static.py` | `GET /` serves the SPA shell; `/api` stays JSON |
