import type {Asset, Release, LoaderEvent} from "./types.js";
import {assetKey, releaseKey, parseRelease, LoaderError} from "./manifest.js";
import {httpTransport, MemoryStore, verifyBytes} from "./transport.js";
import type {ByteStore, FetchAsset} from "./transport.js";

export interface LoadContext {
  readonly release: Release;
  readonly signal: AbortSignal;
  bytes(id: string): Promise<Uint8Array>;
}
export interface Adapter<T> { activate(context: LoadContext): Promise<T>; }
export interface Policy {
  readonly origins: readonly string[];
  readonly maxPrepareBytes: number;
  readonly maxAssetBytes: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
  allowPreparation(release: Release): boolean;
}
export function browserPolicy(origins: readonly string[]): Policy {
  return {origins, maxPrepareBytes: 8 * 1024 * 1024, maxAssetBytes: 64 * 1024 * 1024,
    concurrency: 2, timeoutMs: 30000,
    allowPreparation: () => {
      const n = globalThis.navigator as Navigator & {connection?: {saveData?: boolean; effectiveType?: string}};
      return !n?.connection?.saveData && !["slow-2g", "2g"].includes(n?.connection?.effectiveType ?? "");
    }};
}
/** One coordinator per document/worker. Share it across product components. */
export class Coordinator {
  readonly policy: Policy;
  private readonly manifests = new Map<string, {release: Release; identity: string}>();
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly active = new Map<string, {adapter: Adapter<unknown>; promise: Promise<unknown>}>();
  private running = 0;
  private readonly queue: Array<() => void> = [];
  constructor(policy: Policy, readonly transport: FetchAsset = httpTransport(),
    readonly store: ByteStore = new MemoryStore(), readonly report: (event: LoaderEvent) => void = () => {}) {
    for (const n of [policy.maxPrepareBytes, policy.maxAssetBytes, policy.concurrency, policy.timeoutMs])
      if (!Number.isSafeInteger(n) || n < 1) throw new LoaderError("budget", "Policy limits must be positive integers");
    this.policy = Object.freeze({...policy, origins: Object.freeze([...policy.origins])});
  }
  register(input: unknown): Release {
    const r = parseRelease(input, this.policy.origins), key = releaseKey(r);
    const identity = JSON.stringify({...r, extensions: undefined});
    const old = this.manifests.get(key);
    if (old && old.identity !== identity) throw new LoaderError("release-conflict", "Release ID already identifies different assets");
    this.manifests.set(key, {release:r, identity});
    return r;
  }
  private emit(event: LoaderEvent) { try { this.report(Object.freeze(event)); } catch { /* telemetry cannot break loading */ } }
  private get(key: string) {
    const entry = this.manifests.get(key);
    if (!entry) throw new LoaderError("unregistered", "Register the release before use");
    return entry.release;
  }
  private async slot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.running >= this.policy.concurrency) await new Promise<void>((resolve, reject) => {
      const grant = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { const i = this.queue.indexOf(grant); if (i >= 0) this.queue.splice(i, 1); reject(signal.reason); };
      this.queue.push(grant); signal.addEventListener("abort", abort, {once:true});
    }); else this.running++;
    try { signal.throwIfAborted(); return await work(); }
    finally { const next = this.queue.shift(); if (next) next(); else this.running--; }
  }
  private async bytes(r: Release, id: string, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    const a = r.assets.find(a => a.id === id);
    if (!a) throw new LoaderError("asset", "Unknown asset");
    if (a.bytes > this.policy.maxAssetBytes) throw new LoaderError("budget", "Asset exceeds policy");
    return this.slot(signal, async () => {
      const key = assetKey(a), cached = await this.store.get(key).catch(() => undefined);
      if (cached) {
        try { await verifyBytes(a, cached); signal.throwIfAborted(); return cached; }
        catch { await this.store.delete(key).catch(() => {}); signal.throwIfAborted(); }
      }
      const bytes = await this.transport(a, signal);
      signal.throwIfAborted(); await verifyBytes(a, bytes); signal.throwIfAborted();
      await this.store.put(key, bytes).catch(() => {});
      this.emit({phase:"fetch", appId:r.appId, release:r.release, assetId:a.id, bytes:bytes.length});
      return bytes;
    });
  }
  /** A supplied signal owns this preparation call; cancellation is never shared with another caller. */
  prefetch(key: string, signal?: AbortSignal): Promise<void> {
    const r = this.get(key);
    if (!this.policy.allowPreparation(r)) return Promise.resolve();
    const selected = r.assets.filter(a => a.prepare);
    if (selected.reduce((n,a) => n+a.bytes,0) > this.policy.maxPrepareBytes ||
        selected.some(a => a.bytes > this.policy.maxAssetBytes))
      return Promise.reject(new LoaderError("budget", "Preparation exceeds policy"));
    if (!signal && this.preparing.has(key)) return this.preparing.get(key)!;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, {once:true});
    const timer = setTimeout(() => controller.abort(new LoaderError("timeout", "Preparation timed out")), this.policy.timeoutMs);
    const p = Promise.all(selected.map(a => this.bytes(r, a.id, controller.signal)))
      .then(() => { controller.signal.throwIfAborted(); this.emit({phase:"prepared",appId:r.appId,release:r.release}); })
      .catch(error => { controller.abort(error); throw error; })
      .finally(() => { clearTimeout(timer); signal?.removeEventListener("abort",cancel); if (!signal) this.preparing.delete(key); });
    if (!signal) this.preparing.set(key,p);
    return p;
  }
  /** Activation owns a lifetime separate from speculative fetch; a failed warmup never prevents it. */
  activate<T>(key: string, adapter: Adapter<T>): Promise<T> {
    const r = this.get(key), old = this.active.get(key);
    if (old) {
      if (old.adapter !== adapter) return Promise.reject(new LoaderError("adapter-conflict", "Release already has an activation owner"));
      return old.promise as Promise<T>;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new LoaderError("timeout", "Activation timed out")), this.policy.timeoutMs);
    const p = Promise.resolve().then(async () => {
      await this.preparing.get(key)?.catch(() => {});
      controller.signal.throwIfAborted();
      const result = await adapter.activate({release:r, signal:controller.signal, bytes:id => this.bytes(r,id,controller.signal)});
      controller.signal.throwIfAborted();
      this.emit({phase:"activated",appId:r.appId,release:r.release});
      return result;
    }).catch(error => { this.active.delete(key); this.emit({phase:"error",appId:r.appId,release:r.release}); throw error; })
      .finally(() => clearTimeout(timer));
    this.active.set(key,{adapter,promise:p});
    return p;
  }
}

