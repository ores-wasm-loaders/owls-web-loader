import type {Release, Asset} from "./types.js";
import type {Coordinator} from "./coordinator.js";
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
/** Pointer/focus/touch intent is cancellable and never activates the application. */
export function prepareOnIntent(element: EventTarget, coordinator: Coordinator, key: string,
    onError: (error: unknown) => void = () => {}): () => void {
  const controller = new AbortController();
  const begin = () => { void coordinator.prefetch(key,controller.signal).catch(onError); };
  const events = ["pointerenter","focusin","touchstart"];
  for (const event of events) element.addEventListener(event,begin,{passive:true,once:true});
  return () => { controller.abort(); for (const event of events) element.removeEventListener(event,begin); };
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

