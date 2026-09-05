import type { Release } from "./types.js";
import type { Coordinator } from "./coordinator.js";
export type Hint = "prefetch" | "preload" | "modulepreload";
export declare function hintDescriptors(release: Release, rel?: Hint, budget?: number): Readonly<{
    rel: Hint;
    href: string;
    as: "fetch" | undefined;
    crossorigin: "anonymous";
    referrerpolicy: "no-referrer";
}>[];
/** Browser-controlled hints are best effort. Use Coordinator.prefetch for enforceable body limits. */
export declare function addHints(doc: Document, release: Release, rel?: Hint, budget?: number): () => void;
/** Pointer/focus/touch intent is cancellable and never activates the application. */
export declare function prepareOnIntent(element: EventTarget, coordinator: Coordinator, key: string, onError?: (error: unknown) => void): () => void;
export declare function prepareWhenIdle(coordinator: Coordinator, key: string, onError?: (error: unknown) => void): () => void;
