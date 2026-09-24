const KEY = "seraframe.addSource";
const EVENT = "seraframe-add-source";

/** Ask the gallery to open Add source. Survives a hash change onto Library. */
export function requestAddSource(): void {
  sessionStorage.setItem(KEY, "1");
  window.dispatchEvent(new Event(EVENT));
}

export function addSourceRequested(): boolean {
  return sessionStorage.getItem(KEY) === "1";
}

export function clearAddSourceRequest(): void {
  sessionStorage.removeItem(KEY);
}

export function subscribeAddSource(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
