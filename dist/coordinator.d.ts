import type { Release, LoaderEvent } from "./types.js";
import type { ByteStore, FetchAsset } from "./transport.js";
export interface LoadContext {
    readonly release: Release;
    readonly signal: AbortSignal;
    bytes(id: string): Promise<Uint8Array>;
}
export interface Adapter<T> {
    activate(context: LoadContext): Promise<T>;
}
export interface Policy {
    readonly origins: readonly string[];
    readonly maxPrepareBytes: number;
    readonly maxAssetBytes: number;
    readonly concurrency: number;
    readonly timeoutMs: number;
    allowPreparation(release: Release): boolean;
}
export declare function browserPolicy(origins: readonly string[]): Policy;
/** One coordinator per document/worker. Share it across product components. */
export declare class Coordinator {
    readonly transport: FetchAsset;
    readonly store: ByteStore;
    readonly report: (event: LoaderEvent) => void;
    readonly policy: Policy;
    private readonly manifests;
    private readonly preparing;
    private readonly active;
    private running;
    private readonly queue;
    constructor(policy: Policy, transport?: FetchAsset, store?: ByteStore, report?: (event: LoaderEvent) => void);
    register(input: unknown): Release;
    private emit;
    private get;
    private slot;
    private bytes;
    /** A supplied signal owns this preparation call; cancellation is never shared with another caller. */
    prefetch(key: string, signal?: AbortSignal): Promise<void>;
    /** Activation owns a lifetime separate from speculative fetch; a failed warmup never prevents it. */
    activate<T>(key: string, adapter: Adapter<T>): Promise<T>;
}
