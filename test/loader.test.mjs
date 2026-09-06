import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Coordinator,
  browserPolicy,
  MemoryStore,
  verifyBytes,
  RawWasmAdapter,
  BindgenAdapter,
  LeptosAdapter,
  DioxusAdapter,
  hintDescriptors,
  prepareOnIntent,
  LoaderError,
} from '../index.mjs';
import { linkHeader } from '../src/server.mjs';

globalThis.crypto ??= webcrypto;

const ORIGIN = 'https://assets.ores-wasm-loaders.test';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const body = (seed, size) => {
  const out = new Uint8Array(size);
  let h = createHash('sha256').update(seed).digest();
  for (let i = 0; i < size; i += 32) {
    out.set(h.subarray(0, Math.min(32, size - i)), i);
    h = createHash('sha256').update(h).digest();
  }
  if (seed.endsWith('.wasm')) out.set([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], 0);
  return out;
};

/** A release plus a network that serves exactly the bytes it declares. */
function world({ runtime = 'wasm-bindgen', assets: spec, activation, budget, latencyMs = 0, corrupt = new Set() } = {}) {
  const defaults = [
    ['glue', 'app.js', 'module', 'glue', 'critical', 4096],
    ['module', 'app_bg.wasm', 'wasm', 'module', 'critical', 8192],
    ['styles', 'app.css', 'data', 'asset', 'optional', 2048],
    ['help', 'help.json', 'data', 'asset', 'lazy', 1024],
  ];
  const rows = (spec ?? defaults).map(([id, path, kind, role, stage, size]) => {
    const bytes = body(path, size);
    return {
      id,
      url: `${ORIGIN}/releases/demo/2026.09.05-a/${path}`,
      kind,
      bytes: bytes.length,
      sha256: sha(bytes),
      prepare: stage !== 'lazy',
      role,
      stage,
      _body: bytes,
    };
  });
  const bodies = new Map(rows.map((r) => [r.url, r._body]));
  const release = {
    schemaVersion: 2,
    appId: 'demo',
    release: '2026.09.05-a',
    runtime,
    entrypoint: runtime === 'flutter-web' ? rows.find((r) => r.role === 'bootstrap').id : runtime === 'raw-wasm' ? rows.find((r) => r.kind === 'wasm').id : 'glue',
    assets: rows.map(({ _body, ...rest }) => rest),
    prepareBudget: budget ?? { maxBytes: 1_000_000, maxConcurrency: 2, furthestStage: 'fetch' },
    ...(activation ? { activation } : {}),
  };

  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push(url);
    init.signal?.throwIfAborted();
    if (latencyMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, latencyMs);
        init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); }, { once: true });
      });
    }
    const bytes = bodies.get(url);
    if (!bytes) return { ok: false, status: 404 };
    const served = corrupt.has(url) ? new Uint8Array(bytes.length).fill(7) : bytes;
    let sent = false;
    return {
      ok: true,
      status: 200,
      type: 'cors',
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: served })),
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    };
  };

  const events = [];
  const coordinator = new Coordinator(browserPolicy([ORIGIN], { concurrency: 2 }), {
    transport: async (asset, signal) => {
      const response = await fetcher(asset.url, { signal });
      if (!response.ok) throw new LoaderError('http', `HTTP ${response.status}`);
      const reader = response.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    },
    store: new MemoryStore(),
    report: (e) => events.push(e),
  });
  coordinator.register(release);
  return { coordinator, release, requests, events, key: 'demo@2026.09.05-a', bodies };
}

test('preparation takes what the release marks preparable, in declared order, never the lazy asset', async () => {
  const { coordinator, key, requests } = world();
  const receipt = await coordinator.prefetch(key);
  assert.deepEqual(receipt.prepared, ['glue', 'module', 'styles']);
  assert.deepEqual(receipt.skipped, []);
  assert.equal(receipt.cancelled, false);
  assert.ok(!requests.some((u) => u.endsWith('help.json')), 'a lazy asset is never prepared');
});

test('over-budget truncates and reports, instead of preparing nothing', async () => {
  // The release's own budget must cover its critical bytes — owls-interfaces refuses one that
  // cannot, so a release can never ship guaranteed-truncated. The budget that bites here is
  // the PAGE's: this visitor's page is willing to spend less than the release would like.
  const { coordinator, release } = world();
  const page = new Coordinator(browserPolicy([ORIGIN], { maxPrepareBytes: 5000 }), {
    transport: coordinator.transport,
    store: new MemoryStore(),
  });
  page.register(release);
  const receipt = await page.prefetch('demo@2026.09.05-a');
  assert.deepEqual(receipt.prepared, ['glue']);
  assert.deepEqual(receipt.skipped.map((s) => s.reason), ['over-budget', 'over-budget']);
  assert.ok(receipt.bytes <= 5000);
});

