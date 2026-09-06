import type { Release } from "./types.js";
import type { Coordinator, PreparationOutcome } from "./coordinator.js";
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
export interface IntentOptions {
    readonly dwellMs?: number;
    readonly exitGraceMs?: number;
    readonly doc?: Document;
    readonly onOutcome?: (outcome: PreparationOutcome) => void;
    readonly onError?: (error: unknown) => void;
}
/** Pointer/focus/touch intent is cancellable, reference-counted and never activates the application. */
export declare function prepareOnIntent(element: EventTarget & {
    ownerDocument?: Document;
}, coordinator: Coordinator, key: string, optionsOrError?: IntentOptions | ((error: unknown) => void)): () => void;
export declare function prepareWhenIdle(coordinator: Coordinator, key: string, onError?: (error: unknown) => void): () => void;
