// Moving bytes, and proving they are the bytes the release declared.
//
// Every fetch is credentialless, redirect-less and size-capped before a single byte is kept,
// and every response is checked against the declared length and SHA-256 before any host sees
// it. A release names exactly what it is made of; anything else is not that release.

import { LoaderError } from './contract.mjs';

/** @typedef {(asset: object, signal: AbortSignal) => Promise<Uint8Array>} FetchAsset */

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
    this.#values.set(key, bytes.slice());
    this.#size += bytes.length;
  }
}

export async function verifyBytes(asset, bytes) {
  if (bytes.byteLength !== asset.bytes) throw new LoaderError('size', `Asset ${asset.id}: byte length mismatch`);
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== asset.sha256) throw new LoaderError('integrity', `Asset ${asset.id}: SHA-256 mismatch`);
}

/** The default transport. Streams, and stops the moment a response exceeds what it declared. */
export function httpTransport(fetcher = globalThis.fetch) {
  return async (asset, signal) => {
    const response = await fetcher(asset.url, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      cache: 'default',
    });
    if (!response.ok || !response.body || response.type === 'opaque') {
      throw new LoaderError('http', `Asset ${asset.id}: request failed (${response.status ?? 'no response'})`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > asset.bytes) throw new LoaderError('size', `Asset ${asset.id}: exceeds its declared byte budget`);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  };
}
