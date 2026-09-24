# Component ledger

FRONT lives in `client/`. The API and Docker image are BACK’s `app/`, `Dockerfile`, and `docker-compose.yml` at the repo root (baseline `6109125`). The client calls [INTEGRATION_CONTRACT_v1.md](INTEGRATION_CONTRACT_v1.md). How those calls are made is in `docs/front-api-expectations.md`.

## Shell

| Piece | Path | Role | Depends on |
| --- | --- | --- | --- |
| Boot | `client/src/main.tsx` | Starts MSW in dev, mounts the tree | `mocks/browser`, `App`, `styles/global.css` |
| App gate | `client/src/App.tsx` | Splash, login, or shell from session status | `AuthProvider` |
| Session | `client/src/auth/AuthProvider.tsx` | `GET /api/auth/me`, login, logout; `401` returns to login | `api/client` |
| Login | `client/src/components/LoginScreen.tsx` | Password form, lockout message, demo hint | `AuthProvider` |
| Chrome | `client/src/components/AppShell.tsx` | Skip link, Gallery \| Servers, sources toggle, logout | `GalleryView`, `ServersView`, `useHashView` |
| Dialog | `client/src/components/Dialog.tsx` | Modal, focus trap, Escape, portaled so the page can be `inert` | — |

## Gallery

| Piece | Path | Role | Depends on |
| --- | --- | --- | --- |
| Gallery | `client/src/components/GalleryView.tsx` | Loads sources and stills, owns the open overlay | `SourceSidebar`, `ThumbGrid`, `Lightbox` |
| Sources sidebar | `client/src/components/SourceSidebar.tsx` | Collapsible source → folder tree, add and remove | `AddSourceDialog`, `Dialog`, `api.sourceTree` |
| Add source | `client/src/components/AddSourceDialog.tsx` | Local vs SFTP explanation, `/opt/comfyui_*` suggestions | `api.sourceSuggestions`, `lib/forms` |
| Thumb grid | `client/src/components/ThumbGrid.tsx` | Lazy `thumbUrl` only. Arrow keys move. Does not read `fullUrl` | `Still` |
| Lightbox | `client/src/components/Lightbox.tsx` | Full-res overlay, Previous/Next, swipe, opaque filmstrip | `Still.fullUrl`, `Still.thumbUrl` |

Filmstrip thumbs also use `thumbUrl`. `fullUrl` is requested only by the overlay image.

## Servers

| Piece | Path | Role | Depends on |
| --- | --- | --- | --- |
| Servers | `client/src/components/ServersView.tsx` | List, add, remove. Not inside the photo sidebar | `AddServerDialog`, `ServerFrame` |
| Add server | `client/src/components/AddServerDialog.tsx` | Name + http(s) URL | `lib/forms` |
| Frame | `client/src/components/ServerFrame.tsx` | Sandboxed iframe, blocked/failed state, Open externally | `Server.url` |

## API and forms

| Piece | Path | Role | Depends on |
| --- | --- | --- | --- |
| Types | `client/src/api/types.ts` | Contract v1 wire types | — |
| Errors | `client/src/api/errors.ts` | `ApiError`, `Retry-After`, display text | — |
| Client | `client/src/api/client.ts` | Typed `fetch` for every v1 JSON route. `X-CSRF-Token` is kept equal to `seraframe_csrf` | `types`, `errors` |
| Forms | `client/src/lib/forms.ts` | Create-source and create-server validation | `CreateSource` |
| Hooks | `client/src/lib/hooks.ts` | `useMediaQuery`, hash view (`#/gallery`, `#/servers`) | — |

## Mocks (dev only)

| Piece | Path | Role | Depends on |
| --- | --- | --- | --- |
| Worker | `client/src/mocks/browser.ts` | MSW browser worker | `handlers` |
| Handlers | `client/src/mocks/handlers.ts` | In-memory contract v1, including `401` before login | `data`, `images` |
| Catalog | `client/src/mocks/data.ts` | Sources, folders, stills, suggestions, demo password | `types` |
| Pixels | `client/src/mocks/images.ts` | SVG stand-ins. Full images are marked `FULL` | — |
| Comfy stand-in | `client/public/mock/comfy.html` | Same-origin page for the iframe demo | — |

## Styles

`client/src/styles/global.css` — mobile-first layout, 44px targets, focus rings, reduced motion. No component library.

## Tests

| Path | Covers |
| --- | --- |
| `client/src/api/client.test.ts` | CSRF header, cookie fallback, one csrf retry, `401`, `Retry-After`, path encoding |
| `client/src/lib/forms.test.ts` | Local/SFTP bodies, http(s) URL check |
