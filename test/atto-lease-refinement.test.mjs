import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { Coordinator, browserPolicy, MemoryStore } from '../index.mjs';

// Real Coordinator/SharedFetches behavior, not an isolated Boolean reference.
globalThis.crypto ??= webcrypto;
const ORIGIN = 'https://leases.ores-wasm-loaders.test';
const BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const KEY = 'lease-refinement@v1';

function setup(transport, { report = () => {} } = {}) {
  const coordinator = new Coordinator(
    browserPolicy([ORIGIN], { timeoutMs: 2_000 }),
    { transport, store: new MemoryStore(), report },
  );
  coordinator.register({
    schemaVersion: 2,
    appId: 'lease-refinement',
    release: 'v1',
    runtime: 'raw-wasm',
    entrypoint: 'module',
    assets: [{
      id: 'module',
      url: `${ORIGIN}/release/v1/app.wasm`,
      kind: 'wasm',
      role: 'module',
      stage: 'critical',
      bytes: BYTES.length,
      sha256: createHash('sha256').update(BYTES).digest('hex'),
      prepare: true,
    }],
    prepareBudget: { maxBytes: 256, maxConcurrency: 1, furthestStage: 'fetch' },
    activation: { mode: 'run-app' },
  });
  return coordinator;
}

test('three independent leases cannot cancel each other and repeated release is idempotent', async () => {
  let complete;
  let started;
  let aborted = false;
  let calls = 0;
  const ready = new Promise((resolve) => { started = resolve; });
  const coordinator = setup((_asset, signal) => new Promise((resolve, reject) => {
    calls += 1;
    complete = () => resolve(BYTES);
    const onAbort = () => {
      aborted = true;
      reject(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    started();
  }));

  const first = coordinator.prepare(KEY);
  const second = coordinator.prepare(KEY);
  const third = coordinator.prepare(KEY);
  await ready;
  first.release();
  first.release();
  second.release();
  assert.equal(aborted, false, 'last remaining lease must keep the fetch alive');
  complete();
  assert.equal((await third.promise).status, 'warmed');
  third.release();
  assert.equal(calls, 1);
  assert.equal(aborted, false);
  assert.equal((await first.promise).status, 'warmed');
  assert.equal((await second.promise).status, 'warmed');
});

test('final owner aborts unclaimed fetch and next attempt is a fresh generation', async () => {
  let attempts = 0;
  let underlyingAborts = 0;
  const coordinator = setup((_asset, signal) => {
    attempts += 1;
    if (attempts > 1) return Promise.resolve(BYTES);
    return new Promise((_resolve, reject) => {
      const abort = () => { underlyingAborts += 1; reject(signal.reason); };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  });
  const first = coordinator.prepare(KEY);
  first.release();
  assert.equal((await first.promise).status, 'cancelled');
  assert.equal(underlyingAborts, 1);
  const retry = coordinator.prepare(KEY);
  const outcome = await retry.promise;
  retry.release();
  assert.equal(outcome.status, 'warmed');
  assert.deepEqual(outcome.prepared, ['module']);
  assert.equal(attempts, 2);
  assert.equal(coordinator.receiptFor(KEY)?.status, 'warmed');
});

test('three concurrent leases emit exactly one preparation-start event', async () => {
  const events = [];
  let finish;
  let signalStart;
  const started = new Promise((resolve) => { signalStart = resolve; });
  const coordinator = setup(() => new Promise((resolve) => {
    finish = () => resolve(BYTES);
    signalStart();
  }), { report: (event) => events.push(event) });

  const leases = [coordinator.prepare(KEY), coordinator.prepare(KEY), coordinator.prepare(KEY)];
  await started;
  // A low-level fetch cache can hide duplicate preparation jobs. The
  // prepare-start generation event is the independent observable witness.
  const admittedJobs = events.filter((event) => event.phase === 'prepare-start').length;
  finish();
  const outcomes = await Promise.all(leases.map((lease) => lease.promise));
  leases.forEach((lease) => lease.release());
  for (const outcome of outcomes) assert.equal(outcome.status, 'warmed');
  assert.equal(admittedJobs, 1, 'all concurrent leases must join one preparation job');
});