test('bytes that do not match the declared digest are refused', async () => {
  const url = `${ORIGIN}/releases/demo/2026.09.05-a/app_bg.wasm`;
  const { coordinator, key } = world({ corrupt: new Set([url]) });
  const receipt = await coordinator.prefetch(key);
  assert.ok(receipt.prepared.includes('glue'));
  const failure = receipt.skipped.find((s) => s.id === 'module');
  assert.equal(failure?.reason, 'failed');

  await assert.rejects(
    () => verifyBytes({ id: 'x', bytes: 4, sha256: 'f'.repeat(64) }, new Uint8Array([1, 2, 3, 4])),
    (e) => e.code === 'integrity',
  );
});

test('a release id that comes back describing different assets is refused', () => {
  const { coordinator, release } = world();
  assert.ok(coordinator.register(structuredClone(release)), 're-registering the same release is fine');
  const impostor = structuredClone(release);
  impostor.assets[0].sha256 = 'a'.repeat(64);
  assert.throws(() => coordinator.register(impostor), (e) => e.code === 'release-conflict');
});

test('activation works with no preparation, and reuses it when there was some', async () => {
  const glue = { calls: 0, async default() { this.calls += 1; }, hydrate_islands() { this.hydrated = true; } };
  const cold = world({ activation: { mode: 'hydrate-islands', islands: ['Pricing'] } });
  const adapter = new LeptosAdapter(null, async () => glue);
  const result = await cold.coordinator.activate(cold.key, adapter);
  assert.deepEqual(result, { mode: 'hydrate-islands', islands: ['Pricing'] });
  assert.equal(glue.calls, 1);
  assert.equal(glue.hydrated, true);

  const warm = world({ activation: { mode: 'hydrate-islands', islands: ['Pricing'] } });
  await warm.coordinator.prefetch(warm.key);
  const before = warm.requests.length;
  await warm.coordinator.activate(warm.key, new LeptosAdapter(null, async () => ({ async default() {}, hydrate_islands() {} })));
  assert.equal(warm.requests.length, before, 'prepared bytes are reused rather than refetched');
});

test('a second activation is the first one, and a rival adapter is refused', async () => {
  const { coordinator, key } = world({ activation: { mode: 'hydrate-islands', islands: ['Pricing'] } });
  const adapter = new LeptosAdapter(null, async () => ({ async default() {}, hydrate_islands() {} }));
  const [a, b] = await Promise.all([coordinator.activate(key, adapter), coordinator.activate(key, adapter)]);
  assert.equal(a, b);
  await assert.rejects(
    () => coordinator.activate(key, new LeptosAdapter(null, async () => ({ async default() {} }))),
    (e) => e.code === 'adapter-conflict',
  );
});

test('cancelling preparation leaves activation correct', async () => {
  const { coordinator, key } = world({ latencyMs: 50 });
  const controller = new AbortController();
  const pending = coordinator.prefetch(key, controller.signal);
  controller.abort();
  const receipt = await pending;
  assert.equal(receipt.cancelled, true);
  assert.ok(receipt.skipped.length > 0);

  const instance = await coordinator.activate(key, new BindgenAdapter(null, async () => ({ async default() {} })));
  assert.ok(instance);
});

test('a metered or slow connection declines preparation without failing', async () => {
  const { coordinator, key, requests } = world();
  const saveData = new Coordinator(browserPolicy([ORIGIN], { allowPreparation: () => false }), {
    transport: async () => { throw new Error('must not fetch'); },
    store: new MemoryStore(),
  });
  saveData.register(coordinator.get(key));
  const receipt = await saveData.prefetch(key);
  assert.deepEqual(receipt.prepared, []);
  assert.equal(receipt.skipped[0].reason, 'policy-declined');
  assert.equal(requests.length, 0);
});

test('the raw-wasm adapter compiles the entry module and refuses a foreign release', async () => {
  const { coordinator, key } = world({
    runtime: 'raw-wasm',
    assets: [['main', 'main.wasm', 'wasm', 'module', 'critical', 64]],
  });
  const adapter = new RawWasmAdapter();
  // The fixture bytes carry the wasm magic but are not a valid module, so compilation is the
  // thing that fails — which is the adapter reaching the runtime, not misreading the release.
  await assert.rejects(() => coordinator.activate(key, adapter), (e) => !(e instanceof LoaderError) || e.code !== 'runtime');

  const bindgen = world().coordinator;
  await assert.rejects(
    () => bindgen.activate('demo@2026.09.05-a', new RawWasmAdapter()),
    (e) => e.code === 'runtime',
  );
});

