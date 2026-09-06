import type {Release, LoaderEvent} from "./types.js";
import {assetKey, releaseKey, releaseIdentity, parseRelease, assertOrigin, LoaderError} from "./manifest.js";
import {httpTransport, MemoryStore, verifyBytes} from "./transport.js";
import type {ByteStore, FetchAsset} from "./transport.js";

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
export function browserPolicy(origins: readonly string[]): Policy {
  return {origins, maxPrepareBytes: 8 * 1024 * 1024, maxAssetBytes: 64 * 1024 * 1024,
    concurrency: 2, timeoutMs: 30000, activationJoinMs: 50,
    allowPreparation: () => {
      const n = globalThis.navigator as Navigator & {connection?: {saveData?: boolean; effectiveType?: string}};
      return !n?.connection?.saveData && !["slow-2g", "2g"].includes(n?.connection?.effectiveType ?? "");
    }};
}
interface PreparationJob {
  readonly controller: AbortController;
  readonly leases: Set<symbol>;
  promise: Promise<PreparationOutcome>;
  claimed: boolean;
  settled: boolean;
}
/** One coordinator per document/worker. Share it across product components. */
export class Coordinator {
  readonly policy: Policy;
  private readonly manifests = new Map<string, {release: Release; identity: string}>();
  private readonly preparing = new Map<string, PreparationJob>();
  private readonly active = new Map<string, {adapter: Adapter<unknown>; promise: Promise<unknown>}>();
  private running = 0;
  private readonly queue: Array<() => void> = [];
  constructor(policy: Policy, readonly transport: FetchAsset = httpTransport(),
    readonly store: ByteStore = new MemoryStore(), readonly report: (event: LoaderEvent) => void = () => {}) {
    for (const n of [policy.maxPrepareBytes, policy.maxAssetBytes, policy.concurrency, policy.timeoutMs])
      if (!Number.isSafeInteger(n) || n < 1) throw new LoaderError("budget", "Policy limits must be positive integers");
    if (!Number.isSafeInteger(policy.activationJoinMs) || policy.activationJoinMs < 0)
      throw new LoaderError("budget", "Activation join must be a non-negative safe integer");
    const origins = policy.origins.map(assertOrigin);
    const activationJoinMs = Math.min(policy.activationJoinMs, policy.timeoutMs);
    this.policy = Object.freeze({...policy, activationJoinMs, origins: Object.freeze(origins)});
  }
  register(input: unknown): Release {
    const r = parseRelease(input, this.policy.origins), key = releaseKey(r);
    const identity = releaseIdentity(r);
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
  private newPreparation(key: string, r: Release): PreparationJob {
    const job: PreparationJob = {
      controller: new AbortController(),
      leases: new Set<symbol>(),
      promise: Promise.resolve({} as PreparationOutcome),
      claimed: false,
      settled: false,
    } satisfies PreparationJob;
    this.preparing.set(key, job);
    const timer = setTimeout(() => job.controller.abort(new LoaderError("timeout", "Preparation timed out")), this.policy.timeoutMs);
    job.promise = this.runPreparation(r, job).finally(() => {
      clearTimeout(timer);
      job.settled = true;
      if (this.preparing.get(key) === job) this.preparing.delete(key);
    });
    return job;
  }
  private async runPreparation(r: Release, job: PreparationJob): Promise<PreparationOutcome> {
    const selected = r.assets.filter(a => a.prepare);
    const completed = new Set<string>();
    const tasks = selected.map(async a => {
      await this.bytes(r, a.id, job.controller.signal);
      completed.add(a.id);
    });
    try {
      await Promise.all(tasks);
      job.controller.signal.throwIfAborted();
      const prepared = selected.filter(a => completed.has(a.id));
      const outcome = this.outcome(r, "warmed", prepared.map(a => a.id), [], prepared.reduce((n, a) => n + a.bytes, 0));
      this.emit({phase: "prepared", appId: r.appId, release: r.release});
      return outcome;
    } catch (error) {
      const cancelled = job.controller.signal.aborted;
      if (!cancelled) job.controller.abort(error);
      await Promise.allSettled(tasks);
      const prepared = selected.filter(a => completed.has(a.id));
      const skipped = selected.filter(a => !completed.has(a.id)).map(a => ({
        id: a.id,
        reason: cancelled ? "cancelled" : "failed",
      }));
      if (!cancelled) this.emit({phase: "error", appId: r.appId, release: r.release});
      return this.outcome(r, cancelled ? "cancelled" : "failed", prepared.map(a => a.id), skipped,
        prepared.reduce((n, a) => n + a.bytes, 0), reasonOf(error));
    }
  }
  private outcome(r: Release, status: PreparationStatus, prepared: readonly string[], skipped: readonly PreparationSkip[],
    bytes: number, reason?: string): PreparationOutcome {
    return Object.freeze({
      status, appId: r.appId, release: r.release,
      prepared: Object.freeze([...prepared]), skipped: Object.freeze(skipped.map(s => Object.freeze({...s}))),
      bytes, ...(reason ? {reason} : {}),
    });
  }
  /** Acquire a shared, cancellable preparation lease. Releasing one lease never cancels another. */
  prepare(key: string, signal?: AbortSignal): PreparationLease {
    const r = this.get(key);
    const selected = r.assets.filter(a => a.prepare);
    if (!this.policy.allowPreparation(r)) {
      const outcome = this.outcome(r, "skipped", [], selected.map(a => ({id: a.id, reason: "policy-declined"})), 0, "policy-declined");
      return {promise: Promise.resolve(outcome), release: () => {}};
    }
    if (selected.reduce((n,a) => n+a.bytes,0) > this.policy.maxPrepareBytes ||
        selected.some(a => a.bytes > this.policy.maxAssetBytes))
      throw new LoaderError("budget", "Preparation exceeds policy");
    const job = this.preparing.get(key) ?? this.newPreparation(key, r);
    const token = Symbol(key);
    job.leases.add(token);
    let released = false;
    let onAbort: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      job.leases.delete(token);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      if (!job.settled && !job.claimed && job.leases.size === 0)
        job.controller.abort(new LoaderError("cancelled", "Preparation released"));
    };
    if (signal?.aborted) release();
    else if (signal) { onAbort = release; signal.addEventListener("abort", onAbort, {once: true}); }
    return {promise: job.promise, release};
  }
  /** Fetch-only preparation. The resolved outcome is telemetry-friendly; it never blocks activation. */
  prefetch(key: string, signal?: AbortSignal): Promise<PreparationOutcome> {
    let lease: PreparationLease;
    try { lease = this.prepare(key, signal); }
    catch (error) { return Promise.reject(error); }
    return lease.promise.then(outcome => signal?.aborted ? this.outcome(
      this.get(key), "cancelled", outcome.prepared, outcome.skipped, outcome.bytes, "caller-aborted") : outcome)
      .finally(lease.release);
  }
  /** Abort unclaimed preparation for one release, for pagehide or an explicit policy decision. */
  cancelPreparation(key: string): boolean {
    const job = this.preparing.get(key);
    if (!job || job.settled || job.claimed) return false;
    job.controller.abort(new LoaderError("cancelled", "Preparation cancelled"));
    return true;
  }
  /** Abort all speculative jobs that have not been claimed by activation. */
  cancelAllPreparation(): void {
    for (const key of this.preparing.keys()) this.cancelPreparation(key);
  }
  private async joinPreparation(job: PreparationJob): Promise<void> {
    if (job.settled) return;
    if (this.policy.activationJoinMs === 0) {
      job.controller.abort(new LoaderError("cancelled", "Activation took ownership"));
      return;
    }
    await new Promise<void>(resolve => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, this.policy.activationJoinMs);
      void job.promise.then(finish, finish);
    });
    if (!job.settled) job.controller.abort(new LoaderError("cancelled", "Activation took ownership"));
  }
  /** Activation owns a lifetime separate from speculative fetch; a failed warmup never prevents it. */
  activate<T>(key: string, adapter: Adapter<T>): Promise<T> {
    const r = this.get(key), old = this.active.get(key);
    if (old) {
      if (old.adapter !== adapter) return Promise.reject(new LoaderError("adapter-conflict", "Release already has an activation owner"));
      return old.promise as Promise<T>;
    }
    const preparation = this.preparing.get(key);
    if (preparation) preparation.claimed = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new LoaderError("timeout", "Activation timed out")), this.policy.timeoutMs);
    const p = Promise.resolve().then(async () => {
      if (preparation) await this.joinPreparation(preparation);
      controller.signal.throwIfAborted();
      const result = await abortable(adapter.activate({release:r, signal:controller.signal, bytes:id => this.bytes(r,id,controller.signal)}), controller.signal);
      controller.signal.throwIfAborted();
      this.emit({phase:"activated",appId:r.appId,release:r.release});
      return result;
    }).catch(error => { this.emit({phase:"error",appId:r.appId,release:r.release}); throw error; })
      .finally(() => clearTimeout(timer));
    this.active.set(key,{adapter,promise:p});
    return p;
  }
  /** Release a persistent-shell activation; the adapter owns the actual cleanup semantics. */
  async deactivate(key: string): Promise<boolean> {
    const entry = this.active.get(key);
    if (!entry) return false;
    try {
      const instance = await entry.promise;
      if (entry.adapter.deactivate) await entry.adapter.deactivate(instance);
    } finally {
      this.active.delete(key);
    }
    return true;
  }
}
function reasonOf(error: unknown): string {
  if (error instanceof LoaderError) return error.code;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return "error";
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, {once:true});
    work.then(resolve,reject).finally(() => signal.removeEventListener("abort",abort));
  });
}
