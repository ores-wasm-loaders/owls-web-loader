import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareOnIntent, prepareWhenIdle } from '../src/hints.mjs';

class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
    super.removeEventListener(type, callback, options);
  }
}

function fixture(promise = Promise.resolve({ status: 'warmed' })) {
  const view = new Target();
  const doc = Object.assign(new Target(), { visibilityState: 'visible', defaultView: view });
  const element = Object.assign(new Target(), { ownerDocument: doc, isConnected: true });
  const counts = { prepared: 0, released: 0 };
  const coordinator = { prepare() {
    counts.prepared += 1;
    return { promise, release() { counts.released += 1; } };
  } };
  return { view, doc, element, coordinator, counts };
}

function fire(target, type, properties = {}) {
  target.dispatchEvent(Object.assign(new Event(type), properties));
}

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

function idleQueue(t) {
  let callback;
  const cancelled = [];
  replaceGlobal(t, 'requestIdleCallback', (fn) => { callback = fn; return 7; });
  replaceGlobal(t, 'cancelIdleCallback', (id) => cancelled.push(id));
  return { run: () => callback(), cancelled };
}

test('Window pagehide releases the intent lease and cleanup removes every listener', (t) => {
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app');
  t.after(stop);
  fire(f.element, 'pointerdown');
  assert.equal(f.counts.prepared, 1);
  fire(f.view, 'pagehide');
  assert.equal(f.counts.released, 1);
  stop();
  stop();
  assert.equal(f.counts.released, 1);
  for (const target of [f.element, f.doc, f.view]) assert.equal(target.listeners.size, 0);
});

test('pagehide cancels dwell and blocks queued intent until pageshow', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app');
  t.after(stop);
  fire(f.element, 'pointerenter');
  t.mock.timers.tick(100);
  fire(f.view, 'pagehide');
  fire(f.element, 'pointerdown');
  t.mock.timers.tick(1_000);
  assert.equal(f.counts.prepared, 0);
  fire(f.view, 'pageshow');
  assert.equal(f.counts.prepared, 0, 'restoring a page does not itself imply intent');
  fire(f.element, 'focusin');
  t.mock.timers.tick(150);
  assert.equal(f.counts.prepared, 1);
});

test('hidden documents cannot prepare and can accept fresh intent after becoming visible', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.doc.visibilityState = 'hidden';
  const stop = prepareOnIntent(f.element, f.coordinator, 'app');
  t.after(stop);
  fire(f.element, 'pointerdown');
  fire(f.element, 'focusin');
  t.mock.timers.tick(1_000);
  assert.equal(f.counts.prepared, 0);
  f.doc.visibilityState = 'visible';
  fire(f.doc, 'visibilitychange');
  fire(f.element, 'pointerdown');
  assert.equal(f.counts.prepared, 1);
});

test('removing a target during dwell prevents preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app');
  t.after(stop);
  fire(f.element, 'pointerenter');
  f.element.isConnected = false;
  t.mock.timers.tick(150);
  fire(f.element, 'pointerdown');
  assert.equal(f.counts.prepared, 0);
});

test('queued intersection callbacks cannot revive hidden or disposed preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let observer;
  replaceGlobal(t, 'IntersectionObserver', class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  });
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app', { visibilityMs: 100 });
  t.after(stop);
  f.doc.visibilityState = 'hidden';
  fire(f.doc, 'visibilitychange');
  observer.callback([{ target: f.element, isIntersecting: true }]);
  t.mock.timers.tick(100);
  assert.equal(f.counts.prepared, 0);
  stop();
  assert.equal(observer.disconnected, true);
  f.doc.visibilityState = 'visible';
  observer.callback([{ target: f.element, isIntersecting: true }]);
  t.mock.timers.tick(100);
  assert.equal(f.counts.prepared, 0);
});

for (const settlement of ['resolve', 'reject']) {
  test(`intent ${settlement} callback does not run after disposal`, async (t) => {
    let settle;
    const promise = new Promise((resolve, reject) => { settle = settlement === 'resolve' ? resolve : reject; });
    const f = fixture(promise);
    let notifications = 0;
    const notify = () => { notifications += 1; };
    const stop = prepareOnIntent(f.element, f.coordinator, 'app', { onOutcome: notify, onError: notify });
    t.after(stop);
    fire(f.element, 'pointerdown');
    stop();
    settle(new Error('settled after disposal'));
    await Promise.resolve();
    assert.equal(notifications, 0);
  });
}

test('intent completion does not notify a disconnected target', async (t) => {
  let settle;
  const f = fixture(new Promise((resolve) => { settle = resolve; }));
  let notifications = 0;
  const stop = prepareOnIntent(f.element, f.coordinator, 'app', { onOutcome: () => { notifications += 1; } });
  t.after(stop);
  fire(f.element, 'pointerdown');
  f.element.isConnected = false;
  settle({ status: 'warmed' });
  await Promise.resolve();
  assert.equal(notifications, 0);
});

for (const event of ['pointerup', 'pointercancel', 'touchcancel']) {
  test(`${event} releases touch intent without leaving a synthetic hover lease`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const stop = prepareOnIntent(f.element, f.coordinator, 'app', { exitGraceMs: 10 });
    t.after(stop);
    fire(f.element, 'pointerenter', { pointerType: 'touch' });
    fire(f.element, 'pointerdown', { pointerType: 'touch' });
    fire(f.element, event, { pointerType: 'touch' });
    t.mock.timers.tick(10);
    assert.deepEqual(f.counts, { prepared: 1, released: 1 });
  });
}

