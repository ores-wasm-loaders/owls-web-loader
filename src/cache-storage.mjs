// Origin-scoped, opt-in persistent bytes.
//
// This does NOT register a service worker and does not intercept requests: it is a keyed
// byte store the coordinator may use, nothing that sits in front of the page.
import { LoaderError } from './contract.mjs';

export const SHARED_NAVIGATION_CACHE_NAMESPACE = 'owls-navigation-v1';

function isCanonicalHttpsOrigin(origin) {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.origin === origin && parsed.href === `${origin}/`;
  } catch {
    return false;
  }
}

function isCacheStorage(storage) {
  return storage !== null && typeof storage === 'object' && typeof storage.open === 'function';
}

export class CacheStorageStore {
  #cache;

  constructor(storage, origin, namespace, maxEntryBytes = 64 * 1024 * 1024, maxEntries = 32) {
    if (
      !isCacheStorage(storage) ||
      !/^owls-[a-z0-9-]+$/.test(namespace) ||
      !isCanonicalHttpsOrigin(origin) ||
      !Number.isSafeInteger(maxEntryBytes) ||
      maxEntryBytes < 1 ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1
    ) {
      throw new LoaderError('cache', 'Invalid cache configuration');
    }
    this.origin = origin;
    this.namespace = namespace;
    this.maxEntryBytes = maxEntryBytes;
    this.maxEntries = maxEntries;
    this.#cache = storage.open(namespace);
  }

  async #request(key) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
    return new Request(`${this.origin}/.owls-cache/${this.namespace}/${hex}`);
  }

  async get(key) {
    const response = await (await this.#cache).match(await this.#request(key));
    if (!response?.body) return undefined;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > this.maxEntryBytes) throw new LoaderError('budget', 'Cached entry too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  async put(key, bytes) {
    if (bytes.length > this.maxEntryBytes) return;
    const cache = await this.#cache;
    await cache.put(await this.#request(key), new Response(bytes.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } }));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - this.maxEntries))) await cache.delete(old);
  }

  async delete(key) {
    await (await this.#cache).delete(await this.#request(key));
  }
}

/**
 * Canonical store for a marketing page and an application page that share one HTTPS origin.
 *
 * Both documents must call this helper with the same namespace. Cache Storage is origin-scoped,
 * so this intentionally cannot create cross-origin or cross-site sharing. A full-page navigation
 * still initializes a new JavaScript/Wasm runtime; this helper only preserves already verified
 * bytes so the destination coordinator can reuse them instead of fetching them again.
 */
export function createSameOriginNavigationStore({
  storage = globalThis.caches,
  origin = globalThis.location?.origin,
  namespace = SHARED_NAVIGATION_CACHE_NAMESPACE,
  maxEntryBytes = 64 * 1024 * 1024,
  maxEntries = 32,
} = {}) {
  return new CacheStorageStore(storage, origin, namespace, maxEntryBytes, maxEntries);
}
