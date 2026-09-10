import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LoaderError,
  loadOresWasmConfig,
  parseOresWasmToml,
  parseOresWasmTomlDocument,
  resolveOresWasmToml,
} from '../index.mjs';

const fixture = () => readFile(new URL('../fixtures/mixed-host.ores-wasm.toml', import.meta.url), 'utf8');
const expectError = (fn, code) => assert.throws(fn, (error) => error instanceof LoaderError && error.code === code);

test('strict TOML subset parses mixed browser/SSR repo config and freezes it', async () => {
  const config = parseOresWasmToml(await fixture());
  assert.deepEqual(Object.keys(config.hosts).sort(), ['browser', 'server']);
  assert.equal(config.hosts.browser.root, '.');
  assert.equal(config.hosts.server.root, '.');
  assert.equal(config.hosts.browser.prepare.trigger, 'intent');
  assert.deepEqual(config.hosts.browser.allowedOrigins, ['https://cdn.example.com']);
  assert.equal(config.extensions.owner, 'platform');
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.hosts.browser.prepare));
});

test('flags-2-env-compatible environment strings override only declared targets', async () => {
  const config = resolveOresWasmToml(await fixture(), {
    ORES_WASM_PREPARE_MAX_BYTES: '16777216',
    ORES_WASM_ALLOWED_ORIGINS: '["https://a.example","https://b.example"]',
    ORES_WASM_FEATURE_METADATA: '{"cohort":"pilot","ratio":0.25}',
  });
  assert.equal(config.hosts.browser.prepare.maxBytes, 16777216);
  assert.deepEqual(config.hosts.browser.allowedOrigins, ['https://a.example', 'https://b.example']);
  assert.deepEqual(config.extensions.featureMetadata, { cohort: 'pilot', ratio: 0.25 });
});

test('the library repository can explicitly declare that it does not activate itself', async () => {
  const source = await readFile(new URL('../.ores-wasm.toml', import.meta.url), 'utf8');
  const config = parseOresWasmToml(source);
  assert.equal(config.enabled, false);
  assert.deepEqual(config.hosts, {});
  assert.equal(config.extensions.role, 'loader-library');
});

test('Node file loader reads the conventional file and applies environment values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'owls-config-'));
  const path = join(directory, '.ores-wasm.toml');
  try {
    await writeFile(path, await fixture(), 'utf8');
    const config = await loadOresWasmConfig({
      path,
      environment: { ORES_WASM_PREPARE_MAX_BYTES: '4194304' },
    });
    assert.equal(config.hosts.browser.prepare.maxBytes, 4194304);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('parser rejects duplicate values, duplicate tables, arrays-of-tables, and inline tables', () => {
  expectError(() => parseOresWasmTomlDocument('version = 1\nversion = 1\n'), 'config-toml');
  expectError(() => parseOresWasmTomlDocument('[hosts.web]\n[hosts.web]\n'), 'config-toml');
  expectError(() => parseOresWasmTomlDocument('[[hosts]]\nkind = "browser"\n'), 'config-toml');
  expectError(() => parseOresWasmTomlDocument('extensions = { owner = "platform" }\n'), 'config-toml');
});

test('TOML syntax cannot bypass semantic path and origin hardening', async () => {
  const traversal = (await fixture()).replace('root = "."', 'root = "../outside"');
  expectError(() => parseOresWasmToml(traversal), 'config');

  const origin = (await fixture()).replace('https://cdn.example.com', 'https://cdn.example.com/path');
  expectError(() => parseOresWasmToml(origin), 'config');
});

test('comments inside quoted strings are preserved while trailing comments are removed', () => {
  const parsed = parseOresWasmTomlDocument([
    'version = 1 # contract version',
    'enabled = false',
    '[hosts]',
    '[extensions]',
    'note = "value # not a comment" # actual comment',
  ].join('\n'));
  assert.equal(parsed.extensions.note, 'value # not a comment');
});
