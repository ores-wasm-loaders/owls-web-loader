import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sourceUrl = new URL('../src/contract.mjs', import.meta.url);

test('contract resolver has no static Node imports and honors an explicit browser module URL', async () => {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.doesNotMatch(source, /^import .*['"]node:/m);

  const contract = `
    export class LoaderError extends Error {}
    export const parseRelease = value => value;
    export const releaseProblems = () => [];
    export const releaseSchema = {};
    export const preparableAssets = release => release.assets ?? [];
    export const dependencyClosure = () => [];
    export const dependencyClosureForRoute = () => [];
    export const chunkForRoute = () => null;
    export const assetKey = asset => asset.url + '#' + asset.sha256;
    export const releaseKey = release => release.appId + '@' + release.release;
    export const stageOf = asset => asset.stage ?? 'critical';
    export const roleOf = asset => asset.role ?? 'asset';
  `;
  globalThis.__OWLS_INTERFACES_URL__ = `data:text/javascript;base64,${Buffer.from(contract).toString('base64')}`;
  try {
    const module = await import(`${sourceUrl.href}?browser-contract=${Date.now()}`);
    assert.equal(module.releaseKey({ appId: 'demo', release: 'r1' }), 'demo@r1');
    assert.equal(module.interfaces.parseRelease({ ok: true }).ok, true);
    assert.equal(typeof module.dependencyClosure, 'function');
    assert.equal(typeof module.dependencyClosureForRoute, 'function');
  } finally {
    delete globalThis.__OWLS_INTERFACES_URL__;
  }
});
