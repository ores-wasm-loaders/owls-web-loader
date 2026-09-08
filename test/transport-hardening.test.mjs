import test from 'node:test';
import assert from 'node:assert/strict';

import { httpTransport } from '../index.mjs';

const BYTES = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);

function asset(kind, bytes = BYTES.length) {
  return Object.freeze({
    id: `${kind}-asset`,
    url: `https://assets.example/releases/demo/r1/${kind}`,
    kind,
    bytes,
    sha256: '0'.repeat(64),
  });
}

function response({
  chunks = [BYTES],
  contentType = 'application/wasm',
  ok = true,
  status = 200,
  type = 'cors',
  redirected = false,
  read,
  cancel = async () => {},
} = {}) {
  const state = { reads: 0, cancels: 0, releases: 0 };
  let index = 0;
  const reader = {
    async read() {
      state.reads += 1;
      if (read) return read(state);
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[index++] };
    },
    cancel() {
      state.cancels += 1;
      return cancel(state);
    },
    releaseLock() {
      state.releases += 1;
    },
  };
  return {
    state,
    value: {
      ok,
      status,
      type,
      redirected,
      headers: {
        get(name) {
          return name.toLowerCase() === 'content-type' ? contentType : null;
        },
      },
      body: { getReader: () => reader },
    },
  };
}

async function within(promise, milliseconds = 250) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('transport did not settle promptly')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('the public browser transport sends a credentialless, redirect-denying request', async () => {
  const admitted = response();
  let observed;
  const transport = httpTransport(async (url, init) => {
    observed = { url, init };
    return admitted.value;
  });

  assert.deepEqual(await transport(asset('wasm'), new AbortController().signal), BYTES);
  assert.equal(observed.url, 'https://assets.example/releases/demo/r1/wasm');
  assert.equal(observed.init.credentials, 'omit');
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.mode, 'cors');
  assert.equal(observed.init.referrerPolicy, 'no-referrer');
  assert.equal(admitted.state.cancels, 1);
  assert.equal(admitted.state.releases, 1);
});

test('each declared asset kind requires an admissible response media type', async () => {
  const cases = [
    ['wasm', 'application/wasm; charset=binary'],
    ['module', 'text/javascript; charset=utf-8'],
    ['script', 'application/javascript'],
    ['font', 'font/woff2'],
    ['data', 'application/json'],
  ];

  for (const [kind, contentType] of cases) {
    const admitted = response({ contentType });
    const transport = httpTransport(async () => admitted.value);
    assert.deepEqual(await transport(asset(kind), new AbortController().signal), BYTES, kind);
  }
});

test('missing, mismatched, HTML and unknown response types fail before body reads', async () => {
  const cases = [
    [asset('wasm'), null],
    [asset('wasm'), 'text/javascript'],
    [asset('module'), 'application/wasm'],
    [asset('data'), 'text/html; charset=utf-8'],
    [asset('data'), 'application/xhtml+xml'],
    [asset('unknown'), 'application/octet-stream'],
  ];

  for (const [declared, contentType] of cases) {
    const refused = response({ contentType });
    const transport = httpTransport(async () => refused.value);
    await assert.rejects(
      () => transport(declared, new AbortController().signal),
      (error) => error?.code === 'mime',
    );
    assert.equal(refused.state.reads, 0, `${declared.kind}/${contentType} read its body`);
  }
});

test('a redirected response is rejected even when a custom fetcher returns one', async () => {
  const refused = response({ redirected: true });
  const transport = httpTransport(async () => refused.value);
  await assert.rejects(
    () => transport(asset('wasm'), new AbortController().signal),
    (error) => error?.code === 'http',
  );
  assert.equal(refused.state.reads, 0);
});

test('oversized and non-byte streams fail closed without awaiting hostile cancellation', async () => {
  for (const [chunk, expectedCode] of [
    [Uint8Array.from([1, 2, 3]), 'size'],
    ['not bytes', 'http'],
  ]) {
    const refused = response({
      chunks: [chunk],
      cancel: () => new Promise(() => {}),
    });
    const transport = httpTransport(async () => refused.value);
    const declared = asset('wasm', 2);
    await assert.rejects(
      () => within(transport(declared, new AbortController().signal)),
      (error) => error?.code === expectedCode,
    );
    assert.equal(refused.state.cancels, 1);
    assert.equal(refused.state.releases, 1);
  }
});

test('caller abort settles promptly even when a custom response read never settles', async () => {
  let started;
  const readStarted = new Promise((resolve) => { started = resolve; });
  const hostile = response({
    read: () => {
      started();
      return new Promise(() => {});
    },
    cancel: () => new Promise(() => {}),
  });
  const controller = new AbortController();
  const reason = new Error('page was replaced');
  const pending = httpTransport(async () => hostile.value)(asset('wasm'), controller.signal);

  await readStarted;
  controller.abort(reason);
  await assert.rejects(() => within(pending), (error) => error === reason);
  assert.equal(hostile.state.cancels, 1);
  assert.equal(hostile.state.releases, 1);
});
