# Changelog

## 0.2.0

New release. Do not retag or replace v0.1.0.

- Gallery and For You stills use a bottom image feed. Left-click or activate a thumb to open a fullscreen overlay (Draft 2.1.6a S-1, FR-63, FR-64, FR-74).
- While the overlay is open, ArrowLeft / a and ArrowRight / d step through the current gallery, album, or filter order. Escape closes it. Those keys do nothing when the overlay is hidden, and they do not fire from a text field (FR-66, FR-68, NFR-01).
- Stepping stops at the first and last image. The previous chevron is hidden on the first image and the next chevron is hidden on the last (FR-67).
- The overlay can open the current image in a new tab and in a new window (FR-65).
- The embedded server bar has Zoom in and Zoom out. Zoom scales the iframe only and resets when that server frame remounts (S-3, FR-72, FR-73).
- A connected server on a phone uses the shared Mobile layout. Option 1 stays the default until the user picks another option. Reload, reconnect, and remount do not change that choice (S-4, FR-69–71).

Live Comfy session images (S-2: `executed` → `output.images` → `/view`) are not shown. SeraFrame has no API or websocket for that stream. The feed and overlay components take a list of image URLs so a later backend feed can use the same UI.
