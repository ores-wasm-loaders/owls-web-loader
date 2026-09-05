import type { Asset, Release } from "./types.js";
export declare class LoaderError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function assertAssetUrl(raw: string, origins: readonly string[]): URL;
/** Returns a detached immutable snapshot. Release IDs must never be reused. */
export declare function parseRelease(input: unknown, origins: readonly string[]): Release;
export declare function assetKey(a: Asset): string;
export declare function releaseKey(r: Release): string;
