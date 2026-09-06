import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const expectedDigest = '93a44bbb96c751218e4c00d479010ce4c7e22d0fe8c71ac08fb6a39ccca33e24';

test('the marketing probe is a stable minimal WebAssembly module', async () => {
  const bytes = await readFile(new URL('../fixtures/empty.wasm', import.meta.url));
  assert.equal(bytes.length, 8);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedDigest);
  assert.ok(await WebAssembly.compile(bytes));
});
