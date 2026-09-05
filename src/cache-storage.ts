import type {ByteStore} from "./transport.js";
import {LoaderError} from "./manifest.js";
/** Origin-scoped, opt-in persistent bytes. This does not register a service worker or intercept requests. */
export class CacheStorageStore implements ByteStore {
  private readonly cache: Promise<Cache>;
  constructor(storage: CacheStorage, readonly origin: string, readonly namespace: string,
    readonly maxEntryBytes = 64*1024*1024, readonly maxEntries = 32) {
    if (!/^owls-[a-z0-9-]+$/.test(namespace) || new URL(origin).origin !== origin ||
        !origin.startsWith("https://") || !Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1 ||
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

