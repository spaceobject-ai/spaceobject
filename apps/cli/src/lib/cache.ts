import os from "node:os";
import path from "node:path";
import { create } from "flat-cache";

// ~/.spaceobject/sun/cache/<id>.json persists key/value pairs across CLI invocations.
// Callers pick their own cache id and key format; entries never expire
// unless the caller overwrites or clears them itself.
const caches = new Map<string, ReturnType<typeof create>>();

function cacheFor(id: string) {
  const existing = caches.get(id);
  if (existing) return existing;

  const cache = create({
    cacheDir: path.join(os.homedir(), ".spaceobject", "sun", "cache"),
    cacheId: id,
  });
  caches.set(id, cache);
  return cache;
}

export function getCached<T>(id: string, key: string): T | undefined {
  return cacheFor(id).getKey<T>(key);
}

export function setCached<T>(id: string, key: string, value: T): void {
  const cache = cacheFor(id);
  cache.setKey(key, value);
  cache.save();
}
