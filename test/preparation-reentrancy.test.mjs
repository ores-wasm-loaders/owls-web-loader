import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { prepareOnIntent, prepareWhenIdle } from '../src/hints.mjs';

test('intent releases a lease acquired during synchronous teardown', async (t) => {
  const view = new EventTarget();
  const doc = Object.assign(new EventTarget(), { defaultView: view, visibilityState: 'visible' });
  const element = Object.assign(new EventTarget(), { ownerDocument: doc, isConnected: true });
  let stop;
  let releases = 0;
  let errors = 0;
  const coordinator = {
    prepare() {
      stop();
      return { promise: Promise.reject(new Error('cancelled during acquisition')), release() { releases += 1; } };
    },
  };
  stop = prepareOnIntent(element, coordinator, 'demo@v1', { onError: () => { errors += 1; } });
  t.after(stop);
  element.dispatchEvent(new Event('pointerdown'));
  await flush();
  stop();
  assert.equal(releases, 1);
  assert.equal(errors, 0);
});

test('idle releases a lease acquired during synchronous teardown', async (t) => {
  let callback;
  let stop;
  let releases = 0;
  let errors = 0;
  // Node has no native idle scheduler; exercise the ordinary timer fallback.
  assert.equal(typeof globalThis.requestIdleCallback, 'undefined');
  t.mock.method(globalThis, 'setTimeout', (fn) => { callback = fn; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const coordinator = {
    prepare() {
      stop();
      return { promise: Promise.reject(new Error('cancelled during acquisition')), release() { releases += 1; } };
    },
  };
  stop = prepareWhenIdle(coordinator, 'demo@v1', () => { errors += 1; });
  t.after(stop);
  callback();
  callback();
  await flush();
  stop();
  assert.equal(releases, 1);
  assert.equal(errors, 0);
});
