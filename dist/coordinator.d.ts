import type { Release, LoaderEvent } from "./types.js";
import type { ByteStore, FetchAsset } from "./transport.js";
export interface LoadContext {
    readonly release: Release;
    readonly signal: AbortSignal;
    bytes(id: string): Promise<Uint8Array>;
}
export interface Adapter<T> {
    activate(context: LoadContext): Promise<T>;
    deactivate?(instance: T): void | Promise<void>;
}
export type PreparationStatus = "warmed" | "cancelled" | "failed" | "skipped";
export interface PreparationSkip {
    readonly id: string | undefined;
    readonly reason: string;
}
export interface PreparationOutcome {
    readonly status: PreparationStatus;
    readonly appId: string;
    readonly release: string;
    readonly prepared: readonly string[];
    readonly skipped: readonly PreparationSkip[];
    readonly bytes: number;
    readonly reason?: string;
}
export interface PreparationLease {
    readonly promise: Promise<PreparationOutcome>;
    release(): void;
}
export interface Policy {
    readonly origins: readonly string[];
    readonly maxPrepareBytes: number;
    readonly maxAssetBytes: number;
    readonly concurrency: number;
    readonly timeoutMs: number;
    /** Maximum time activation may join an already-running speculative fetch. */
    readonly activationJoinMs: number;
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
    private newPreparation;
    private runPreparation;
    private outcome;
    /** Acquire a shared, cancellable preparation lease. Releasing one lease never cancels another. */
    prepare(key: string, signal?: AbortSignal): PreparationLease;
    /** Fetch-only preparation. The resolved outcome is telemetry-friendly; it never blocks activation. */
    prefetch(key: string, signal?: AbortSignal): Promise<PreparationOutcome>;
    /** Abort unclaimed preparation for one release, for pagehide or an explicit policy decision. */
    cancelPreparation(key: string): boolean;
    /** Abort all speculative jobs that have not been claimed by activation. */
    cancelAllPreparation(): void;
    private joinPreparation;
    /** Activation owns a lifetime separate from speculative fetch; a failed warmup never prevents it. */
    activate<T>(key: string, adapter: Adapter<T>): Promise<T>;
    /** Release a persistent-shell activation; the adapter owns the actual cleanup semantics. */
    deactivate(key: string): Promise<boolean>;
}
