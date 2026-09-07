import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMarketingIntentLoader } from '../src/marketing.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const exit = async (element, type = 'pointerleave') => {
  element.dispatchEvent(new Event(type));
  await new Promise((resolve) => setTimeout(resolve, 5));
};
const release = (version = 'v1') => ({ appId: 'marketing-demo', release: version });

function fixture(t, paths = ['/release.json'], options = {}) {
  const doc = Object.assign(new EventTarget(), {
    baseURI: 'https://marketing.example.test/',
    visibilityState: 'visible',
    defaultView: new EventTarget(),
  });
  const links = paths.map((path) => Object.assign(new EventTarget(), {
    ownerDocument: doc,
    isConnected: true,
    getAttribute(name) {
      if (name === 'data-owls-manifest') return path;
      return null;
    },
  }));
  const requests = [];
  const preparations = [];
  const outcomes = [];
  const errors = [];
  const coordinator = {
    load(url, options) {
      return new Promise((resolve, reject) => requests.push({ url, ...options, resolve, reject }));
    },
    prepare(key, _signal, { variant }) {
      const call = { key, variant, releases: 0 };
      preparations.push(call);
      return {
        promise: Promise.resolve({ status: 'warmed', bytes: 8 }),
        release() { call.releases += 1; },
      };
    },
  };
  const installation = installMarketingIntentLoader({
    coordinator,
    root: { querySelectorAll: () => links },
    dwellMs: 0,
    exitGraceMs: 0,
    onOutcome: (value) => outcomes.push(value),
    onError: (value) => errors.push(value),
    ...options,
  });
  t.after(() => installation.dispose());
  const press = (index = 0) => links[index].dispatchEvent(new Event('pointerdown'));
  return { doc, links, requests, preparations, outcomes, errors, coordinator, installation, press };
}

test('installation and ordinary clicks perform no speculative manifest request', async (t) => {
  const f = fixture(t);
  const click = new Event('click', { cancelable: true });
  assert.equal(f.links[0].dispatchEvent(click), true);
  await turn();
  assert.equal(click.defaultPrevented, false);
  assert.equal(f.requests.length, 0);
});

test('last interested link aborts its manifest request before assets are prepared', async (t) => {
  const f = fixture(t);
  f.press();
  await turn();
  assert.ok(f.requests[0].signal instanceof AbortSignal);
  await exit(f.links[0]);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.preparations.length, 0);
  assert.equal(f.errors.length, 0, 'intent cancellation is not a user-visible error');
});

test('releasing one link preserves a shared manifest for the remaining link', async (t) => {
  const f = fixture(t, ['/release.json', '/release.json']);
  f.press(0); f.press(1);
  await turn();
  assert.equal(f.requests.length, 1);
  await exit(f.links[0]);
  assert.equal(f.requests[0].signal.aborted, false);
  f.requests[0].resolve(release());
  await turn();
  assert.equal(f.preparations.length, 1);
  assert.equal(f.outcomes.length, 1);
  assert.equal(f.outcomes[0].element, f.links[1]);
});

test('the last of several owners aborts a shared manifest exactly once', async (t) => {
  const f = fixture(t, ['/release.json', '/release.json']);
  f.press(0); f.press(1);
  await turn();
  let aborts = 0;
  f.requests[0].signal.addEventListener('abort', () => { aborts += 1; });
  await exit(f.links[0]);
  assert.equal(aborts, 0);
  await exit(f.links[1]);
  f.installation.dispose(); f.installation.dispose();
  await turn();
  assert.equal(aborts, 1);
});

test('different manifest URLs have independent cancellation ownership', async (t) => {
  const f = fixture(t, ['/one.json', '/two.json']);
  f.press(0); f.press(1);
  await turn();
  await exit(f.links[0]);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal.aborted, false);
  f.requests[1].resolve(release());
  await turn();
  assert.equal(f.preparations.length, 1);
});

test('dispose aborts all pending manifests and suppresses late results', async (t) => {
  const f = fixture(t, ['/one.json', '/two.json']);
  f.press(0); f.press(1);
  await turn();
  f.installation.dispose();
  await turn();
  assert.ok(f.requests.every((request) => request.signal.aborted));
  for (const request of f.requests) request.resolve(release());
  await turn();
  assert.equal(f.preparations.length, 0);
  assert.equal(f.outcomes.length, 0);
  assert.equal(f.errors.length, 0);
});

test('dispose before request scheduling prevents even the manifest fetch', async (t) => {
  const f = fixture(t);
  f.press();
  f.installation.dispose();
  await turn();
  assert.equal(f.requests.length, 0);
});

test('pagehide aborts manifests and pageshow permits a fresh intent', async (t) => {
  const f = fixture(t);
  f.press();
  await turn();
  f.doc.defaultView.dispatchEvent(new Event('pagehide'));
  await turn();
  assert.equal(f.requests[0].signal.aborted, true);
  f.press();
  await turn();
  assert.equal(f.requests.length, 1, 'a suspended document cannot restart');
  f.doc.defaultView.dispatchEvent(new Event('pageshow'));
  f.press();
  await turn();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(release('restored'));
  await turn();
  assert.equal(f.preparations[0].key, 'marketing-demo@restored');
});

