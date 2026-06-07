import { PREVIEW_CACHE_KEY } from "./constants";

let _previewCachePruned = false;

export function getPreviewCache() {
  try {
    const raw = localStorage.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (_previewCachePruned) return parsed;

    // Prune once per page load
    _previewCachePruned = true;
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(parsed)) {
      if (now - parsed[key].timestamp >= CACHE_TTL) {
        delete parsed[key];
        changed = true;
      }
    }
    if (changed) localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return {};
  }
}


export function setPreviewCache(url, data) {
  try {
    const cache = getPreviewCache();
    cache[url] = { data, timestamp: Date.now() };
    localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage quota exceeded — silently skip caching
  }
}
