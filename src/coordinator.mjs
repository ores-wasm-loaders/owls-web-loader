// One coordinator per document or worker. Share it across a product's components.
//
// `prefetch` is fetch-only. `activate` owns execution. A running application is reusable only
// while its document remains alive; normal navigation never transfers a runtime to a new page.
import { LoaderError, parseRelease, releaseSchema, preparableAssets, assetKey, releaseKey } from './contract.mjs';
import { httpTransport, MemoryStore, verifyBytes } from './transport.mjs';

/**
 * A page policy is a ceiling. The release manifest also declares a preparation budget; the
 * coordinator obeys whichever side is stricter.
 */
export function browserPolicy(origins, overrides = {}) {
  return Object.freeze({
    origins,
    maxPrepareBytes: 8 * 1024 * 1024,
    maxAssetBytes: 64 * 1024 * 1024,
    concurrency: 2,
    timeoutMs: 30_000,
    /** Activation may briefly join useful speculative work, but never wait for its deadline. */
    activationJoinMs: 50,
    allowPreparation: () => {
      const connection = globalThis.navigator?.connection;
      return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
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
    const activationJoinMs = policy.activationJoinMs ?? 50;
    if (!Number.isSafeInteger(activationJoinMs) || activationJoinMs < 0) {
      throw new LoaderError('budget', 'Activation join must be a non-negative safe integer');
    }
    this.policy = Object.freeze({
      ...policy,
      activationJoinMs: Math.min(activationJoinMs, policy.timeoutMs),
      origins: Object.freeze([...policy.origins]),
    });
    this.transport = transport;
    this.store = store;
    this.report = report;
    this.schema = schema;
  }

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

  receiptFor(key, { variant = 'module' } = {}) {
    return this.#receipts.get(this.#preparationKey(key, variant)) ?? null;
  }

  #preparationKey(key, variant) {
    return `${key}\u0000${variant}`;
  }

  #emit(event) {
    try {
      this.report(Object.freeze(event));
    } catch {
      // Telemetry can never break loading.
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
          const index = this.#queue.indexOf(grant);
          if (index >= 0) this.#queue.splice(index, 1);
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

  async bytes(release, id, signal) {
    signal.throwIfAborted();
    const asset = release.assets.find((candidate) => candidate.id === id);
    if (!asset) throw new LoaderError('asset', `Unknown asset \`${id}\``);
    if (asset.bytes > this.policy.maxAssetBytes) {
      throw new LoaderError('budget', `Asset \`${id}\` exceeds the page's per-asset ceiling`);
    }
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

  #newPreparation(key, release, variant) {
    const mapKey = this.#preparationKey(key, variant);
    const job = {
      key,
      variant,
      controller: new AbortController(),
      leases: new Set(),
      claimed: false,
      settled: false,
      promise: null,
    };
    this.#preparing.set(mapKey, job);
    const timer = setTimeout(
      () => job.controller.abort(new LoaderError('timeout', 'Preparation timed out')),
      this.policy.timeoutMs,
    );
    job.promise = this.#prepare(mapKey, release, job.controller.signal, variant)
      .catch((error) => {
        const outcome = this.#outcome(mapKey, release, variant, [], [], 0, {
          status: job.controller.signal.aborted ? 'cancelled' : 'failed',
          reason: reasonOf(error),
        });
        this.#receipts.set(mapKey, outcome);
        return outcome;
      })
      .finally(() => {
        clearTimeout(timer);
        job.settled = true;
        if (this.#preparing.get(mapKey) === job) this.#preparing.delete(mapKey);
      });
    return job;
  }

  async #prepare(mapKey, release, signal, variant) {
    this.#emit({ phase: 'prepare-start', appId: release.appId, release: release.release, variant });
    const prepared = [];
    const skipped = [];
    let spent = 0;
    let firstFailure;
    const budget = Math.min(
      this.policy.maxPrepareBytes,
      release.prepareBudget?.maxBytes ?? this.policy.maxPrepareBytes,
    );

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
        firstFailure ??= error;
        skipped.push({ id: asset.id, reason: signal.aborted ? 'cancelled' : 'failed' });
      }
    }

    const status = signal.aborted
      ? 'cancelled'
      : skipped.some((entry) => entry.reason === 'failed')
        ? prepared.length ? 'partial' : 'failed'
        : skipped.length ? 'partial' : 'warmed';
    const outcome = this.#outcome(mapKey, release, variant, prepared, skipped, spent, {
      status,
      reason: signal.aborted ? reasonOf(signal.reason) : firstFailure ? reasonOf(firstFailure) : undefined,
    });
    this.#receipts.set(mapKey, outcome);
    this.#emit({
      phase: 'prepared',
      appId: release.appId,
      release: release.release,
      variant,
      status,
      bytes: spent,
      prepared: prepared.length,
      skipped: skipped.length,
      cancelled: outcome.cancelled,
    });
    return outcome;
  }

  #outcome(_mapKey, release, variant, prepared, skipped, bytes, { status, reason } = {}) {
    return Object.freeze({
      key: releaseKey(release),
      appId: release.appId,
      release: release.release,
      variant,
      status: status ?? 'warmed',
      prepared: Object.freeze([...prepared]),
      skipped: Object.freeze(skipped.map((entry) => Object.freeze({ id: entry.id ?? null, reason: entry.reason }))),
      bytes,
      cancelled: status === 'cancelled',
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * Acquire one consumer's interest in fetch-only preparation. Concurrent consumers share the
   * underlying work; releasing one lease never cancels another.
   */
  prepare(key, signal, { variant = 'module' } = {}) {
    const release = this.get(key);
    const mapKey = this.#preparationKey(key, variant);
    const selected = preparableAssets(release, { variant });
    if (!this.policy.allowPreparation(release)) {
      const outcome = this.#outcome(
        mapKey,
        release,
        variant,
        [],
        selected.map((asset) => ({ id: asset.id, reason: 'policy-declined' })),
        0,
        { status: 'skipped', reason: 'policy-declined' },
      );
      this.#receipts.set(mapKey, outcome);
      const done = Promise.resolve(outcome);
      return Object.freeze({ promise: done, done, release() {} });
    }

    const job = this.#preparing.get(mapKey) ?? this.#newPreparation(key, release, variant);
    const token = Symbol(mapKey);
    job.leases.add(token);
    let released = false;
    let onAbort;
    const releaseLease = () => {
      if (released) return;
      released = true;
      job.leases.delete(token);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      if (!job.settled && !job.claimed && job.leases.size === 0) {
        job.controller.abort(new LoaderError('cancelled', 'Preparation released'));
      }
    };
    if (signal?.aborted) releaseLease();
    else if (signal) {
      onAbort = releaseLease;
      signal.addEventListener('abort', onAbort, { once: true });
    }
    return Object.freeze({ promise: job.promise, done: job.promise, release: releaseLease });
  }

  /** Fetch-only preparation. Failure and cancellation never poison later activation. */
  prefetch(key, signal, { variant = 'module' } = {}) {
    let lease;
    try {
      lease = this.prepare(key, signal, { variant });
    } catch (error) {
      return Promise.reject(error);
    }
    if (!signal) return lease.promise.finally(lease.release);

    const release = this.get(key);
    const mapKey = this.#preparationKey(key, variant);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        resolve(outcome);
      };
      const abort = () => {
        const receipt = this.#receipts.get(mapKey);
        const prepared = receipt?.prepared ?? [];
        const preparedIds = new Set(prepared);
        const skipped = receipt?.skipped?.length
          ? receipt.skipped
          : preparableAssets(release, { variant })
              .filter((asset) => !preparedIds.has(asset.id))
              .map((asset) => ({ id: asset.id, reason: 'caller-aborted' }));
        finish(this.#outcome(
          mapKey,
          release,
          variant,
          prepared,
          skipped,
          receipt?.bytes ?? 0,
          { status: 'cancelled', reason: 'caller-aborted' },
        ));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void lease.promise.then(finish, (error) => finish(this.#outcome(
        mapKey,
        release,
        variant,
        [],
        [],
        0,
        { status: 'failed', reason: reasonOf(error) },
      )));
    }).finally(lease.release);
  }

  /** Abort unclaimed preparation for one release. */
  cancel(key, { variant } = {}) {
    let cancelled = false;
    for (const job of this.#preparing.values()) {
      if (job.key !== key || (variant && job.variant !== variant) || job.settled || job.claimed) continue;
      job.controller.abort(new LoaderError('cancelled', 'Preparation cancelled'));
      this.#emit({ phase: 'prepare-cancelled', appId: this.get(key).appId, release: this.get(key).release, variant: job.variant });
      cancelled = true;
      if (variant) break;
    }
    return cancelled;
  }

  cancelPreparation(key, options) {
    return this.cancel(key, options);
  }

  cancelAllPreparation() {
    let count = 0;
    for (const job of [...this.#preparing.values()]) {
      if (this.cancel(job.key, { variant: job.variant })) count += 1;
    }
    return count;
  }

  async #joinPreparation(job) {
    if (!job || job.settled) return;
    if (this.policy.activationJoinMs === 0) {
      job.controller.abort(new LoaderError('cancelled', 'Activation took ownership'));
      return;
    }
    let completed = false;
    await Promise.race([
      job.promise.then(() => { completed = true; }, () => { completed = true; }),
      new Promise((resolve) => setTimeout(resolve, this.policy.activationJoinMs)),
    ]);
    if (!completed && !job.settled) {
      job.controller.abort(new LoaderError('cancelled', 'Activation took ownership'));
    }
  }

  /** Start or reuse the application in this document. */
  activate(key, adapter) {
    const release = this.get(key);
    const existing = this.#active.get(key);
    if (existing) {
      if (existing.adapter !== adapter) {
        return Promise.reject(new LoaderError('adapter-conflict', `Release ${key} already has an activation owner`));
      }
      return existing.promise;
    }

    const preparation = this.#preparing.get(this.#preparationKey(key, 'module'))
      ?? [...this.#preparing.values()].find((job) => job.key === key);
    if (preparation) preparation.claimed = true;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new LoaderError('timeout', 'Activation timed out')),
      this.policy.timeoutMs,
    );
    this.#emit({ phase: 'activate-start', appId: release.appId, release: release.release });

    const promise = Promise.resolve()
      .then(async () => {
        await this.#joinPreparation(preparation);
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
        this.#emit({
          phase: 'activated',
          appId: release.appId,
          release: release.release,
          reusedPreparation: Boolean(this.receiptFor(key)),
        });
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

function reasonOf(error) {
  if (error instanceof LoaderError) return error.code;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return 'error';
}

function abortable(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
