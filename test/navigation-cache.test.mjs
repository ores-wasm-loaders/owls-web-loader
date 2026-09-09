import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARED_NAVIGATION_CACHE_NAMESPACE,
  createSameOriginNavigationStore,
} from '../index.mjs';

class FakeCache {
  constructor() {
    this.entries = new Map();
  }

  async match(request) {
    return this.entries.get(request.url)?.clone();
  }

  async put(request, response) {
    this.entries.set(request.url, response.clone());
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(request) {
    return this.entries.delete(request.url);
  }
}

class FakeCacheStorage {
  constructor() {
    this.namespaces = new Map();
  }

  async open(namespace) {
    let cache = this.namespaces.get(namespace);
    if (!cache) {
      cache = new FakeCache();
      this.namespaces.set(namespace, cache);
    }
    return cache;
  }
}

const ORIGIN = 'https://app.example.test';
const BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const KEY = 'https://assets.example.test/releases/app/r1/app.wasm#0123456789abcdef';

test('canonical navigation stores reuse verified bytes across page instances', async () => {
  const storage = new FakeCacheStorage();
  const marketingPage = createSameOriginNavigationStore({ storage, origin: ORIGIN });
  const applicationPage = createSameOriginNavigationStore({ storage, origin: ORIGIN });

  assert.equal(marketingPage.namespace, SHARED_NAVIGATION_CACHE_NAMESPACE);
  assert.equal(applicationPage.namespace, SHARED_NAVIGATION_CACHE_NAMESPACE);

  await marketingPage.put(KEY, BYTES);
  const warmed = await applicationPage.get(KEY);
  assert.deepEqual(warmed, BYTES);

  // A consumer receives detached bytes rather than a mutable alias of the cached response.
  warmed[0] = 99;
  assert.equal((await applicationPage.get(KEY))[0], 0);
});

test('navigation stores remain isolated by namespace', async () => {
  const storage = new FakeCacheStorage();
  const first = createSameOriginNavigationStore({ storage, origin: ORIGIN });
  const otherGeneration = createSameOriginNavigationStore({
    storage,
    origin: ORIGIN,
    namespace: 'owls-navigation-v2',
  });

  await first.put(KEY, BYTES);
  assert.equal(await otherGeneration.get(KEY), undefined);
});

test('navigation stores remain isolated by origin even with one backing test storage', async () => {
  const storage = new FakeCacheStorage();
  const marketingPage = createSameOriginNavigationStore({ storage, origin: ORIGIN });
  const otherOrigin = createSameOriginNavigationStore({ storage, origin: 'https://other.example.test' });

  await marketingPage.put(KEY, BYTES);
  assert.equal(await otherOrigin.get(KEY), undefined);
});

test('same-origin helper fails closed when Cache Storage or a canonical HTTPS origin is unavailable', () => {
  for (const options of [
    { storage: null, origin: ORIGIN },
    { storage: new FakeCacheStorage(), origin: '' },
    { storage: new FakeCacheStorage(), origin: 'http://app.example.test' },
    { storage: new FakeCacheStorage(), origin: 'not a url' },
    { storage: new FakeCacheStorage(), origin: 'https://app.example.test/' },
  ]) {
    assert.throws(
      () => createSameOriginNavigationStore(options),
      (error) => error?.code === 'cache',
    );
  }
});
