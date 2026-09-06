import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function text(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function table(source, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\[${escaped}\\]\\s*$([\\s\\S]*?)(?=^\\[|\\Z)`, 'm'));
  assert.ok(match, `missing [${heading}] table`);
  return match[1];
}

function quotedValue(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^${escaped}\\s*=\\s*"([^"]+)"\\s*$`, 'm'));
  assert.ok(match, `missing quoted ${key}`);
  return match[1];
}

test('npm and Zed package metadata remain one coherent release identity', () => {
  const npm = JSON.parse(text('package.json'));
  const zed = text('.zpkg.toml');
  const ownPackage = table(zed, 'package');

  assert.equal(quotedValue(ownPackage, 'org'), 'ores-wasm-loaders');
  assert.equal(quotedValue(ownPackage, 'name'), 'owls-web-loader');
  assert.equal(quotedValue(ownPackage, 'version'), npm.version);
  assert.equal(npm.name, '@ores-wasm-loaders/owls-web-loader');
});

test('the exact interface dependency and lock receipt agree', () => {
  const zed = text('.zpkg.toml');
  const dependencies = table(zed, 'dependencies');
  const requested = quotedValue(dependencies, '"ores-wasm-loaders/owls-interfaces"');
  assert.match(requested, /^=\d+\.\d+\.\d+$/, 'interface dependency must be an exact version');

  const lock = text('.zpkg.lock');
  const lockedVersion = quotedValue(lock, 'version');
  const lockedTag = quotedValue(lock, 'vcs_tag');
  const lockedCommit = quotedValue(lock, 'vcs_commit');
  const archiveSha = quotedValue(lock, 'sha256');

  assert.equal(requested, `=${lockedVersion}`);
  assert.equal(lockedTag, `v${lockedVersion}`);
  assert.match(lockedCommit, /^[a-f0-9]{40}$/);
  assert.match(archiveSha, /^[a-f0-9]{64}$/);
});
