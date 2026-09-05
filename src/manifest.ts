import validate from "./generated-validate.js";
import type {Asset, Release} from "./types.js";

export class LoaderError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "LoaderError"; }
}
export function assertAssetUrl(raw: string, origins: readonly string[]): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
      u.href !== raw || !origins.includes(u.origin))
    throw new LoaderError("origin", "Asset URL must be canonical HTTPS on an allowed origin");
  return u;
}
/** Returns a detached immutable snapshot. Release IDs must never be reused. */
export function parseRelease(input: unknown, origins: readonly string[]): Release {
  if (!validate(input)) throw new LoaderError("manifest", "Release does not match release-v1 schema");
  const r = structuredClone(input) as Release;
  const ids = new Set<string>(), urls = new Set<string>();
  for (const a of r.assets) {
    assertAssetUrl(a.url, origins);
    if (ids.has(a.id) || urls.has(a.url)) throw new LoaderError("duplicate", "Duplicate asset identity");
    ids.add(a.id); urls.add(a.url); Object.freeze(a);
  }
  const e = r.assets.find(a => a.id === r.entrypoint);
  const expected = r.runtime === "raw-wasm" ? "wasm" : r.runtime === "wasm-bindgen" ? "module" : "script";
  if (!e || e.kind !== expected) throw new LoaderError("entrypoint", "Entrypoint kind does not match runtime");
  Object.freeze(r.assets);
  freezeJson(r.extensions);
  return Object.freeze(r);
}
export function assetKey(a: Asset): string { return a.url + "#" + a.sha256; }
export function releaseKey(r: Release): string { return r.appId + "@" + r.release; }
export function freezeJson(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
}
