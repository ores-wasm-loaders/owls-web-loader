// Manifest downloads are untrusted too: origin, MIME, redirect, timeout and byte limits.
import { LoaderError } from './contract.mjs';
import { waitFor } from './ownership.mjs';

export async function fetchManifest(raw, origins, {
  signal, fetcher = globalThis.fetch, maxBytes = 256 * 1024, timeoutMs = 30_000,
} = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new LoaderError('origin', 'Invalid manifest URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.href !== raw || !origins.includes(url.origin)) {
    throw new LoaderError('origin', 'Manifest must use canonical HTTPS on an allowed origin');
  }
  if (![maxBytes, timeoutMs].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new LoaderError('budget', 'Invalid manifest fetch limits');
  }
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new LoaderError('timeout', 'Manifest fetch timed out')), timeoutMs);
  let reader;
  try {
    const response = await waitFor(fetcher(url.href, {
      signal: controller.signal, credentials: 'omit', redirect: 'error', mode: 'cors',
      referrerPolicy: 'no-referrer', cache: 'no-cache',
    }), controller.signal);
    if (!response.ok || !response.body || response.type === 'opaque' || response.redirected) {
      throw new LoaderError('http', 'Manifest request failed');
    }
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (type !== 'application/json' && type !== 'application/schema+json') {
      throw new LoaderError('mime', 'Manifest must have a JSON content type');
    }
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await waitFor(reader.read(), controller.signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new LoaderError('budget', 'Manifest response exceeds byte ceiling');
      chunks.push(value);
    }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new LoaderError('manifest', 'Manifest is not valid UTF-8 JSON'); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (reader) {
      // Do not await cancellation from a misbehaving stream indefinitely.
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
