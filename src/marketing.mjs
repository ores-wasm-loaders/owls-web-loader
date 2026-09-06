// HTML-first marketing integration for OWLS.
//
// This module deliberately owns only public manifest loading and fetch-only preparation. It
// never prevents navigation and never imports, instantiates, hydrates, mounts, authenticates,
// subscribes, or writes. The destination document remains the authority for activation.
import { LoaderError, releaseKey } from './contract.mjs';
import { prepareOnIntent } from './hints.mjs';

const DEFAULT_SELECTOR = 'a[data-owls-manifest]';
const VARIANTS = new Set(['module', 'fallback']);

function safeCall(callback, value) {
  try { void Promise.resolve(callback(value)).catch(() => {}); } catch { /* callback isolation */ }
}

function canonicalManifestUrl(element, raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new LoaderError('manifest', 'data-owls-manifest must be a non-empty URL');
  }
  const base = element.ownerDocument?.baseURI ?? globalThis.location?.href;
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    throw new LoaderError('manifest', `Invalid manifest URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new LoaderError('manifest', `Manifest URL must use HTTPS: ${url.href}`);
  }
  if (url.username || url.password || url.hash) {
    throw new LoaderError('manifest', `Manifest URL must not contain credentials or a fragment: ${url.href}`);
  }
  return url.href;
}

function variantFor(element) {
  const value = element.getAttribute('data-owls-variant') ?? 'module';
  if (!VARIANTS.has(value)) throw new LoaderError('manifest', `Unsupported OWLS startup variant: ${value}`);
  return value;
}

function deferredLease(load, acquire, metadata) {
  let released = false;
  let activeLease;
  const promise = load().then((release) => {
    const key = releaseKey(release);
    if (released) {
      const outcome = Object.freeze({
        key,
        appId: release.appId,
        release: release.release,
        variant: metadata.variant,
        status: 'cancelled',
        prepared: Object.freeze([]),
        skipped: Object.freeze([]),
        bytes: 0,
        cancelled: true,
        reason: 'intent-released-before-manifest',
      });
      return Object.freeze({ ...metadata, key, outcome });
    }
    activeLease = acquire(key, metadata.variant);
    return activeLease.promise.then((outcome) => Object.freeze({ ...metadata, key, outcome }));
  });

  return Object.freeze({
    promise,
    done: promise,
    release() {
      if (released) return;
      released = true;
      activeLease?.release();
    },
  });
}

/**
 * Install intent-triggered, fetch-only OWLS preparation on annotated marketing links.
 *
 * Links remain ordinary links. Each link declares a public release-manifest URL with
 * `data-owls-manifest`; optional `data-owls-variant="fallback"` prepares Flutter's JS fallback
 * rather than its Wasm variant. Manifest requests are deduplicated by canonical URL, and a
 * failed request is evicted so a later intent can retry.
 */
export function installMarketingIntentLoader({
  coordinator,
  root = globalThis.document,
  selector = DEFAULT_SELECTOR,
  fetcher = globalThis.fetch,
  dwellMs = 150,
  exitGraceMs = 150,
  visibilityMs = 0,
  onOutcome = () => {},
  onError = () => {},
} = {}) {
  if (!coordinator || typeof coordinator.load !== 'function' || typeof coordinator.prepare !== 'function') {
    throw new TypeError('installMarketingIntentLoader requires an OWLS Coordinator');
  }
  if (!root || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('installMarketingIntentLoader requires a queryable root');
  }
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function');

  const elements = [...root.querySelectorAll(selector)];
  const manifests = new Map();
  const disposers = [];
  let disposed = false;

  const loadOnce = (url) => {
    let pending = manifests.get(url);
    if (!pending) {
      pending = coordinator.load(url, { fetcher }).catch((error) => {
        if (manifests.get(url) === pending) manifests.delete(url);
        throw error;
      });
      manifests.set(url, pending);
    }
    return pending;
  };

  for (const element of elements) {
    let manifestUrl;
    let variant;
    try {
      manifestUrl = canonicalManifestUrl(element, element.getAttribute('data-owls-manifest'));
      variant = variantFor(element);
    } catch (error) {
      safeCall(onError, Object.freeze({ element, manifestUrl: null, variant: null, error }));
      continue;
    }

    const metadata = Object.freeze({ element, manifestUrl, variant });
    const facade = Object.freeze({
      prepare() {
        return deferredLease(
          () => loadOnce(manifestUrl),
          (key, selectedVariant) => coordinator.prepare(key, undefined, { variant: selectedVariant }),
          metadata,
        );
      },
    });
    disposers.push(prepareOnIntent(element, facade, manifestUrl, {
      dwellMs,
      exitGraceMs,
      visibilityMs,
      doc: element.ownerDocument,
      onOutcome: (event) => safeCall(onOutcome, event),
      onError: (error) => safeCall(onError, Object.freeze({ ...metadata, error })),
    }));
  }

  return Object.freeze({
    count: disposers.length,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.splice(0)) dispose();
      manifests.clear();
    },
  });
}
