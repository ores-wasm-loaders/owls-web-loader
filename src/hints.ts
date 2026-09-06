import type {Release, Asset} from "./types.js";
import type {Coordinator, PreparationLease, PreparationOutcome} from "./coordinator.js";
import {LoaderError} from "./manifest.js";
export type Hint = "prefetch" | "preload" | "modulepreload";
export function hintDescriptors(release: Release, rel: Hint = "prefetch", budget = 8 * 1024 * 1024) {
  const selected = release.assets.filter(a => a.prepare && (rel !== "modulepreload" || a.kind === "module"));
  if (!Number.isSafeInteger(budget) || budget < 1 || selected.reduce((n,a) => n+a.bytes,0) > budget)
    throw new LoaderError("budget","Hints exceed declared preparation budget");
  return selected.map(a => Object.freeze({rel, href:a.url, as: rel === "modulepreload" ? undefined : "fetch",
    crossorigin:"anonymous", referrerpolicy:"no-referrer"}));
}
/** Browser-controlled hints are best effort. Use Coordinator.prefetch for enforceable body limits. */
export function addHints(doc: Document, release: Release, rel: Hint = "prefetch", budget?: number): () => void {
  const links = hintDescriptors(release,rel,budget).map(h => {
    const link = doc.createElement("link");
    for (const [key,value] of Object.entries(h)) if (value) link.setAttribute(key,value);
    doc.head.append(link); return link;
  });
  return () => links.forEach(link => link.remove());
}
export interface IntentOptions {
  readonly dwellMs?: number;
  readonly exitGraceMs?: number;
  readonly doc?: Document;
  readonly onOutcome?: (outcome: PreparationOutcome) => void;
  readonly onError?: (error: unknown) => void;
}
/** Pointer/focus/touch intent is cancellable, reference-counted and never activates the application. */
export function prepareOnIntent(element: EventTarget & {ownerDocument?: Document}, coordinator: Coordinator, key: string,
    optionsOrError: IntentOptions | ((error: unknown) => void) = {}): () => void {
  const options = typeof optionsOrError === "function" ? {onError: optionsOrError} : optionsOrError;
  const dwellMs = options.dwellMs ?? 150, exitGraceMs = options.exitGraceMs ?? 150;
  if (!Number.isSafeInteger(dwellMs) || dwellMs < 0 || !Number.isSafeInteger(exitGraceMs) || exitGraceMs < 0)
    throw new LoaderError("budget", "Intent delays must be non-negative safe integers");
  const doc = options.doc ?? element.ownerDocument;
  let pointer = false, focused = false, touched = false, stopped = false;
  let startTimer: number | undefined, releaseTimer: number | undefined;
  let lease: PreparationLease | undefined;
  const wanted = () => pointer || focused || touched;
  const clearStart = () => { if (startTimer !== undefined) { clearTimeout(startTimer); startTimer = undefined; } };
  const clearRelease = () => { if (releaseTimer !== undefined) { clearTimeout(releaseTimer); releaseTimer = undefined; } };
  const release = () => { clearRelease(); lease?.release(); lease = undefined; };
  const reportError = (error: unknown) => { try { options.onError?.(error); } catch { /* callbacks cannot break loading */ } };
  const reportOutcome = (outcome: PreparationOutcome) => { try { options.onOutcome?.(outcome); } catch { /* callbacks cannot break loading */ } };
  const start = () => {
    if (stopped || lease || !wanted()) return;
    try {
      lease = coordinator.prepare(key);
      void lease.promise.then(reportOutcome, reportError);
    } catch (error) { reportError(error); }
  };
  const arm = () => {
    clearRelease();
    if (startTimer === undefined && !lease) startTimer = setTimeout(() => { startTimer = undefined; start(); }, dwellMs);
  };
  const releaseLater = () => {
    if (wanted()) { clearRelease(); return; }
    clearStart();
    if (releaseTimer !== undefined) return;
    releaseTimer = setTimeout(() => { releaseTimer = undefined; if (!wanted()) release(); }, exitGraceMs);
  };
  const pointerEnter = () => { pointer = true; arm(); };
  const pointerLeave = () => { pointer = false; releaseLater(); };
  const focusIn = () => { focused = true; arm(); };
  const focusOut = () => { focused = false; releaseLater(); };
  const touchStart = () => { touched = true; clearStart(); start(); };
  const touchEnd = () => { touched = false; releaseLater(); };
  const pointerDown = () => { pointer = true; clearStart(); start(); };
  const hide = (event: Event) => {
    if (event.type === "pagehide" || doc?.visibilityState === "hidden") {
      pointer = false; focused = false; touched = false;
      clearStart(); release();
    }
  };
  element.addEventListener("pointerenter", pointerEnter, {passive:true});
  element.addEventListener("pointerleave", pointerLeave, {passive:true});
  element.addEventListener("pointerdown", pointerDown, {passive:true});
  element.addEventListener("focusin", focusIn, {passive:true});
  element.addEventListener("focusout", focusOut, {passive:true});
  element.addEventListener("touchstart", touchStart, {passive:true});
  element.addEventListener("touchend", touchEnd, {passive:true});
  element.addEventListener("touchcancel", touchEnd, {passive:true});
  doc?.addEventListener("visibilitychange", hide);
  doc?.addEventListener("pagehide", hide);
  return () => {
    stopped = true; pointer = false; focused = false; touched = false;
    clearStart(); release();
    element.removeEventListener("pointerenter", pointerEnter);
    element.removeEventListener("pointerleave", pointerLeave);
    element.removeEventListener("pointerdown", pointerDown);
    element.removeEventListener("focusin", focusIn);
    element.removeEventListener("focusout", focusOut);
    element.removeEventListener("touchstart", touchStart);
    element.removeEventListener("touchend", touchEnd);
    element.removeEventListener("touchcancel", touchEnd);
    doc?.removeEventListener("visibilitychange", hide);
    doc?.removeEventListener("pagehide", hide);
  };
}
export function prepareWhenIdle(coordinator: Coordinator, key: string,
  onError: (error: unknown) => void = () => {}): () => void {
  const controller = new AbortController();
  const start = () => { void coordinator.prefetch(key,controller.signal).catch(onError); };
  const win = globalThis as typeof globalThis & {requestIdleCallback?: (cb:()=>void)=>number; cancelIdleCallback?: (id:number)=>void};
  const idle = !!win.requestIdleCallback;
  const id = idle ? win.requestIdleCallback!(start) : setTimeout(start,200);
  return () => { controller.abort(); if (idle) win.cancelIdleCallback?.(id as number); else clearTimeout(id); };
}
