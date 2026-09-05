import type { Coordinator, Adapter } from "./coordinator.js";
export interface BridgeRequest {
    requestId: string;
    method: "prefetch" | "activate";
    releaseKey: string;
    document: string;
}
/** Attach to the exact retained document; the native host receives completion, not runtime objects. */
export declare function createWebViewBridge(coordinator: Coordinator, adapters: ReadonlyMap<string, Adapter<unknown>>, currentDocument: () => string, reply: (json: string) => void): Readonly<{
    receive(input: unknown): void;
}>;
