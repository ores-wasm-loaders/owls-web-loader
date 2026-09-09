import type {ByteStore} from "./transport.js";
import {LoaderError} from "./manifest.js";

/** Origin-scoped, opt-in persistent bytes. This does not register a service worker or intercept requests. */
export const SHARED_NAVIGATION_CACHE_NAMESPACE = "owls-navigation-v1";

function isCanonicalHttpsOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string" || origin.length === 0) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.origin === origin && parsed.href === origin + "/";
  } catch {
    return false;
  }
}

function isCacheStorage(storage: unknown): storage is CacheStorage {
  return storage !== null && typeof storage === "object" && typeof (storage as CacheStorage).open === "function";
}

export class CacheStorageStore implements ByteStore {
  private readonly cache: Promise<Cache>;
  constructor(storage: CacheStorage, readonly origin: string, readonly namespace: string,
    readonly maxEntryBytes = 64*1024*1024, readonly maxEntries = 32) {
    if (!isCacheStorage(storage) || !/^owls-[a-z0-9-]+$/.test(namespace) || !isCanonicalHttpsOrigin(origin) ||
        !Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1 ||
        !Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new LoaderError("cache","Invalid cache configuration");
    this.cache = storage.open(namespace);
  }
  private async request(key: string) {
    const hash = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key));
    const hex=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
    return new Request(this.origin+"/.owls-cache/"+this.namespace+"/"+hex);
  }
  async get(key: string) {
    const response = await (await this.cache).match(await this.request(key));
    if (!response?.body) return undefined;
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try { for (;;) { const {done,value}=await reader.read();if(done)break;
      size+=value.length;if(size>this.maxEntryBytes)throw new LoaderError("budget","Cached entry too large");chunks.push(value);
    }} finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  }
  async put(key: string,bytes: Uint8Array) {
    if(bytes.length>this.maxEntryBytes)return;
    const cache=await this.cache;
    await cache.put(await this.request(key),new Response(bytes.slice().buffer,{headers:{"content-type":"application/octet-stream"}}));
    const keys=await cache.keys();
    for(const old of keys.slice(0,Math.max(0,keys.length-this.maxEntries)))await cache.delete(old);
  }
  async delete(key:string){await (await this.cache).delete(await this.request(key));}
}

export interface SameOriginNavigationStoreOptions {
  storage?: CacheStorage;
  origin?: string;
  namespace?: string;
  maxEntryBytes?: number;
  maxEntries?: number;
}

/**
 * Canonical persistent store for marketing and application documents on one HTTPS origin.
 * Cache Storage remains origin-scoped; this shares verified bytes, never a live runtime.
 */
export function createSameOriginNavigationStore({
  storage = globalThis.caches,
  origin = globalThis.location?.origin,
  namespace = SHARED_NAVIGATION_CACHE_NAMESPACE,
  maxEntryBytes = 64*1024*1024,
  maxEntries = 32,
}: SameOriginNavigationStoreOptions = {}) {
  return new CacheStorageStore(storage, origin, namespace, maxEntryBytes, maxEntries);
}
