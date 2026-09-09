import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Coordinator, browserPolicy } from '../src/coordinator.mjs';
import { prefetchRoute } from '../src/routes.mjs';

const ORIGIN = 'https://assets.example.test';
const bytes = Object.freeze({
  'app.js': Uint8Array.from([1]),
  'app_bg.wasm': Uint8Array.from([2]),
  'shared-a.wasm': Uint8Array.from([3, 3, 3]),
  'shared-b.wasm': Uint8Array.from([4, 4, 4, 4]),
  'route-app.wasm': Uint8Array.from([5, 5, 5, 5, 5]),
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function asset(id, kind, role, dependencies = []) {
  return {
    id,
    url: `${ORIGIN}/releases/r1/${id}`,
    kind,
    role,
    stage: 'lazy',
    dependencies,
    bytes: bytes[id].length,
    sha256: sha256(bytes[id]),
    prepare: false,
  };
}

function manifest(maxBytes = 64) {
  return {
    schemaVersion: 2,
    appId: 'dioxus-route-pilot',
    release: 'r1',
    runtime: 'wasm-bindgen',
    framework: 'dioxus',
    entrypoint: 'app.js',
    assets: [
      asset('app.js', 'module', 'glue'),
      asset('app_bg.wasm', 'wasm', 'module'),
      asset('shared-a.wasm', 'wasm', 'chunk'),
      asset('shared-b.wasm', 'wasm', 'chunk', ['shared-a.wasm']),
      asset('route-app.wasm', 'wasm', 'chunk', ['shared-a.wasm', 'shared-b.wasm']),
    ],
    prepareBudget: {
      maxBytes,
      maxConcurrency: 2,
      furthestStage: 'fetch',
    },
    activation: {
      mode: 'mount-route',
      routes: {
        '/app': 'route-app.wasm',
      },
    },
  };
}

function coordinator({ maxPrepareBytes = 64, allowPreparation = () => true, fail = null } = {}) {
  const requests = [];
  const transport = async (asset, signal) => {
    signal.throwIfAborted();
    requests.push(asset.id);
    if (asset.id === fail) throw new Error(`forced ${asset.id} failure`);
    return Uint8Array.from(bytes[asset.id]);
  };
  const policy = browserPolicy([ORIGIN], {
    maxPrepareBytes,
    maxAssetBytes: 64,
    concurrency: 2,
    timeoutMs: 5_000,
    allowPreparation,
  });
  return { coordinator: new Coordinator(policy, { transport }), requests };
}

function register(instance, candidate = manifest()) {
  const admitted = instance.register(candidate);
  return `${admitted.appId}@${admitted.release}`;
}

test('route preparation follows the admitted dependency DAG and reuses verified cache entries', async () => {
  const subject = coordinator();
  const key = register(subject.coordinator);

  const first = await prefetchRoute(subject.coordinator, key, '/app/reports/2026');
  assert.equal(first.status, 'warmed');
  assert.equal(first.ready, true);
  assert.equal(first.target, 'route-app.wasm');
  assert.deepEqual(first.prepared, ['shared-a.wasm', 'shared-b.wasm', 'route-app.wasm']);
  assert.deepEqual(subject.requests, ['shared-a.wasm', 'shared-b.wasm', 'route-app.wasm']);
  assert.equal(first.bytes, 12);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.prepared));

  const second = await prefetchRoute(subject.coordinator, key, '/app');
  assert.equal(second.status, 'warmed');
  assert.deepEqual(second.prepared, first.prepared);
  assert.deepEqual(subject.requests, ['shared-a.wasm', 'shared-b.wasm', 'route-app.wasm'], 'second route intent must reuse verified cache bytes');
});

test('route-specific intent may fetch lazy prepare:false assets but still obeys the stricter byte budget', async () => {
  const subject = coordinator({ maxPrepareBytes: 7 });
  const key = register(subject.coordinator, manifest(20));

  const result = await prefetchRoute(subject.coordinator, key, '/app');
  assert.equal(result.status, 'partial');
  assert.equal(result.ready, false);
  assert.deepEqual(result.prepared, ['shared-a.wasm', 'shared-b.wasm']);
  assert.deepEqual(result.skipped, [{ id: 'route-app.wasm', reason: 'over-budget' }]);
  assert.deepEqual(subject.requests, ['shared-a.wasm', 'shared-b.wasm']);
  assert.equal(result.bytes, 7);
});

test('a failed dependency prevents dependents from being reported as prepared', async () => {
  const subject = coordinator({ fail: 'shared-a.wasm' });
  const key = register(subject.coordinator);

  const result = await prefetchRoute(subject.coordinator, key, '/app');
  assert.equal(result.status, 'failed');
  assert.equal(result.ready, false);
  assert.deepEqual(result.prepared, []);
  assert.deepEqual(subject.requests, ['shared-a.wasm']);
  assert.deepEqual(result.skipped, [
    { id: 'shared-a.wasm', reason: 'failed' },
    { id: 'shared-b.wasm', reason: 'dependency-unavailable' },
    { id: 'route-app.wasm', reason: 'dependency-unavailable' },
  ]);
  assert.match(result.reason, /forced shared-a\.wasm failure/);
});

test('policy denial, cancellation and unmapped routes do no transport work', async () => {
  const denied = coordinator({ allowPreparation: () => false });
  const deniedKey = register(denied.coordinator);
  const deniedResult = await prefetchRoute(denied.coordinator, deniedKey, '/app');
  assert.equal(deniedResult.status, 'skipped');
  assert.equal(deniedResult.reason, 'policy-declined');
  assert.equal(deniedResult.skipped.length, 3);
  assert.deepEqual(denied.requests, []);

  const cancelled = coordinator();
  const cancelledKey = register(cancelled.coordinator);
  const controller = new AbortController();
  controller.abort(new Error('caller left'));
  const cancelledResult = await prefetchRoute(cancelled.coordinator, cancelledKey, '/app', controller.signal);
  assert.equal(cancelledResult.status, 'cancelled');
  assert.equal(cancelledResult.ready, false);
  assert.deepEqual(cancelledResult.prepared, []);
  assert.deepEqual(cancelledResult.skipped.map(({ reason }) => reason), ['cancelled', 'cancelled', 'cancelled']);
  assert.deepEqual(cancelled.requests, []);

  const unmapped = coordinator();
  const unmappedKey = register(unmapped.coordinator);
  const unmappedResult = await prefetchRoute(unmapped.coordinator, unmappedKey, '/elsewhere');
  assert.equal(unmappedResult.status, 'skipped');
  assert.equal(unmappedResult.reason, 'unmapped-route');
  assert.equal(unmappedResult.target, null);
  assert.deepEqual(unmapped.requests, []);
});

test('invalid route input fails before any fetch', async () => {
  const subject = coordinator();
  const key = register(subject.coordinator);
  await assert.rejects(() => prefetchRoute(subject.coordinator, key, 'relative'), /absolute application path/);
  assert.deepEqual(subject.requests, []);
});
