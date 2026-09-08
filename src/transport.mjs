// Moving bytes, and proving they are the bytes the release declared.
//
// Every fetch is credentialless, redirect-less and size-capped before a single byte is kept,
// and every response is checked against the declared kind, length and SHA-256 before any host
// sees it. A release names exactly what it is made of; anything else is not that release.

import { LoaderError } from './contract.mjs';
import { waitFor } from './ownership.mjs';

/** @typedef {(asset: object, signal: AbortSignal) => Promise<Uint8Array>} FetchAsset */

const JAVASCRIPT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
]);

const FONT_TYPES = new Set([
  'application/font-woff',
  'application/font-woff2',
  'application/vnd.ms-fontobject',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
]);

function mediaType(value) {
  if (typeof value !== 'string') return '';
  return value.split(';', 1)[0].trim().toLowerCase();
}

/**
 * Treat MIME as an independent response invariant. Integrity still proves identity; this check
 * prevents an origin error page or an incorrectly served executable from entering the byte store.
 */
export function responseContentTypeAllowed(asset, value) {
  const type = mediaType(value);
  switch (asset?.kind) {
    case 'wasm':
      return type === 'application/wasm';
    case 'module':
    case 'script':
      return JAVASCRIPT_TYPES.has(type);
    case 'font':
      return FONT_TYPES.has(type);
    case 'data':
      return type !== '' && type !== 'text/html' && type !== 'application/xhtml+xml';
    default:
      return false;
  }
}

function releaseReader(reader) {
  // A hostile/custom stream must not hold cancellation teardown open indefinitely. The pending
  // read observes the AbortSignal through waitFor; stream cancellation is best-effort cleanup.
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === 'function') void cancellation.catch(() => {});
  } catch {
    // Cleanup cannot replace the transport's original result.
  }
  try {
    reader.releaseLock();
  } catch {
    // A non-conforming stream may retain a pending read. It is no longer reachable by this host.
  }
}

/** An in-memory, LRU-evicting byte store. The default: it costs nothing and outlives nothing. */
export class MemoryStore {
  #values = new Map();
  #size = 0;

  constructor(maxBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new LoaderError('budget', 'Invalid cache budget');
    this.maxBytes = maxBytes;
  }

  async get(key) {
    const value = this.#values.get(key);
    if (value) {
      this.#values.delete(key);
      this.#values.set(key, value);
    }
    return value?.slice();
  }

  async delete(key) {
    const old = this.#values.get(key);
    if (old) this.#size -= old.length;
    this.#values.delete(key);
  }

  async put(key, bytes) {
    await this.delete(key);
    if (bytes.length > this.maxBytes) return;
    while (this.#size + bytes.length > this.maxBytes) await this.delete(this.#values.keys().next().value);
    this.#values.set(key, Uint8Array.from(bytes));
    this.#size += bytes.length;
  }
}

export async function verifyBytes(asset, bytes) {
  if (bytes.byteLength !== asset.bytes) throw new LoaderError('size', `Asset ${asset.id}: byte length mismatch`);
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== asset.sha256) throw new LoaderError('integrity', `Asset ${asset.id}: SHA-256 mismatch`);
}

/** The default transport. Streams, and stops the moment a response exceeds what it declared. */
export function httpTransport(fetcher = globalThis.fetch) {
  return async (asset, signal) => {
    signal?.throwIfAborted();
    const response = await waitFor(fetcher(asset.url, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      cache: 'default',
    }), signal);
    if (!response.ok || !response.body || response.type === 'opaque' || response.redirected) {
      throw new LoaderError('http', `Asset ${asset.id}: request failed (${response.status ?? 'no response'})`);
    }
    const contentType = response.headers?.get?.('content-type');
    if (!responseContentTypeAllowed(asset, contentType)) {
      throw new LoaderError('mime', `Asset ${asset.id}: response content type does not match ${asset.kind}`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await waitFor(reader.read(), signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw new LoaderError('http', `Asset ${asset.id}: response stream emitted a non-byte chunk`);
        }
        total += value.byteLength;
        if (total > asset.bytes) throw new LoaderError('size', `Asset ${asset.id}: exceeds its declared byte budget`);
        chunks.push(value);
      }
    } finally {
      releaseReader(reader);
    }
    signal?.throwIfAborted();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  };
}
