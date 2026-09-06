import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installMarketingIntentLoader } from '../index.mjs';

function link(attributes = {}) {
  const listeners = new Map();
  const docListeners = new Map();
  const ownerDocument = {
    baseURI: 'https://www.example.test/marketing/',
    visibilityState: 'visible',
    addEventListener(name, fn) { docListeners.set(name, fn); },
    removeEventListener(name) { docListeners.delete(name); },
  };
  return {
    ownerDocument,
    listeners,
    docListeners,
    getAttribute(name) { return attributes[name] ?? null; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
}

function root(...links) {
  return { querySelectorAll() { return links; } };
}

function coordinator() {
  const calls = { load: [], prepare: [], release: 0 };
  return {
    calls,
    async load(url, { fetcher }) {
      calls.load.push({ url, fetcher });
      return { appId: 'demo-app', release: '2026.09.06-a' };
    },
    prepare(key, _signal, { variant }) {
      calls.prepare.push({ key, variant });
      const outcome = Object.freeze({ status: 'warmed', prepared: ['module'], bytes: 8 });
      return Object.freeze({
        promise: Promise.resolve(outcome),
        done: Promise.resolve(outcome),
        release() { calls.release += 1; },
      });
    },
  };
}

test('marketing intent loads a manifest only after dwell and then acquires a fetch-only lease', async () => {
  const target = link({ 'data-owls-manifest': '../releases/app.json' });
  const loader = coordinator();
  const outcomes = [];
  const installation = installMarketingIntentLoader({
    coordinator: loader,
    root: root(target),
    fetcher: async () => {},
    dwellMs: 10,
    exitGraceMs: 5,
    onOutcome: (event) => outcomes.push(event),
  });

  assert.equal(installation.count, 1);
  assert.equal(loader.calls.load.length, 0, 'initial HTML render fetches no manifest or application asset');
  target.listeners.get('pointerenter')();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(loader.calls.load[0].url, 'https://www.example.test/releases/app.json');
  assert.deepEqual(loader.calls.prepare, [{ key: 'demo-app@2026.09.06-a', variant: 'module' }]);
  assert.equal(outcomes[0].outcome.status, 'warmed');
  target.listeners.get('pointerleave')();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(loader.calls.release, 1);
  installation.dispose();
});

test('multiple links share one manifest request but own independent preparation leases', async () => {
  const first = link({ 'data-owls-manifest': '/release.json' });
  const second = link({ 'data-owls-manifest': '/release.json', 'data-owls-variant': 'fallback' });
  const loader = coordinator();
  installMarketingIntentLoader({ coordinator: loader, root: root(first, second), dwellMs: 0 });

  first.listeners.get('pointerdown')();
  second.listeners.get('pointerdown')();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(loader.calls.load.length, 1);
  assert.deepEqual(loader.calls.prepare, [
    { key: 'demo-app@2026.09.06-a', variant: 'module' },
    { key: 'demo-app@2026.09.06-a', variant: 'fallback' },
  ]);
});

test('failed manifests are retryable and ordinary navigation is never intercepted', async () => {
  const target = link({ 'data-owls-manifest': '/release.json' });
  let attempts = 0;
  const errors = [];
  const loader = coordinator();
  loader.load = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary outage');
    return { appId: 'demo-app', release: '2026.09.06-a' };
  };
  const installation = installMarketingIntentLoader({
    coordinator: loader,
    root: root(target),
    dwellMs: 0,
    exitGraceMs: 0,
    onError: (event) => errors.push(event),
  });

  assert.equal(target.listeners.has('click'), false, 'the integration never prevents or replaces navigation');
  target.listeners.get('pointerdown')();
  await new Promise((resolve) => setTimeout(resolve, 0));
  target.listeners.get('pointerleave')();
  await new Promise((resolve) => setTimeout(resolve, 0));
  target.listeners.get('pointerdown')();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 2);
  assert.equal(errors.length, 1);
  installation.dispose();
});

test('invalid annotations fail closed per link without disabling valid links', async () => {
  const invalid = link({ 'data-owls-manifest': 'javascript:alert(1)' });
  const valid = link({ 'data-owls-manifest': '/release.json' });
  const errors = [];
  const loader = coordinator();
  const installation = installMarketingIntentLoader({
    coordinator: loader,
    root: root(invalid, valid),
    dwellMs: 0,
    onError: (event) => errors.push(event),
  });
  assert.equal(installation.count, 1);
  assert.equal(errors.length, 1);
  valid.listeners.get('pointerdown')();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(loader.calls.load.length, 1);
});

test('disposing before a manifest resolves prevents preparation and late callbacks', async () => {
  const target = link({ 'data-owls-manifest': '/slow-release.json' });
  let resolveManifest;
  const loader = coordinator();
  loader.load = () => new Promise((resolve) => { resolveManifest = resolve; });
  const outcomes = [];
  const installation = installMarketingIntentLoader({
    coordinator: loader,
    root: root(target),
    dwellMs: 0,
    onOutcome: (event) => outcomes.push(event),
  });
  target.listeners.get('pointerdown')();
  await Promise.resolve();
  installation.dispose();
  resolveManifest({ appId: 'demo-app', release: '2026.09.06-a' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(loader.calls.prepare.length, 0);
  assert.equal(outcomes.length, 0);
});


test('the marketing preparation path contains no application-execution primitive', () => {
  const source = readFileSync(new URL('../src/marketing.mjs', import.meta.url), 'utf8');
  const forbidden = [
    /document\.createElement\(\s*['"]script['"]/, /\bimport\s*\(/, /\beval\s*\(/,
    /new\s+Function\s*\(/, /WebAssembly\.(?:compile|instantiate)/,
  ];
  assert.deepEqual(forbidden.filter((pattern) => pattern.test(source)).map(String), []);
});
