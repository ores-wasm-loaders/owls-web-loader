// Deterministic Node conformance, NOT Flutter/Leptos SDK or browser certification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  Coordinator, browserPolicy, MemoryStore, ActivationHost, LeptosAdapter, DioxusAdapter,
  FlutterAdapter, mountFlutterView, pilotPolicy, connectApplicationLink,
  createLoaderReporter, prepareOnIntent, verifyBytes,
} from '../index.mjs';
import { fetchManifest } from '../src/manifest-fetch.mjs';
import { SharedFetches, waitFor } from '../src/ownership.mjs';

const ORIGIN = 'https://assets.example.test';
const BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const DIGEST = createHash('sha256').update(BYTES).digest('hex');
const KEY = 'pilot@r1';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function manifest(appId = 'pilot') {
  return { schemaVersion: 2, appId, release: 'r1', runtime: 'raw-wasm', entrypoint: 'module',
    assets: [{ id: 'module', url: `${ORIGIN}/${appId}/r1/app.wasm`, kind: 'wasm',
      role: 'module', stage: 'critical', bytes: 8, sha256: DIGEST, prepare: true }],
    activation: { mode: 'run-app' } };
}
function world(transport = async () => BYTES, policy = {}) {
  const c = new Coordinator(pilotPolicy([ORIGIN], { timeoutMs: 1000, ...policy }), { transport });
  c.register(manifest());
  return c;
}
function node(kind = 1) {
  return Object.assign(new EventTarget(), { nodeType: kind, isConnected: true,
    getBoundingClientRect: () => ({ width: 100, height: 100 }) });
}
function jsonResponse(value, type = 'application/json') {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { headers: { 'content-type': type } });
}

