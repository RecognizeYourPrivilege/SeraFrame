/** Fitted size. Pinch-out grows from here; pinch-in returns here. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** At or below this the image is fitted, so a one-finger swipe may change images. */
export const ZOOM_SWIPE = 1.01;
/** Same horizontal threshold the overlay used before pinch zoom. */
export const SWIPE_MIN_PX = 48;

export type Point = { x: number; y: number };
export type ZoomView = { scale: number; x: number; y: number };

export const FITTED_VIEW: ZoomView = { scale: ZOOM_MIN, x: 0, y: 0 };

export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** Scale follows the change in finger distance. A pinch never steps the sequence. */
export function nextPinchScale(startScale: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startScale);
  return clampZoom(startScale * (distance / startDistance));
}

export function canSwipeImages(scale: number, pinched: boolean): boolean {
  return !pinched && scale <= ZOOM_SWIPE;
}

/**
 * One-finger horizontal swipe. Returns 0 when a pinch happened, the image is
 * zoomed, or the motion is too short or more vertical than horizontal.
 */
export function swipeStep(dx: number, dy: number, scale: number, pinched: boolean): -1 | 0 | 1 {
  if (!canSwipeImages(scale, pinched)) return 0;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** Drag a zoomed image. A fitted image stays put so the same drag can be a swipe. */
export function nextPan(
  start: Point,
  dx: number,
  dy: number,
  scale: number,
  bounds: { width: number; height: number },
): Point {
  if (!(scale > ZOOM_SWIPE)) return { x: 0, y: 0 };
  const maxX = Math.max(0, (bounds.width * (scale - 1)) / 2);
  const maxY = Math.max(0, (bounds.height * (scale - 1)) / 2);
  return {
    x: clamp(start.x + dx, -maxX, maxX),
    y: clamp(start.y + dy, -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
