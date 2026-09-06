// Shared requests and consumer cancellation. Aborting a waiter never rewinds execution.
import { LoaderError } from './contract.mjs';

export function waitFor(work, signal) {
  if (!signal) return Promise.resolve(work);
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => { signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason);
    // Attach both handlers even for an already-aborted waiter: late rejection is observed.
    Promise.resolve(work).then((value) => finish(resolve, value), (error) => finish(reject, error));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Dedupe a compatible request, with a separate cancellation lease for each consumer. */
export class SharedFetches {
  #jobs = new Map();

  run(key, signal, work) {
    if (signal.aborted) return Promise.reject(signal.reason);
    let job = this.#jobs.get(key);
    if (!job || job.controller.signal.aborted) {
      job = { controller: new AbortController(), consumers: new Set(), settled: false };
      this.#jobs.set(key, job);
      job.promise = Promise.resolve().then(() => {
        job.controller.signal.throwIfAborted();
        return work(job.controller.signal);
      }).finally(() => {
        job.settled = true;
        if (this.#jobs.get(key) === job) this.#jobs.delete(key);
      });
    }
    const token = Symbol(key);
    job.consumers.add(token);
    return waitFor(job.promise, signal).finally(() => {
      job.consumers.delete(token);
      if (!job.settled && job.consumers.size === 0) {
        job.controller.abort(new LoaderError('cancelled', 'All request consumers released'));
        if (this.#jobs.get(key) === job) this.#jobs.delete(key);
      }
    });
  }
}

/**
 * Own mounts independently of the Coordinator's runtime registry. One host per document.
 * Hooks adapt a *running* runtime to a target; they must never start a second engine.
 */
export class ActivationHost {
  #targets = new WeakMap();
  #sequence = 0;

  constructor(coordinator, { report = () => {} } = {}) {
    this.coordinator = coordinator;
    this.report = (event) => { try { report(Object.freeze(event)); } catch { /* instrumentation isolation */ } };
  }

  activate(key, adapter, target, { attach, ready, signal } = {}) {
    try {
      signal?.throwIfAborted();
      const release = this.coordinator.get(key);
      const mode = release.activation?.mode ?? 'run-app';
      const kind = mode === 'hydrate-islands' ? 'document' : mode === 'attach-view' ? 'flutter-view' : 'root';
      if (target?.kind !== kind) throw new LoaderError('target', `Expected a ${kind} activation target`);
      const node = kind === 'document' ? target.document : target.element;
      const check = () => {
        signal?.throwIfAborted();
        if (!node || (kind === 'document' ? node.nodeType !== 9 : node.nodeType !== 1 || !node.isConnected)) {
          throw new LoaderError('target', 'Activation target is missing or disconnected');
        }
      };
      check();
      if (typeof ready !== 'function') throw new LoaderError('readiness', 'Supply an application useful-interaction assertion');
      if (kind !== 'document' && typeof attach !== 'function') throw new LoaderError('target', 'Supply an explicit mount hook');
      if (this.#targets.has(node)) throw new LoaderError('target-owner', 'Target already has an activation owner');
      const entry = {};
      this.#targets.set(node, entry);
      const operation = ++this.#sequence;
      const event = (phase) => this.report({ phase, appId: release.appId, release: release.release, operation });
      event('mount-start');
      // Synchronous acquisition lets click handlers release intent only AFTER runtime ownership.
      let runtime;
      try { runtime = this.coordinator.activate(key, adapter); }
      catch (error) { this.#targets.delete(node); throw error; }
      let detach;
      let removed = false;
      let removing;
      let attachStarted = false;
      const unmount = () => {
        if (removed) return Promise.resolve();
        if (removing) return removing;
        if (kind === 'document') return Promise.reject(new LoaderError('cleanup', 'Document hydration requires document replacement'));
        // Keep ownership on cleanup failure; simultaneous cleanup requests share one call.
        removing = Promise.resolve().then(() => detach?.()).then(() => {
          removed = true;
          if (this.#targets.get(node) === entry) this.#targets.delete(node);
          event('unmounted');
        }).catch((error) => { removing = undefined; throw error; });
        return removing;
      };
      const mounting = waitFor(runtime, signal).then(async (instance) => {
        check();
        event('runtime-ready');
        if (kind !== 'document') {
          attachStarted = true;
          detach = await attach(instance, node);
          if (typeof detach !== 'function') throw new LoaderError('cleanup', 'Mount hook must return a cleanup function');
          check();
        }
        event('mounted');
        const interactive = waitFor(Promise.resolve().then(() => {
          check();
          return ready(instance, node);
        }), signal).then(() => {
          check();
          if (removed || removing) throw new LoaderError('cancelled', 'View was removed before readiness');
          event('interactive');
        });
        // Observe a rejected readiness promise even when the caller has not awaited it yet.
        void interactive.catch(async () => {
          event('mount-error');
          if (kind !== 'document') await unmount().catch(() => {});
        });
        return Object.freeze({ runtime: instance, interactive, unmount });
      }).catch(async (error) => {
        if (typeof detach === 'function') await unmount();
        else if (kind !== 'document' && !attachStarted && this.#targets.get(node) === entry) this.#targets.delete(node);
        event('mount-error');
        throw error;
      });
      return mounting;
    } catch (error) { return Promise.reject(error); }
  }
}
