import {LoaderError} from "./manifest.js";
import type {Asset} from "./types.js";

export type FetchAsset = (asset: Asset, signal: AbortSignal) => Promise<Uint8Array>;
export interface ByteStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}
export class MemoryStore implements ByteStore {
  private readonly values = new Map<string, Uint8Array>();
  private size = 0;
  constructor(readonly maxBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new LoaderError("budget", "Invalid cache budget");
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (value) { this.values.delete(key); this.values.set(key, value); }
    return value?.slice();
  }
  async delete(key: string) { const old = this.values.get(key); if (old) this.size -= old.length; this.values.delete(key); }
  async put(key: string, bytes: Uint8Array) {
    await this.delete(key);
    if (bytes.length > this.maxBytes) return;
    while (this.size + bytes.length > this.maxBytes) await this.delete(this.values.keys().next().value!);
    this.values.set(key, bytes.slice()); this.size += bytes.length;
  }
}
export async function verifyBytes(asset: Asset, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== asset.bytes) throw new LoaderError("size", "Asset byte length mismatch");
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  if (hex !== asset.sha256) throw new LoaderError("integrity", "Asset SHA-256 mismatch");
}
export function httpTransport(fetcher: typeof fetch = globalThis.fetch): FetchAsset {
  return async (asset, signal) => {
    const response = await fetcher(asset.url, {
      signal, credentials: "omit", redirect: "error", mode: "cors",
      referrerPolicy: "no-referrer", cache: "default"
    });
    if (!response.ok || !response.body || response.type === "opaque")
      throw new LoaderError("http", "Asset request failed");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > asset.bytes) throw new LoaderError("size", "Asset exceeds declared byte budget");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    signal.throwIfAborted();
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  };
}

