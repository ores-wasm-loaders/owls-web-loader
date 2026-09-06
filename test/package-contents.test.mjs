import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
test('browser package declares an explicit source allowlist', () => {
  assert.ok(Array.isArray(packageJson.files));
  assert.ok(packageJson.files.includes('index.mjs'));
  assert.ok(packageJson.files.includes('src/**/*.mjs'));
  assert.ok(!packageJson.files.some((path) => path === '.' || path === '**/*' || path.startsWith('tools')));
});
test('actual npm pack excludes build caches and test files even when present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'owls-package-test-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson));
    for (const [path, content] of [['index.mjs', 'export {};'], ['src/example.mjs', 'export {};'],
      ['tools/manifest/target/release/cache.bin', 'not a browser dependency'],
      ['test/unpublished.test.mjs', 'not part of runtime']]) {
      const slash = path.lastIndexOf('/');
      if (slash >= 0) await mkdir(join(dir, path.slice(0, slash)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 1024 * 1024 }));
    const names = pack.files.map((file) => file.path);
    assert.ok(names.includes('index.mjs'));
    assert.ok(names.includes('src/example.mjs'));
    assert.ok(!names.some((path) => path.startsWith('tools/') || path.startsWith('test/')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Zed publication excludes the build tooling directory', async () => {
  assert.match(await readFile(new URL('../.zpkg.toml', import.meta.url), 'utf8'), /"tools\/\*\*"/);
});
