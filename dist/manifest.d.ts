import type { Asset, Release } from "./types.js";
export declare class LoaderError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function assertOrigin(raw: string): string;
export declare function assertAssetUrl(raw: string, origins: readonly string[]): URL;
/** Returns a detached immutable snapshot. Release IDs must never be reused. */
export declare function parseRelease(input: unknown, origins: readonly string[]): Release;
export declare function assetKey(a: Asset): string;
export declare function releaseKey(r: Release): string;
/** Canonical identity prevents object-property order from creating a false release conflict. */
export declare function releaseIdentity(r: Release): string;
export declare function canonicalJson(value: unknown): string;
export declare function freezeJson(value: unknown): void;