test('idle callback delivered after cancellation does not start work', (t) => {
  const queue = idleQueue(t);
  const f = fixture();
  const stop = prepareWhenIdle(f.coordinator, 'app');
  t.after(stop);
  stop();
  queue.run();
  assert.equal(f.counts.prepared, 0);
  assert.deepEqual(queue.cancelled, [7]);
});

test('idle disposal releases once and a duplicate idle callback cannot prepare twice', (t) => {
  const queue = idleQueue(t);
  const f = fixture();
  const stop = prepareWhenIdle(f.coordinator, 'app');
  t.after(stop);
  queue.run();
  queue.run();
  stop();
  stop();
  assert.deepEqual(f.counts, { prepared: 1, released: 1 });
});

test('idle observer errors are isolated from synchronous preparation failure', (t) => {
  const queue = idleQueue(t);
  let errors = 0;
  const stop = prepareWhenIdle({ prepare() { throw new Error('prepare failed'); } }, 'app', () => {
    errors += 1;
    throw new Error('observer failed');
  });
  t.after(stop);
  assert.doesNotThrow(queue.run);
  assert.equal(errors, 1);
});

test('idle rejection after disposal cannot notify a stale error observer', async (t) => {
  const queue = idleQueue(t);
  let reject;
  const f = fixture(new Promise((_resolve, fail) => { reject = fail; }));
  let errors = 0;
  const stop = prepareWhenIdle(f.coordinator, 'app', () => { errors += 1; });
  t.after(stop);
  queue.run();
  stop();
  reject(new Error('cancelled'));
  await Promise.resolve();
  assert.equal(errors, 0);
});

test('timer fallback is cancelled before it can prepare', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  replaceGlobal(t, 'requestIdleCallback', undefined);
  const f = fixture();
  const stop = prepareWhenIdle(f.coordinator, 'app');
  t.after(stop);
  stop();
  t.mock.timers.tick(1_000);
  assert.equal(f.counts.prepared, 0);
});

for (const settlement of ['resolve', 'reject']) {
  test(`released lease ${settlement} cannot notify a new intent after page restoration`, async (t) => {
    const f = fixture();
    const pending = [];
    f.coordinator.prepare = () => ({
      promise: new Promise((resolve, reject) => { pending.push({ resolve, reject }); }),
      release() {},
    });
    const outcomes = [];
    const errors = [];
    const stop = prepareOnIntent(f.element, f.coordinator, 'app', {
      onOutcome: (value) => outcomes.push(value),
      onError: (error) => errors.push(error),
    });
    t.after(stop);
    fire(f.element, 'pointerdown');
    fire(f.view, 'pagehide');
    fire(f.view, 'pageshow');
    fire(f.element, 'pointerdown');
    pending[0][settlement](new Error('old lease'));
    await Promise.resolve();
    assert.deepEqual(outcomes, []);
    assert.deepEqual(errors, []);
    pending[1].resolve({ status: 'warmed' });
    await Promise.resolve();
    assert.deepEqual(outcomes, [{ status: 'warmed' }]);
  });
}

test('touch cancellation retains keyboard focus ownership until blur', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app', { exitGraceMs: 10 });
  t.after(stop);
  fire(f.element, 'focusin');
  fire(f.element, 'pointerdown', { pointerType: 'touch' });
  fire(f.element, 'pointercancel', { pointerType: 'touch' });
  t.mock.timers.tick(10);
  assert.deepEqual(f.counts, { prepared: 1, released: 0 });
  fire(f.element, 'focusout');
  t.mock.timers.tick(10);
  assert.equal(f.counts.released, 1);
});

test('mouse pointerup retains hover ownership until pointerleave', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app', { exitGraceMs: 10 });
  t.after(stop);
  fire(f.element, 'pointerdown', { pointerType: 'mouse' });
  fire(f.element, 'pointerup', { pointerType: 'mouse' });
  t.mock.timers.tick(10);
  assert.equal(f.counts.released, 0);
  fire(f.element, 'pointerleave', { pointerType: 'mouse' });
  t.mock.timers.tick(10);
  assert.equal(f.counts.released, 1);
});

test('returning during the exit grace period retains a single preparation lease', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const stop = prepareOnIntent(f.element, f.coordinator, 'app', { exitGraceMs: 10 });
  t.after(stop);
  fire(f.element, 'pointerdown');
  fire(f.element, 'pointerleave');
  t.mock.timers.tick(5);
  fire(f.element, 'pointerenter');
  t.mock.timers.tick(150);
  assert.deepEqual(f.counts, { prepared: 1, released: 0 });
});

test('idle observer errors are isolated from asynchronous preparation failure', async (t) => {
  const queue = idleQueue(t);
  let reject;
  const f = fixture(new Promise((_resolve, fail) => { reject = fail; }));
  let errors = 0;
  const stop = prepareWhenIdle(f.coordinator, 'app', () => {
    errors += 1;
    throw new Error('observer failed');
  });
  t.after(stop);
  queue.run();
  reject(new Error('prepare failed'));
  await Promise.resolve();
  assert.equal(errors, 1);
});

for (const settlement of ['resolve', 'reject']) {
  test(`active intent ${settlement} observer is called once and errors stay isolated`, async (t) => {
    let settle;
    const promise = new Promise((resolve, reject) => { settle = settlement === 'resolve' ? resolve : reject; });
    const f = fixture(promise);
    let notifications = 0;
    const notify = () => { notifications += 1; throw new Error('observer failed'); };
    const stop = prepareOnIntent(f.element, f.coordinator, 'app', { onOutcome: notify, onError: notify });
    t.after(stop);
    fire(f.element, 'pointerdown');
    settle({ status: 'warmed' });
    await Promise.resolve();
    assert.equal(notifications, 1);
  });
}