// WL-05/WL-08: resource ownership and cancellation.
test('concurrent byte consumers share transport and receive independent arrays', async () => {
  let calls = 0;
  const c = world(async () => { calls += 1; await tick(); return BYTES; });
  const a = new AbortController(), b = new AbortController();
  const [first, second] = await Promise.all([c.bytes(c.get(KEY), 'module', a.signal), c.bytes(c.get(KEY), 'module', b.signal)]);
  assert.equal(calls, 1);
  first[0] = 99;
  assert.equal(second[0], 0);
});
test('one byte consumer cannot abort another consumer', async () => {
  const gate = deferred();
  let transportSignal;
  const c = world(async (_asset, signal) => { transportSignal = signal; return gate.promise; });
  const a = new AbortController(), b = new AbortController();
  const one = c.bytes(c.get(KEY), 'module', a.signal);
  const two = c.bytes(c.get(KEY), 'module', b.signal);
  await tick(); a.abort(new Error('cancel one'));
  await assert.rejects(one, /cancel one/);
  assert.equal(transportSignal.aborted, false);
  gate.resolve(BYTES);
  assert.deepEqual(await two, BYTES);
});
test('all byte consumers cancelling aborts transport and permits a fresh attempt', async () => {
  let attempts = 0;
  const c = world((_asset, signal) => {
    attempts += 1;
    if (attempts > 1) return Promise.resolve(BYTES);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const control = new AbortController();
  const first = c.bytes(c.get(KEY), 'module', control.signal);
  await tick(); control.abort(); await assert.rejects(first);
  assert.deepEqual(await c.bytes(c.get(KEY), 'module', new AbortController().signal), BYTES);
  assert.equal(attempts, 2);
});
test('pre-aborted preparation starts no transport', async () => {
  let calls = 0; const c = world(async () => { calls += 1; return BYTES; });
  const control = new AbortController(); control.abort();
  assert.equal((await c.prepare(KEY, control.signal).done).status, 'cancelled');
  await tick(); assert.equal(calls, 0);
});
test('immediately reacquiring a cancelled preparation does not inherit its failure', async () => {
  const c = world(); const first = c.prepare(KEY); first.release();
  const second = c.prepare(KEY); const outcome = await second.done;
  assert.equal(outcome.status, 'warmed');
  await first.done;
  assert.equal(c.receiptFor(KEY).status, 'warmed');
});
test('failed speculative requests consume their declared reservation', async () => {
  let calls = 0;
  const c = world(async () => { calls += 1; throw new Error('partial transfer'); }, { maxPrepareBytes: 8 });
  const release = manifest('budget');
  release.assets.push({ ...release.assets[0], id: 'other', kind: 'data', url: `${ORIGIN}/budget/other` });
  c.register(release);
  const outcome = await c.prefetch('budget@r1');
  assert.equal(calls, 1);
  assert.ok(outcome.skipped.some((entry) => entry.id === 'other' && entry.reason === 'over-budget'));
});
test('pilot policy admits only one speculative release at a time', async () => {
  const gate = deferred(); const c = world(async () => gate.promise);
  c.register(manifest('other'));
  const first = c.prepare(KEY);
  const second = await c.prepare('other@r1').done;
  assert.equal(second.reason, 'candidate-limit');
  gate.resolve(BYTES); await first.done;
  assert.equal((await c.prepare('other@r1').done).status, 'warmed');
});
test('activation waiter cancellation does not cancel a shared runtime', async () => {
  const c = world(); const gate = deferred(); let starts = 0;
  const adapter = { activate: () => { starts += 1; return gate.promise; } };
  const control = new AbortController();
  const one = c.activate(KEY, adapter, { signal: control.signal });
  const two = c.activate(KEY, adapter);
  control.abort(); await assert.rejects(one);
  gate.resolve('runtime'); assert.equal(await two, 'runtime'); assert.equal(starts, 1);
});
test('invalid adapter does not poison the release activation registry', async () => {
  const c = world(); await assert.rejects(c.activate(KEY, {}), (e) => e.code === 'adapter');
  assert.equal(await c.activate(KEY, { activate: async () => 'ok' }), 'ok');
});
test('deactivation does not discard a live runtime with no teardown capability', async () => {
  const c = world(); let starts = 0; const adapter = { activate: async () => ++starts };
  assert.equal(await c.activate(KEY, adapter), 1);
  assert.equal(await c.deactivate(KEY), false);
  assert.equal(await c.activate(KEY, adapter), 1);
});
test('waiter rejects even if already cancelled while still observing late failure', async () => {
  const control = new AbortController(); control.abort(new Error('early'));
  await assert.rejects(waitFor(Promise.reject(new Error('late')), control.signal), /early/);
});
test('pooled failure is evicted rather than cached forever', async () => {
  const pool = new SharedFetches(); const signal = new AbortController().signal;
  await assert.rejects(pool.run('x', signal, async () => { throw new Error('first'); }));
  assert.equal(await pool.run('x', signal, async () => 42), 42);
});
test('Buffer views are hashed correctly and copied by the store', async () => {
  const buffer = Buffer.from(BYTES);
  await verifyBytes({ id: 'x', bytes: 8, sha256: DIGEST }, buffer);
  const store = new MemoryStore(); await store.put('x', buffer); buffer[0] = 20;
  assert.equal((await store.get('x'))[0], 0);
});

// WT-06: manifest transport fails closed before registration/execution.
for (const url of ['http://assets.example.test/m.json', 'https://evil.test/m.json',
  `${ORIGIN}/m.json?secret=x`, `${ORIGIN}/m.json#x`, 'https://user:pass@assets.example.test/m.json', 'not a URL']) {
  test(`manifest rejects unsafe URL ${url.split('?')[0]}`, async () => {
    let fetched = false;
    await assert.rejects(fetchManifest(url, [ORIGIN], { fetcher: async () => { fetched = true; } }), (e) => e.code === 'origin');
    assert.equal(fetched, false);
  });
}
test('manifest fetch is credentialless, redirectless, revalidating and bounded', async () => {
  const c = world(); let options;
  await c.load(`${ORIGIN}/manifest.json`, { fetcher: async (_url, init) => { options = init; return jsonResponse(manifest()); } });
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-cache'); assert.equal(options.referrerPolicy, 'no-referrer');
});
test('manifest stream exceeding byte ceiling is cancelled', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(32)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(fetchManifest(`${ORIGIN}/m.json`, [ORIGIN], { maxBytes: 16, fetcher: async () => response }), (e) => e.code === 'budget');
  assert.equal(cancelled, true);
});
test('manifest fetch times out even when injected fetch ignores abort', async () => {
  await assert.rejects(fetchManifest(`${ORIGIN}/m.json`, [ORIGIN], { timeoutMs: 5, fetcher: () => new Promise(() => {}) }), (e) => e.code === 'timeout');
});
test('manifest rejects wrong MIME and invalid JSON', async () => {
  await assert.rejects(fetchManifest(`${ORIGIN}/m.json`, [ORIGIN], { fetcher: async () => jsonResponse('{}', 'text/html') }), (e) => e.code === 'mime');
  await assert.rejects(fetchManifest(`${ORIGIN}/m.json`, [ORIGIN], { fetcher: async () => jsonResponse('{') }), (e) => e.code === 'manifest');
});

// WL-06: target ownership is not runtime ownership and readiness is not import completion.
test('mount separates runtime-ready from application interactive and cleanup is idempotent', async () => {
  const c = world(); const events = []; const host = new ActivationHost(c, { report: (e) => events.push(e) });
  const readiness = deferred(); let cleanups = 0;
  const handle = await host.activate(KEY, { activate: async () => 'running' }, { kind: 'root', element: node() }, {
    attach: async () => async () => { cleanups += 1; await tick(); }, ready: () => readiness.promise,
  });
  assert.ok(events.some((e) => e.phase === 'runtime-ready'));
  assert.ok(!events.some((e) => e.phase === 'interactive'));
  readiness.resolve(); await handle.interactive;
  await Promise.all([handle.unmount(), handle.unmount()]); assert.equal(cleanups, 1);
  assert.ok(events.some((e) => e.phase === 'interactive'));
});
test('wrong target and missing readiness reject before starting runtime', async () => {
  const host = new ActivationHost(world()); let calls = 0;
  const adapter = { activate: async () => { calls += 1; } };
  await assert.rejects(host.activate(KEY, adapter, { kind: 'document', document: node(9) }), (e) => e.code === 'target');
  await assert.rejects(host.activate(KEY, adapter, { kind: 'root', element: node() }, { attach() {} }), (e) => e.code === 'readiness');
  assert.equal(calls, 0);
});
test('target disconnected during runtime initialization is never mounted', async () => {
  const gate = deferred(); const target = node(); let mounts = 0;
  const pending = new ActivationHost(world()).activate(KEY, { activate: () => gate.promise }, { kind: 'root', element: target }, {
    attach: async () => { mounts += 1; return () => {}; }, ready: async () => {},
  });
  target.isConnected = false; gate.resolve('runtime');
  await assert.rejects(pending, (e) => e.code === 'target'); assert.equal(mounts, 0);
});
test('two activations cannot claim the same mount target', async () => {
  const host = new ActivationHost(world()); const target = { kind: 'root', element: node() };
  const adapter = { activate: async () => 'runtime' };
  const options = { attach: async () => () => {}, ready: async () => {} };
  const first = host.activate(KEY, adapter, target, options);
  await assert.rejects(host.activate(KEY, adapter, target, options), (e) => e.code === 'target-owner');
  const handle = await first; await handle.interactive; await handle.unmount();
  const second = await host.activate(KEY, adapter, target, options); await second.interactive; await second.unmount();
});
test('failed partial mount remains quarantined until explicit page recovery', async () => {
  const host = new ActivationHost(world()); const target = { kind: 'root', element: node() };
  const adapter = { activate: async () => 'runtime' };
  const options = { attach: async () => { throw new Error('partial'); }, ready: async () => {} };
  await assert.rejects(host.activate(KEY, adapter, target, options), /partial/);
  await assert.rejects(host.activate(KEY, adapter, target, options), (e) => e.code === 'target-owner');
});
test('readiness failure cleans up its own view', async () => {
  let cleanup = 0;
  const handle = await new ActivationHost(world()).activate(KEY, { activate: async () => 'runtime' }, { kind: 'root', element: node() }, {
    attach: async () => () => { cleanup += 1; }, ready: async () => { throw new Error('not useful'); },
  });
  await assert.rejects(handle.interactive, /not useful/); await tick(); assert.equal(cleanup, 1);
});

// WL-09/WL-11: reject wrong framework hooks before app initialization.
function bindgenContext(mode = 'hydrate-islands') {
  let reads = 0;
  return { release: { ...manifest(), runtime: 'wasm-bindgen', activation: { mode, islands: ['Search'], routes: { '/app': 'module' } } },
    signal: new AbortController().signal, bytes: async () => { reads += 1; return BYTES; }, get reads() { return reads; } };
}
test('Leptos missing hydration export fails without initializing the glue', async () => {
  let init = 0;
  const adapter = new LeptosAdapter(null, async () => ({ default: async () => { init += 1; } }));
  await assert.rejects(adapter.activate(bindgenContext()), (e) => e.code === 'hydrate'); assert.equal(init, 0);
});
test('Leptos incompatible activation mode rejects before fetching code', async () => {
  const context = bindgenContext('mount-route');
  await assert.rejects(new LeptosAdapter(null, async () => {}).activate(context), (e) => e.code === 'activation');
  assert.equal(context.reads, 0);
});
test('Dioxus undeclared route rejects before fetching code', async () => {
  const context = bindgenContext('mount-route');
  await assert.rejects(new DioxusAdapter(null, async () => {}, async () => {}, '/nope').activate(context), (e) => e.code === 'route');
  assert.equal(context.reads, 0);
});

// WL-10: mocked supported Flutter lifecycle, not a claim of real-engine testing.
function flutterWorld(extra = {}) {
  const calls = { scripts: 0, engines: 0, runs: 0 };
  let loaded = false;
  const app = { addView: () => 7, removeView: () => {} };
  const loader = { load: async ({ onEntrypointLoaded }) => onEntrypointLoaded({ initializeEngine: async (config) => {
    calls.engines += 1; calls.config = config;
    return { runApp: async () => { calls.runs += 1; return app; } };
  } }) };
  const doc = { createElement: () => ({ remove() {} }), head: { append(script) {
    calls.scripts += 1; calls.script = script; loaded = true; queueMicrotask(() => script.onload?.());
  } } };
  const context = { release: { ...manifest(), runtime: 'flutter-web', entrypoint: 'bootstrap', activation: { mode: 'attach-view' },
    assets: [{ ...manifest().assets[0], id: 'bootstrap', kind: 'script' }] }, signal: new AbortController().signal, bytes: async () => BYTES };
  const options = { document: doc, getLoader: () => loaded ? loader : undefined, bootstrapMode: 'loader-only', ...extra };
  return { calls, app, doc, context, options, adapter: new FlutterAdapter(options) };
}
test('Flutter forwards loadConfig to initializeEngine with explicit overrides', async () => {
  const w = flutterWorld({ loadConfig: { assetBase: '/assets/', renderer: 'canvaskit' }, engineConfig: { renderer: 'skwasm' } });
  assert.equal(await w.adapter.activate(w.context), w.app);
  assert.deepEqual(w.calls.config, { assetBase: '/assets/', renderer: 'skwasm', multiViewEnabled: true });
  assert.match(w.calls.script.integrity, /^sha256-/); assert.equal(w.calls.script.crossOrigin, 'anonymous');
});
test('Flutter repeated activation shares the same bootstrap and engine', async () => {
  const w = flutterWorld();
  const [a, b] = await Promise.all([w.adapter.activate(w.context), w.adapter.activate(w.context)]);
  assert.equal(a, b); assert.equal(w.calls.scripts, 1); assert.equal(w.calls.engines, 1); assert.equal(w.calls.runs, 1);
});
test('different Flutter adapter configurations cannot share one document', async () => {
  const w = flutterWorld(); const first = w.adapter.activate(w.context);
  await assert.rejects(new FlutterAdapter(w.options).activate(w.context), (e) => e.code === 'flutter-owner'); await first;
});
test('default auto-start bootstrap is rejected before script execution', async () => {
  const w = flutterWorld({ bootstrapMode: undefined });
  await assert.rejects(w.adapter.activate(w.context), (e) => e.code === 'bootstrap-contract'); assert.equal(w.calls.scripts, 0);
});
test('Flutter view mounting validates capability and connected nonzero host', () => {
  assert.throws(() => mountFlutterView({}, node()), (e) => e.code === 'activation');
  const w = flutterWorld(); const target = node(); target.isConnected = false;
  assert.throws(() => mountFlutterView(w.app, target), (e) => e.code === 'target');
  target.isConnected = true; target.getBoundingClientRect = () => ({ width: 0, height: 5 });
  assert.throws(() => mountFlutterView(w.app, target), (e) => e.code === 'target');
});
test('Flutter view removal happens once', () => {
  let removed = 0; const app = { addView: () => 7, removeView: (id) => { assert.equal(id, 7); removed += 1; } };
  const remove = mountFlutterView(app, node()); remove(); remove(); assert.equal(removed, 1);
});

// WL-07/WL-12: native link behavior and intent cleanup.
function link() {
  const navigated = [];
  const view = Object.assign(new EventTarget(), { location: { href: `${ORIGIN}/`, origin: ORIGIN, assign: (url) => navigated.push(url) } });
  const doc = Object.assign(new EventTarget(), { defaultView: view, visibilityState: 'visible' });
  const element = Object.assign(new EventTarget(), { ownerDocument: doc, href: `${ORIGIN}/app`, target: '', hasAttribute: () => false });
  return { element, doc, view, navigated };
}
function clickEvent(props = {}) { const event = new Event('click', { cancelable: true }); Object.assign(event, { button: 0, ...props }); return event; }
test('pilot policy has conservative byte/concurrency/candidate defaults', () => {
  const p = pilotPolicy([ORIGIN]); assert.equal(p.maxPrepareBytes, 1048576); assert.equal(p.concurrency, 2); assert.equal(p.maxPreparingReleases, 1);
});
test('modified and external link clicks are not intercepted', () => {
  const w = link(); let starts = 0;
  const dispose = connectApplicationLink(w.element, {}, KEY, { prepare: false, start: () => { starts += 1; } });
  const modified = clickEvent({ ctrlKey: true }); w.element.dispatchEvent(modified); assert.equal(modified.defaultPrevented, false);
  w.element.href = 'https://other.example.test/app'; const external = clickEvent(); w.element.dispatchEvent(external);
  assert.equal(external.defaultPrevented, false); assert.equal(starts, 0); dispose();
});
test('activation failure follows the original destination link', async () => {
  const w = link(); const errors = [];
  const dispose = connectApplicationLink(w.element, {}, KEY, { prepare: false, start: () => Promise.reject(new Error('startup')), onError: (e) => errors.push(e) });
  const event = clickEvent(); w.element.dispatchEvent(event); await tick();
  assert.equal(event.defaultPrevented, true); assert.deepEqual(w.navigated, [`${ORIGIN}/app`]); assert.equal(errors.length, 1); dispose();
});
test('activation acquires ownership before the intent lease is released', async () => {
  const w = link(); const order = [];
  const coordinator = { prepare: () => ({ promise: Promise.resolve({}), release: () => order.push('release') }) };
  const dispose = connectApplicationLink(w.element, coordinator, KEY, { intent: { dwellMs: 0 }, start: () => {
    order.push('activate'); return Promise.resolve({ interactive: Promise.resolve(), unmount: async () => {} });
  } });
  w.element.dispatchEvent(new Event('focusin')); await tick();
  w.element.dispatchEvent(clickEvent()); await tick(); assert.deepEqual(order.slice(0, 2), ['activate', 'release']); dispose();
});
test('touch preparation can be disabled and window pagehide clears dwell', async () => {
  const w = link(); let prepared = 0;
  const coordinator = { prepare: () => { prepared += 1; return { promise: Promise.resolve(), release() {} }; } };
  const dispose = prepareOnIntent(w.element, coordinator, KEY, { dwellMs: 5, prepareOnTouch: false });
  w.element.dispatchEvent(new Event('touchstart'));
  w.element.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'touch' }));
  await new Promise((r) => setTimeout(r, 10)); assert.equal(prepared, 0);
  w.element.dispatchEvent(new Event('focusin')); w.view.dispatchEvent(new Event('pagehide'));
  await new Promise((r) => setTimeout(r, 10)); assert.equal(prepared, 0); dispose();
});
test('disposing during activation does not redirect after the visitor leaves', async () => {
  const w = link(); const gate = deferred();
  const dispose = connectApplicationLink(w.element, {}, KEY, { prepare: false, start: () => gate.promise });
  w.element.dispatchEvent(clickEvent()); dispose(); gate.reject(new Error('late')); await tick(); assert.deepEqual(w.navigated, []);
});