test('a hidden document aborts manifests and cannot fetch until visible again', async (t) => {
  const f = fixture(t);
  f.press();
  await turn();
  f.doc.visibilityState = 'hidden';
  f.doc.dispatchEvent(new Event('visibilitychange'));
  await turn();
  assert.equal(f.requests[0].signal.aborted, true);
  f.press();
  await turn();
  assert.equal(f.requests.length, 1);
  f.doc.visibilityState = 'visible';
  f.doc.dispatchEvent(new Event('visibilitychange'));
  f.press();
  await turn();
  assert.equal(f.requests.length, 2);
});

test('late abandoned success cannot poison the successful-manifest cache', async (t) => {
  const f = fixture(t);
  f.press(); await turn();
  await exit(f.links[0]);
  f.press(); await turn();
  assert.equal(f.requests.length, 2);
  f.requests[0].resolve(release('abandoned'));
  await turn();
  assert.equal(f.preparations.length, 0);
  f.requests[1].resolve(release('current'));
  await turn();
  await exit(f.links[0]);
  f.press(); await turn();
  assert.equal(f.requests.length, 2, 'successful manifest is reused');
  assert.deepEqual(f.preparations.map((call) => call.key), ['marketing-demo@current', 'marketing-demo@current']);
});

test('late abandoned rejection cannot evict a new in-flight shared request', async (t) => {
  const f = fixture(t, ['/release.json', '/release.json']);
  f.press(0); await turn();
  await exit(f.links[0]);
  f.press(0); await turn();
  f.requests[0].reject(new Error('late network rejection'));
  await turn();
  f.press(1); await turn();
  assert.equal(f.requests.length, 2, 'new owner must join the replacement request');
  f.requests[1].resolve(release());
  await turn();
  assert.equal(f.preparations.length, 2);
  assert.equal(f.errors.length, 0);
});

test('successful manifest reuse still produces independent asset leases', async (t) => {
  const f = fixture(t);
  f.press(); await turn();
  f.requests[0].resolve(release()); await turn();
  await exit(f.links[0]);
  f.press(); await turn();
  assert.equal(f.requests.length, 1);
  assert.equal(f.preparations.length, 2);
  assert.equal(f.preparations[0].releases, 1);
  assert.equal(f.preparations[1].releases, 0);
});

test('synchronous manifest loader failure is isolated and retryable', async (t) => {
  const f = fixture(t);
  const load = f.coordinator.load;
  let calls = 0;
  f.coordinator.load = (...args) => {
    calls += 1;
    if (calls === 1) throw new Error('synchronous failure');
    return load(...args);
  };
  f.press(); await turn();
  assert.equal(f.errors.length, 1);
  await exit(f.links[0]);
  f.press(); await turn();
  f.requests[0].resolve(release()); await turn();
  assert.equal(calls, 2);
  assert.equal(f.preparations.length, 1);
});

test('rejected manifest requests are retryable after a new intent', async (t) => {
  const f = fixture(t);
  f.press(); await turn();
  f.requests[0].reject(new Error('offline')); await turn();
  assert.equal(f.errors.length, 1);
  await exit(f.links[0]);
  f.press(); await turn();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(release()); await turn();
  assert.equal(f.preparations.length, 1);
});

test('focus ownership keeps a manifest alive after pointer exit', async (t) => {
  const f = fixture(t);
  f.press();
  f.links[0].dispatchEvent(new Event('focusin'));
  await turn();
  await exit(f.links[0]);
  assert.equal(f.requests[0].signal.aborted, false);
  await exit(f.links[0], 'focusout');
  assert.equal(f.requests[0].signal.aborted, true);
});

test('touchcancel releases manifest ownership without intercepting navigation', async (t) => {
  const f = fixture(t);
  f.links[0].dispatchEvent(new Event('touchstart'));
  await turn();
  await exit(f.links[0], 'touchcancel');
  assert.equal(f.requests[0].signal.aborted, true);
});

test('reentrant disposal during asset acquisition releases the returned lease once', async (t) => {
  const f = fixture(t);
  const prepare = f.coordinator.prepare;
  f.coordinator.prepare = (...args) => {
    f.installation.dispose();
    return prepare(...args);
  };
  f.press(); await turn();
  f.requests[0].resolve(release()); await turn();
  assert.equal(f.preparations[0].releases, 1);
  assert.equal(f.outcomes.length, 0);
  f.installation.dispose();
  assert.equal(f.preparations[0].releases, 1);
});

test('rejected instrumentation callbacks never become unhandled rejections', async (t) => {
  const f = fixture(t, ['/one.json', '/two.json'], {
    onOutcome: async () => { throw new Error('outcome sink unavailable'); },
    onError: async () => { throw new Error('error sink unavailable'); },
  });
  f.press(0); f.press(1); await turn();
  f.requests[0].resolve(release());
  f.requests[1].reject(new Error('manifest unavailable'));
  await turn(); await turn();
  assert.equal(f.preparations.length, 1);
});
