import type { ByteStore } from "./transport.js";
/** Origin-scoped, opt-in persistent bytes. This does not register a service worker or intercept requests. */
export declare class CacheStorageStore implements ByteStore {
    readonly origin: string;
    readonly namespace: string;
    readonly maxEntryBytes: number;
    readonly maxEntries: number;
    private readonly cache;
    constructor(storage: CacheStorage, origin: string, namespace: string, maxEntryBytes?: number, maxEntries?: number);
    private request;
    get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
    put(key: string, bytes: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
}