// WL-15: explicit useful-interaction marks, bounded state and data minimization.
test('reporter separates runtime and useful-interaction durations and strips private fields', () => {
  let now = 0; const events = [];
  const report = createLoaderReporter({ write: (e) => events.push(e), now: () => now, labels: { cohort: 'B', token: 'secret' } });
  report({ phase: 'mount-start', appId: 'pilot', release: 'r1', operation: 1 }); now = 40;
  report({ phase: 'runtime-ready', appId: 'pilot', release: 'r1', operation: 1 }); now = 80;
  report({ phase: 'interactive', appId: 'pilot', release: 'r1', operation: 1, url: 'https://private/?token=x', userId: 'private', error: new Error('secret') });
  assert.equal(events.at(-1).durationMs, 80); assert.equal(events.at(-1).cohort, 'B');
  for (const field of ['url', 'userId', 'token', 'error', 'operation']) assert.ok(!(field in events.at(-1)));
  assert.ok(Object.isFrozen(events.at(-1)));
});
test('reporter rejects untrusted identifiers and isolates writer exceptions', () => {
  let calls = 0; const report = createLoaderReporter({ write: () => { calls += 1; throw new Error('logging'); } });
  report({ phase: 'interactive', appId: 'https://private/?secret', release: 'r1' }); assert.equal(calls, 0);
  assert.doesNotThrow(() => report({ phase: 'interactive', appId: 'pilot', release: 'r1' })); assert.equal(calls, 1);
});
test('reporter bounds pending timing contexts', () => {
  const events = []; const report = createLoaderReporter({ write: (e) => events.push(e), maxContexts: 1, now: () => 100 });
  for (const operation of [1, 2]) report({ phase: 'mount-start', appId: 'pilot', release: 'r1', operation });
  report({ phase: 'interactive', appId: 'pilot', release: 'r1', operation: 1 }); assert.ok(!('durationMs' in events.at(-1)));
});
