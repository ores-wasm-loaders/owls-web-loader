// One coordinator per document or worker. Share it across a product's components.
//
// It owns two verbs, and the distance between them is the point of this package:
//
//   prefetch(key)            fetch-only, bounded, cancellable, integrity-checked. It never
//                            executes application code, authenticates, subscribes or writes,
//                            and failing is a non-event.
//
//   activate(key, adapter)   start or reuse the application in THIS document, using whatever
//                            preparation left behind — and working correctly when none did.
//
// What it does not claim: that a running application survives a navigation. It does not. Only
// a persistent shell keeps a runtime alive; everything else is byte and compilation reuse,
// which the browser grants at its discretion.

import { LoaderError, parseRelease, releaseSchema, preparableAssets, assetKey, releaseKey } from './contract.mjs';
import { httpTransport, MemoryStore, verifyBytes } from './transport.mjs';

/**
 * A policy is the page's own ceiling. The release's `prepareBudget` is the publisher's. The
 * coordinator obeys whichever is stricter, so neither side can spend the other's budget.
 */
export function browserPolicy(origins, overrides = {}) {
  return Object.freeze({
    origins,
    maxPrepareBytes: 8 * 1024 * 1024,
    maxAssetBytes: 64 * 1024 * 1024,
    concurrency: 2,
    timeoutMs: 30_000,
    /** Never spend someone's metered or slow connection on work they did not ask for. */
    allowPreparation: () => {
      const n = globalThis.navigator;
      return !n?.connection?.saveData && !['slow-2g', '2g'].includes(n?.connection?.effectiveType ?? '');
    },
    ...overrides,
  });
}

export class Coordinator {
  #manifests = new Map();
  #preparing = new Map();
  #receipts = new Map();
  #active = new Map();
  #queue = [];
  #running = 0;

  constructor(policy, { transport = httpTransport(), store = new MemoryStore(), report = () => {}, schema = releaseSchema } = {}) {
    for (const n of [policy.maxPrepareBytes, policy.maxAssetBytes, policy.concurrency, policy.timeoutMs]) {
      if (!Number.isSafeInteger(n) || n < 1) throw new LoaderError('budget', 'Policy limits must be positive integers');
    }
    this.policy = Object.freeze({ ...policy, origins: Object.freeze([...policy.origins]) });
    this.transport = transport;
    this.store = store;
    this.report = report;
    this.schema = schema;
  }

  /**
   * Register a release. A release id is immutable: seeing the same id describing different
   * assets means something republished under a name that was already taken, and that is
   * refused rather than reconciled — an old bootstrap meeting a new module is not debuggable.
   */
  register(input) {
    const release = parseRelease(input, this.policy.origins, this.schema);
    const key = releaseKey(release);
    const identity = JSON.stringify(release);
    const existing = this.#manifests.get(key);
    if (existing && existing.identity !== identity) {
      throw new LoaderError('release-conflict', `Release ${key} already identifies different assets`);
    }
    this.#manifests.set(key, { release, identity });
    return release;
  }