test('dioxus mounts the chunk the release declares, and refuses an undeclared route', async () => {
  const spec = [
    ['glue', 'app.js', 'module', 'glue', 'critical', 4096],
    ['module', 'app_bg.wasm', 'wasm', 'module', 'critical', 8192],
    ['reports', 'chunks-reports.wasm', 'wasm', 'chunk', 'optional', 2048],
  ];
  const activation = { mode: 'mount-route', routes: { '/app': 'module', '/app/reports': 'reports' } };
  const mounted = [];
  const make = (route) =>
    new DioxusAdapter(null, async () => ({ async default() {} }), async (_glue, info) => mounted.push(info.chunk), route);

  const w = world({ assets: spec, activation });
  const result = await w.coordinator.activate(w.key, make('/app/reports/42'));
  assert.equal(result.chunk, 'reports');
  assert.deepEqual(mounted, ['reports']);

  const w2 = world({ assets: spec, activation });
  await assert.rejects(() => w2.coordinator.activate(w2.key, make('/marketing')), (e) => e.code === 'route');
});

test('hints and SSR Link headers describe exactly what preparation would take', () => {
  const { release } = world();
  const descriptors = hintDescriptors(release);
  assert.deepEqual(descriptors.map((d) => d.href.split('/').pop()), ['app.js', 'app_bg.wasm', 'app.css']);
  assert.ok(descriptors.every((d) => d.rel === 'prefetch' && d.crossorigin === 'anonymous'));
  assert.throws(() => hintDescriptors(release, 'prefetch', 100), (e) => e.code === 'budget');

  const header = linkHeader(release);
  assert.match(header, /rel=prefetch/);
  assert.equal(header.split(', ').length, 3);
});

test('intent prepares after a dwell, and a passing cursor costs nothing', async () => {
  const { coordinator, key, requests } = world();
  const listeners = new Map();
  const element = {
    ownerDocument: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const dispose = prepareOnIntent(element, coordinator, key, { dwellMs: 20 });

  listeners.get('pointerenter')();
  listeners.get('pointerleave')();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(requests.length, 0, 'leaving before the dwell prepares nothing');

  listeners.get('pointerdown')();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(requests.length > 0, 'pointer-down prepares immediately');
  dispose();
});

test('telemetry reports the lifecycle without leaking anything but identifiers', async () => {
  const { coordinator, key, events } = world({ activation: { mode: 'hydrate-islands', islands: ['Pricing'] } });
  await coordinator.prefetch(key);
  await coordinator.activate(key, new LeptosAdapter(null, async () => ({ async default() {}, hydrate_islands() {} })));
  const phases = events.map((e) => e.phase);
  assert.ok(phases.includes('prepare-start') && phases.includes('prepared') && phases.includes('activated'));
  for (const event of events) {
    assert.ok(Object.isFrozen(event));
    for (const value of Object.values(event)) assert.notEqual(typeof value, 'function');
  }
});

// ---------------------------------------------------------------------------------------
// The guarantee the whole design rests on.
// ---------------------------------------------------------------------------------------

const FORBIDDEN = [
  [/document\.createElement\(\s*['"]script['"]/, 'inserts a script element'],
  [/\bimport\s*\(/, 'dynamically imports a module'],
  [/\beval\s*\(/, 'evaluates code'],
  [/new\s+Function\s*\(/, 'builds a function from source'],
  [/WebAssembly\.instantiate/, 'instantiates a module — that is activation, not preparation'],
];

function functionBodies(text, namePattern) {
  const out = [];
  for (const match of text.matchAll(namePattern)) {
    const start = text.indexOf('{', match.index + match[0].length - 1);
    if (start < 0) continue;
    let depth = 0;
    let i = start;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({ name: match[1] ?? match[0].trim(), body: text.slice(start, i + 1) });
  }
  return out;
}

test('no preparation path in this package can execute application code', () => {
  const src = join(new URL('.', import.meta.url).pathname, '..', 'src');
  const files = readdirSync(src).filter((f) => f.endsWith('.mjs') && statSync(join(src, f)).isFile());
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    const text = readFileSync(join(src, file), 'utf8');
    for (const fn of functionBodies(text, /(?:async\s+)?(prefetch|#prepare|prepareOnIntent|prepareWhenIdle|hintDescriptors)\s*\(/g)) {
      scanned += 1;
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(fn.body)) findings.push(`${file}: ${fn.name}() ${why}`);
      }
    }
  }
  assert.ok(scanned >= 4, `expected to scan the prepare paths, scanned ${scanned}`);
  assert.deepEqual(findings, [], `preparation must not execute application code:\n  ${findings.join('\n  ')}`);
});

test('this package ships no third-party runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(new URL('.', import.meta.url).pathname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.equal(existsSync(join(new URL('.', import.meta.url).pathname, '..', 'dist')), false, 'no committed build output: the source is what ships');
});
