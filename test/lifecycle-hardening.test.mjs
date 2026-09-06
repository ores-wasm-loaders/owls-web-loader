import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { Coordinator, browserPolicy, MemoryStore } from '../index.mjs';
import { prepareOnIntent } from '../src/hints.mjs';

globalThis.crypto ??= webcrypto;

const ORIGIN = 'https://assets.ores-wasm-loaders.test';
const BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const SHA256 = createHash('sha256').update(BYTES).digest('hex');

function release() {
  return {
    schemaVersion: 2,
    appId: 'lifecycle-demo',
    release: '2026.09.06-a',
    runtime: 'raw-wasm',
    entrypoint: 'module',
    assets: [{
      id: 'module',
      url: `${ORIGIN}/releases/lifecycle-demo/2026.09.06-a/app.wasm`,
      kind: 'wasm',
      role: 'module',
      stage: 'critical',
      bytes: BYTES.length,
      sha256: SHA256,
      prepare: true,
    }],
    prepareBudget: { maxBytes: 1024, maxConcurrency: 1, furthestStage: 'fetch' },
    activation: { mode: 'run-app' },
  };
}

function setup(transport, overrides = {}) {
  const coordinator = new Coordinator(
    browserPolicy([ORIGIN], { timeoutMs: 1_000, ...overrides }),
    { transport, store: new MemoryStore() },
  );
  coordinator.register(release());
  return coordinator;
}

const KEY = 'lifecycle-demo@2026.09.06-a';

test('preparation leases share one job and one release cannot cancel another', async () => {
  let calls = 0;
  const coordinator = setup(async () => { calls += 1; return BYTES; });
  const first = coordinator.prepare(KEY);
  const second = coordinator.prepare(KEY);
  first.release();
  const outcome = await second.promise;
  second.release();
  assert.equal(outcome.status, 'warmed');
  assert.equal(calls, 1);
});

test('explicit preparation cancellation aborts the underlying unclaimed job', async () => {
  let aborted = false;
  const coordinator = setup((_asset, signal) => new Promise((resolve, reject) => {
    const cancel = () => { aborted = true; reject(signal.reason); };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }));
  const pending = coordinator.prefetch(KEY);
  await Promise.resolve();
  assert.equal(coordinator.cancel(KEY), true);
  const outcome = await pending;
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.cancelled, true);
  assert.equal(aborted, true);
});

test('activation gives speculative preparation only a bounded handoff', async () => {
  const coordinator = setup((_asset, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(BYTES), 800);
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }), { activationJoinMs: 10 });
  const pending = coordinator.prefetch(KEY);
  await Promise.resolve();
  const started = Date.now();
  const result = await coordinator.activate(KEY, { activate: async () => 'ready' });
  assert.equal(result, 'ready');
  assert.ok(Date.now() - started < 200, 'activation must not wait for the speculative deadline');
  assert.equal((await pending).status, 'cancelled');
});

test('caller cancellation is prompt while another lease keeps shared work alive', async () => {
  let finish;
  const coordinator = setup(() => new Promise((resolve) => { finish = () => resolve(BYTES); }));
  const keeper = coordinator.prepare(KEY);
  const controller = new AbortController();
  const caller = coordinator.prefetch(KEY, controller.signal);
  controller.abort();
  assert.equal((await caller).status, 'cancelled');
  finish();
  assert.equal((await keeper.promise).status, 'warmed');
  keeper.release();
});

test('intent preparation honors dwell, exit grace, focus retention, and pagehide', async () => {
  let calls = 0;
  const coordinator = setup(async () => { calls += 1; return BYTES; });
  const listeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const view = {
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: (name) => windowListeners.delete(name),
  };
  const document = {
    visibilityState: 'visible',
    defaultView: view,
    addEventListener: (name, fn) => documentListeners.set(name, fn),
    removeEventListener: (name) => documentListeners.delete(name),
  };
  const element = {
    ownerDocument: document,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const stop = prepareOnIntent(element, coordinator, KEY, { dwellMs: 20, exitGraceMs: 20 });

  listeners.get('pointerenter')();
  windowListeners.get('pagehide')({ type: 'pagehide' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 0);
  windowListeners.get('pageshow')({ type: 'pageshow' });

  listeners.get('pointerenter')();
  listeners.get('pointerleave')();
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(calls, 0);

  listeners.get('pointerenter')();
  listeners.get('focusin')();
  listeners.get('pointerleave')();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);

  listeners.get('focusout')();
  await new Promise((resolve) => setTimeout(resolve, 25));
  stop();
});

test('pagehide releases only the link lease while another consumer keeps shared work alive', async (t) => {
  let finish;
  let calls = 0;
  const coordinator = setup(() => {
    calls += 1;
    return new Promise((resolve) => { finish = () => resolve(BYTES); });
  });
  const keeper = coordinator.prepare(KEY);
  t.after(() => keeper.release());
  const view = new EventTarget();
  const doc = Object.assign(new EventTarget(), { defaultView: view, visibilityState: 'visible' });
  const element = Object.assign(new EventTarget(), { ownerDocument: doc, isConnected: true });
  const stop = prepareOnIntent(element, coordinator, KEY);
  t.after(stop);
  element.dispatchEvent(new Event('pointerdown'));
  view.dispatchEvent(new Event('pagehide'));
  finish();
  assert.equal((await keeper.promise).status, 'warmed');
  assert.equal(calls, 1);
});
