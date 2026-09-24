import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposedWasmAdapter, LoaderError } from '../index.mjs';

const digest = (n) => n.toString(16).padStart(64, '0');
const release = Object.freeze({
  schemaVersion: 2,
  appId: 'split-demo',
  release: '2026.09.23-a',
  runtime: 'raw-wasm',
  entrypoint: 'page-home',
  assets: Object.freeze([
    Object.freeze({
      id: 'vendor-core',
      url: 'https://assets.example.test/vendor-core.7f.wasm',
      kind: 'wasm',
      role: 'module',
      stage: 'critical',
      dependencies: [],
      bytes: 1,
      sha256: digest(1),
      prepare: true,
    }),
    Object.freeze({
      id: 'page-home',
      url: 'https://assets.example.test/page-home.3c.wasm',
      kind: 'wasm',
      role: 'chunk',
      stage: 'critical',
      dependencies: ['vendor-core'],
      bytes: 1,
      sha256: digest(2),
      prepare: true,
    }),
  ]),
});

function context(bytesCalls = []) {
  const byId = new Map([
    ['vendor-core', Uint8Array.of(1)],
    ['page-home', Uint8Array.of(2)],
  ]);
  return {
    release,
    signal: new AbortController().signal,
    async bytes(id) {
      bytesCalls.push(id);
      return Uint8Array.from(byId.get(id));
    },
  };
}

test('composed adapter instantiates shared libraries before user/page code and wires exports by asset id', async () => {
  const compiled = [];
  const instantiated = [];
  const fakeWebAssembly = {
    async compile(buffer) {
      const tag = new Uint8Array(buffer)[0];
      compiled.push(tag);
      return { tag };
    },
    async instantiate(module, imports) {
      instantiated.push({ tag: module.tag, imports });
      if (module.tag === 1) {
        return { exports: { add1: (value) => value + 1, memory: { kind: 'shared-vendor-memory' } } };
      }
      assert.equal(imports['vendor-core'].add1(41), 42);
      assert.equal(imports.host.log('ok'), 'ok');
      return { exports: { run: () => imports['vendor-core'].add1(41) } };
    },
  };

  const bytesCalls = [];
  const adapter = new ComposedWasmAdapter({
    imports: { host: { log: (value) => value } },
    webAssembly: fakeWebAssembly,
  });
  const result = await adapter.activate(context(bytesCalls));

  assert.deepEqual(bytesCalls, ['vendor-core', 'page-home']);
  assert.deepEqual(compiled, [1, 2]);
  assert.deepEqual(instantiated.map((entry) => entry.tag), [1, 2]);
  assert.equal(result.rootAssetId, 'page-home');
  assert.equal(result.instances.get('vendor-core').exports.add1(9), 10);
  assert.equal(result.instance.exports.run(), 42);
});

test('composed adapter can target a route/user chunk without changing the shared dependency graph', async () => {
  const fakeWebAssembly = {
    async compile(buffer) { return { tag: new Uint8Array(buffer)[0] }; },
    async instantiate(module, imports) {
      if (module.tag === 1) return { exports: { value: 7 } };
      return { exports: { value: imports['vendor-core'].value + 1 } };
    },
  };
  const result = await new ComposedWasmAdapter({
    rootAssetId: 'page-home',
    webAssembly: fakeWebAssembly,
  }).activate(context());
  assert.equal(result.instance.exports.value, 8);
});

test('host imports cannot silently shadow a declared shared-module namespace', async () => {
  const fakeWebAssembly = {
    async compile(buffer) { return { tag: new Uint8Array(buffer)[0] }; },
    async instantiate(module) {
      if (module.tag === 1) return { exports: { value: 7 } };
      return { exports: {} };
    },
  };
  await assert.rejects(
    () => new ComposedWasmAdapter({
      imports: { 'vendor-core': { spoofed: true } },
      webAssembly: fakeWebAssembly,
    }).activate(context()),
    (error) => error instanceof LoaderError && error.code === 'dependency' && /collides/.test(error.message),
  );
});