  /** Fetch and register in one step. The only network call the registry itself makes. */
  async load(url, { signal, fetcher = globalThis.fetch } = {}) {
    const response = await fetcher(url, { signal, credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new LoaderError('http', `Manifest ${url}: HTTP ${response.status}`);
    return this.register(await response.json());
  }

  get keys() {
    return [...this.#manifests.keys()];
  }

  get(key) {
    const entry = this.#manifests.get(key);
    if (!entry) throw new LoaderError('unregistered', `Register release ${key} before using it`);
    return entry.release;
  }

  /** What preparation achieved for this release, if anything. */
  receiptFor(key) {
    return this.#receipts.get(key) ?? null;
  }

  #emit(event) {
    try {
      this.report(Object.freeze(event));
    } catch {
      /* telemetry can never break loading */
    }
  }

  async #slot(signal, work) {
    signal.throwIfAborted();
    if (this.#running >= this.policy.concurrency) {
      await new Promise((resolve, reject) => {
        const grant = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const i = this.#queue.indexOf(grant);
          if (i >= 0) this.#queue.splice(i, 1);
          reject(signal.reason);
        };
        this.#queue.push(grant);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else {
      this.#running += 1;
    }
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      const next = this.#queue.shift();
      if (next) next();
      else this.#running -= 1;
    }
  }

  /** Bytes for one asset: cache, then network, verified either way before anyone sees them. */
  async bytes(release, id, signal) {
    signal.throwIfAborted();
    const asset = release.assets.find((a) => a.id === id);
    if (!asset) throw new LoaderError('asset', `Unknown asset \`${id}\``);
    if (asset.bytes > this.policy.maxAssetBytes) throw new LoaderError('budget', `Asset \`${id}\` exceeds the page's per-asset ceiling`);
    return this.#slot(signal, async () => {
      const key = assetKey(asset);
      const cached = await this.store.get(key).catch(() => undefined);
      if (cached) {
        try {
          await verifyBytes(asset, cached);
          signal.throwIfAborted();
          return cached;
        } catch {
          await this.store.delete(key).catch(() => {});
          signal.throwIfAborted();
        }
      }
      const bytes = await this.transport(asset, signal);
      signal.throwIfAborted();
      await verifyBytes(asset, bytes);
      signal.throwIfAborted();
      await this.store.put(key, bytes).catch(() => {});
      this.#emit({ phase: 'fetch', appId: release.appId, release: release.release, assetId: asset.id, bytes: bytes.length });
      return bytes;
    });
  }

  /**
   * Prepare a release without starting it.
   *
   * Over-budget is not an error: preparation takes what fits, in the order owls-interfaces
   * declares, and reports what it skipped. Rejecting the whole release because it is slightly
   * over budget prepares *nothing*, which is the opposite of the point.
   *
   * A supplied signal owns that one call; cancellation is never shared between callers.
   */
  prefetch(key, signal, { variant = 'module' } = {}) {
    const release = this.get(key);
    if (!this.policy.allowPreparation(release)) {
      return Promise.resolve(this.#record(key, release, [], [{ id: null, reason: 'policy-declined' }], 0, false));
    }
    if (!signal && this.#preparing.has(key)) return this.#preparing.get(key);

    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new LoaderError('timeout', 'Preparation timed out')), this.policy.timeoutMs);

    const budget = Math.min(this.policy.maxPrepareBytes, release.prepareBudget?.maxBytes ?? this.policy.maxPrepareBytes);
    const promise = this.#prepare(key, release, controller.signal, budget, variant)
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (!signal) this.#preparing.delete(key);
      });
    if (!signal) this.#preparing.set(key, promise);
    return promise;
  }

  async #prepare(key, release, signal, budget, variant) {
    this.#emit({ phase: 'prepare-start', appId: release.appId, release: release.release });
    const prepared = [];
    const skipped = [];
    let spent = 0;

    for (const asset of preparableAssets(release, { variant })) {
      if (signal.aborted) {
        skipped.push({ id: asset.id, reason: 'cancelled' });
        continue;
      }
      if (asset.bytes > this.policy.maxAssetBytes) {
        skipped.push({ id: asset.id, reason: 'over-asset-limit' });
        continue;
      }
      if (spent + asset.bytes > budget) {
        skipped.push({ id: asset.id, reason: 'over-budget' });
        continue;
      }
      try {
        await this.bytes(release, asset.id, signal);
        spent += asset.bytes;
        prepared.push(asset.id);
      } catch (error) {
        skipped.push({ id: asset.id, reason: signal.aborted ? 'cancelled' : 'failed', error });
      }
    }

    const receipt = this.#record(key, release, prepared, skipped, spent, signal.aborted);
    this.#emit({
      phase: 'prepared',
      appId: release.appId,
      release: release.release,
      bytes: spent,
      prepared: prepared.length,
      skipped: skipped.length,
      cancelled: receipt.cancelled,
    });
    return receipt;
  }

  #record(key, release, prepared, skipped, bytes, cancelled) {
    const receipt = Object.freeze({
      key,
      appId: release.appId,
      release: release.release,
      prepared: Object.freeze(prepared),
      skipped: Object.freeze(skipped.map((s) => Object.freeze({ id: s.id, reason: s.reason }))),
      bytes,
      cancelled,
    });
    this.#receipts.set(key, receipt);
    return receipt;
  }

  /** Cancel in-flight shared preparation. Activation afterwards is still correct. */
  cancel(key) {
    const pending = this.#preparing.get(key);
    if (!pending) return false;
    this.#preparing.delete(key);
    this.#emit({ phase: 'prepare-cancelled', appId: this.get(key).appId, release: this.get(key).release });
    return true;
  }

  /**
   * Start, or reuse, the application in this document.
   *
   * Activation owns a lifetime separate from speculative fetching: a failed or cancelled
   * warmup never prevents it, and a second caller gets the first activation rather than a
   * second application.
   */
  activate(key, adapter) {
    const release = this.get(key);
    const existing = this.#active.get(key);
    if (existing) {
      if (existing.adapter !== adapter) {
        return Promise.reject(new LoaderError('adapter-conflict', `Release ${key} already has an activation owner`));
      }
      return existing.promise;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new LoaderError('timeout', 'Activation timed out')), this.policy.timeoutMs);
    this.#emit({ phase: 'activate-start', appId: release.appId, release: release.release });

    const promise = Promise.resolve()
      .then(async () => {
        await this.#preparing.get(key)?.catch(() => {});
        controller.signal.throwIfAborted();
        const result = await abortable(
          adapter.activate({
            release,
            signal: controller.signal,
            bytes: (id) => this.bytes(release, id, controller.signal),
            prepared: this.receiptFor(key),
          }),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        this.#emit({ phase: 'activated', appId: release.appId, release: release.release, reusedPreparation: Boolean(this.receiptFor(key)) });
        return result;
      })
      .catch((error) => {
        this.#emit({ phase: 'error', appId: release.appId, release: release.release });
        throw error;
      })
      .finally(() => clearTimeout(timer));

    this.#active.set(key, { adapter, promise });
    return promise;
  }

  /** Release an activation (a shell removing a view). The adapter decides what that means. */
  async deactivate(key) {
    const entry = this.#active.get(key);
    if (!entry) return false;
    const instance = await entry.promise.catch(() => null);
    if (instance && typeof entry.adapter.deactivate === 'function') await entry.adapter.deactivate(instance);
    this.#active.delete(key);
    this.#emit({ phase: 'deactivated', appId: this.get(key).appId, release: this.get(key).release });
    return true;
  }
}

function abortable(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
