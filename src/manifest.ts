import validate from "./generated-validate.js";
import type {Asset, Release} from "./types.js";

export class LoaderError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "LoaderError"; }
}
export function assertOrigin(raw: string): string {
  let u: URL;
  try { u = new URL(raw); }
  catch { throw new LoaderError("origin", "Allowed origin is not a parseable URL"); }
  if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" ||
      u.search || u.hash || u.href !== `${u.origin}/` || raw !== u.origin)
    throw new LoaderError("origin", "Allowed origins must be canonical HTTPS origins");
  return u.origin;
}
export function assertAssetUrl(raw: string, origins: readonly string[]): URL {
  // A URL that satisfies the schema pattern can still be unparseable; report it as a
  // declared LoaderError rather than leaking the parser's TypeError to the caller.
  let u: URL;
  try { u = new URL(raw); }
  catch { throw new LoaderError("origin", "Asset URL is not a parseable absolute URL"); }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
      u.href !== raw || !origins.includes(u.origin))
    throw new LoaderError("origin", "Asset URL must be canonical HTTPS on an allowed origin");
  return u;
}
/** Returns a detached immutable snapshot. Release IDs must never be reused. */
export function parseRelease(input: unknown, origins: readonly string[]): Release {
  if (!validate(input)) throw new LoaderError("manifest", "Release does not match release-v1 schema");
  const allowedOrigins = origins.map(assertOrigin);
  const r = structuredClone(input) as Release;
  const ids = new Set<string>(), urls = new Set<string>();
  for (const a of r.assets) {
    assertAssetUrl(a.url, allowedOrigins);
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
/** Canonical identity prevents object-property order from creating a false release conflict. */
export function releaseIdentity(r: Release): string { return canonicalJson(r); }
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function freezeJson(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
}
