import type { Asset } from "./types.js";
export type FetchAsset = (asset: Asset, signal: AbortSignal) => Promise<Uint8Array>;
export interface ByteStore {
    get(key: string): Promise<Uint8Array | undefined>;
    put(key: string, bytes: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
}
export declare class MemoryStore implements ByteStore {
    readonly maxBytes: number;
    private readonly values;
    private size;
    constructor(maxBytes?: number);
    get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
    delete(key: string): Promise<void>;
    put(key: string, bytes: Uint8Array): Promise<void>;
}
export declare function verifyBytes(asset: Asset, bytes: Uint8Array): Promise<void>;
/** Reject a response that could turn a declared module/WASM/font into HTML or another type. */
export declare function responseContentTypeAllowed(asset: Asset, header: string | null): boolean;
export declare function httpTransport(fetcher?: typeof fetch): FetchAsset;
