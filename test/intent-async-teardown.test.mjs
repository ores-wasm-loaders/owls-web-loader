import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { prepareOnIntent, prepareWhenIdle } from '../src/hints.mjs';

class Events {
  listeners = new Map();
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
  }
  emit(type, fields = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, ...fields });
  }
}

function clock(t) {
  let next = 0;
  const tasks = new Map();
  t.mock.method(globalThis, 'setTimeout', (fn) => { tasks.set(++next, fn); return next; });
  t.mock.method(globalThis, 'clearTimeout', (id) => tasks.delete(id));
  return {
    tasks,
    run() {
      const pending = [...tasks.values()];
      tasks.clear();
      for (const fn of pending) fn();
    },
  };
}

function install(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function fixture(t, options = {}) {
  const page = new Events();
  const doc = Object.assign(new Events(), { defaultView: page, visibilityState: 'visible' });
  const element = Object.assign(new Events(), { ownerDocument: doc, isConnected: true });
  const leases = [];
  const outcomes = [];
  const errors = [];
  const coordinator = {
    prepare(key) {
      assert.equal(key, 'demo@v1');
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const lease = { promise, resolve, reject, releases: 0, release() { this.releases += 1; } };
      leases.push(lease);
      return lease;
    },
  };
  const stop = prepareOnIntent(element, coordinator, 'demo@v1', {
    dwellMs: 20, exitGraceMs: 20,
    onOutcome: (value) => outcomes.push(value),
    onError: (error) => errors.push(error),
    ...options,
  });
  t.after(stop);
  return { page, doc, element, leases, outcomes, errors, stop, coordinator };
}

test('Window pagehide releases its lease and cancels pending intent', (t) => {
  const timer = clock(t);
  const f = fixture(t);
  assert.equal(f.doc.listeners.has('pagehide'), false);
  f.element.emit('pointerdown');
  f.page.emit('pagehide');
  assert.equal(f.leases[0].releases, 1);
  assert.equal(timer.tasks.size, 0);
  f.element.emit('pointerenter');
  timer.run();
  assert.equal(f.leases.length, 1, 'a hidden page cannot restart preparation');
});

test('pageshow restores eligibility but requires fresh intent', (t) => {
  const timer = clock(t);
  const f = fixture(t);
  f.element.emit('pointerenter');
  f.page.emit('pagehide');
  timer.run();
  assert.equal(f.leases.length, 0);
  f.page.emit('pageshow');
  timer.run();
  assert.equal(f.leases.length, 0);
  f.element.emit('focusin');
  timer.run();
  assert.equal(f.leases.length, 1);
});

test('hidden documents and detached targets do not acquire preparation', (t) => {
  const timer = clock(t);
  const f = fixture(t);
  f.doc.visibilityState = 'hidden';
  f.element.emit('pointerdown');
  f.element.emit('focusin');
  timer.run();
  assert.equal(f.leases.length, 0);
  f.doc.visibilityState = 'visible';
  f.element.emit('pointerenter');
  f.element.isConnected = false;
  timer.run();
  assert.equal(f.leases.length, 0);
});

test('visibilitychange releases the lease even without pagehide', (t) => {
  clock(t);
  const f = fixture(t);
  f.element.emit('pointerdown');
  f.doc.visibilityState = 'hidden';
  f.doc.emit('visibilitychange');
  assert.equal(f.leases[0].releases, 1);
  f.doc.visibilityState = 'visible';
  f.doc.emit('visibilitychange');
  f.element.emit('pointerdown');
  assert.equal(f.leases.length, 2);
});

test('queued observers cannot schedule after disposal or while hidden', (t) => {
  const timer = clock(t);
  let deliver;
  let disconnects = 0;
  install(t, 'IntersectionObserver', class {
    constructor(callback) { deliver = callback; }
    observe() {}
    disconnect() { disconnects += 1; }
  });
  const f = fixture(t, { visibilityMs: 40 });
  const entry = [{ target: f.element, isIntersecting: true }];
  f.doc.visibilityState = 'hidden';
  deliver(entry);
  assert.equal(timer.tasks.size, 0);
  f.doc.visibilityState = 'visible';
  f.stop();
  f.stop();
  deliver(entry);
  assert.equal(timer.tasks.size, 0);
  assert.equal(disconnects, 1);
  assert.equal(f.element.listeners.size, 0);
  assert.equal(f.doc.listeners.size, 0);
  assert.equal(f.page.listeners.size, 0);
});

test('the observer comes from the target document realm when available', (t) => {
  const timer = clock(t);
  let observed;
  const page = Object.assign(new Events(), {
    IntersectionObserver: class {
      observe(element) { observed = element; }
      disconnect() {}
    },
  });
  const doc = Object.assign(new Events(), { defaultView: page, visibilityState: 'visible' });
  const element = Object.assign(new Events(), { ownerDocument: doc, isConnected: true });
  const stop = prepareOnIntent(element, { prepare() { throw new Error('no intent'); } }, 'demo@v1', { visibilityMs: 40 });
  t.after(stop);
  assert.equal(observed, element);
  assert.equal(timer.tasks.size, 0);
});

test('disposed hooks ignore completed and rejected lease callbacks', async (t) => {
  clock(t);
  const first = fixture(t);
  const second = fixture(t);
  first.element.emit('pointerdown');
  second.element.emit('pointerdown');
  first.stop();
  second.stop();
  first.leases[0].resolve('obsolete');
  second.leases[0].reject(new Error('obsolete'));
  await flush();
  assert.deepEqual(first.outcomes, []);
  assert.deepEqual(second.errors, []);
});

test('callbacks belong to the current lease, not a released predecessor', async (t) => {
  const timer = clock(t);
  const f = fixture(t);
  f.element.emit('pointerdown');
  f.element.emit('pointerleave');
  timer.run();
  assert.equal(f.leases[0].releases, 1);
  f.element.emit('pointerdown');
  f.leases[0].resolve('old');
  f.leases[1].resolve('current');
  await flush();
  assert.deepEqual(f.outcomes, ['current']);
});

test('detached targets do not receive late outcomes or errors', async (t) => {
  clock(t);
  const f = fixture(t);
  f.element.emit('pointerdown');
  f.element.isConnected = false;
  f.leases[0].resolve('detached');
  await flush();
  assert.deepEqual(f.outcomes, []);
});

test('intent callbacks isolate both synchronous throws and rejected promises', async (t) => {
  clock(t);
  const first = fixture(t, { onOutcome: () => { throw new Error('callback'); } });
  const second = fixture(t, { onError: async () => { throw new Error('async callback'); } });
  first.element.emit('pointerdown');
  second.element.emit('pointerdown');
  first.leases[0].resolve('ready');
  second.leases[0].reject(new Error('transport'));
  await flush();
});

test('late idle callbacks cannot acquire after cancellation', (t) => {
  let callback;
  let cancellations = 0;
  install(t, 'requestIdleCallback', (fn) => { callback = fn; return 7; });
  install(t, 'cancelIdleCallback', (id) => { assert.equal(id, 7); cancellations += 1; });
  let calls = 0;
  const stop = prepareWhenIdle({ prepare() { calls += 1; return { promise: Promise.resolve(), release() {} }; } }, 'demo@v1');
  stop();
  stop();
  callback();
  assert.equal(calls, 0);
  assert.equal(cancellations, 1);
});

test('idle teardown releases exactly once and ignores later failures', async (t) => {
  let callback;
  let reject;
  let released = 0;
  let errors = 0;
  const promise = new Promise((_resolve, no) => { reject = no; });
  install(t, 'requestIdleCallback', (fn) => { callback = fn; return 9; });
  install(t, 'cancelIdleCallback', () => {});
  const stop = prepareWhenIdle({ prepare: () => ({ promise, release() { released += 1; } }) }, 'demo@v1', () => { errors += 1; });
  callback();
  stop();
  stop();
  reject(new Error('too late'));
  await flush();
  assert.equal(released, 1);
  assert.equal(errors, 0);
});

test('idle preparation is acquired once even when a scheduler repeats the callback', (t) => {
  let callback;
  let calls = 0;
  install(t, 'requestIdleCallback', (fn) => { callback = fn; return 1; });
  install(t, 'cancelIdleCallback', () => {});
  const stop = prepareWhenIdle({ prepare() { calls += 1; return { promise: Promise.resolve(), release() {} }; } }, 'demo@v1');
  t.after(stop);
  callback();
  callback();
  assert.equal(calls, 1);
});

test('idle cancellation remains effective without cancelIdleCallback', (t) => {
  let callback;
  let calls = 0;
  install(t, 'requestIdleCallback', (fn) => { callback = fn; return 1; });
  install(t, 'cancelIdleCallback', undefined);
  const stop = prepareWhenIdle({ prepare() { calls += 1; } }, 'demo@v1');
  stop();
  callback();
  assert.equal(calls, 0);
});

test('idle synchronous failures and throwing error handlers are isolated', (t) => {
  let callback;
  install(t, 'requestIdleCallback', (fn) => { callback = fn; return 1; });
  install(t, 'cancelIdleCallback', () => {});
  const stop = prepareWhenIdle({ prepare() { throw new Error('prepare failed'); } }, 'demo@v1', () => { throw new Error('callback failed'); });
  t.after(stop);
  assert.doesNotThrow(() => callback());
});

test('idle asynchronous error handlers cannot produce unhandled rejections', async (t) => {
  let callback;
  install(t, 'requestIdleCallback', (fn) => { callback = fn; return 1; });
  install(t, 'cancelIdleCallback', () => {});
  const stop = prepareWhenIdle({ prepare: () => ({ promise: Promise.reject(new Error('prepare failed')), release() {} }) }, 'demo@v1', async () => { throw new Error('callback failed'); });
  t.after(stop);
  callback();
  await flush();
});

test('fallback timers are cancelled before idle preparation starts', (t) => {
  const timer = clock(t);
  install(t, 'requestIdleCallback', undefined);
  let calls = 0;
  const stop = prepareWhenIdle({ prepare() { calls += 1; } }, 'demo@v1');
  assert.equal(timer.tasks.size, 1);
  stop();
  timer.run();
  assert.equal(calls, 0);
  assert.equal(timer.tasks.size, 0);
});
