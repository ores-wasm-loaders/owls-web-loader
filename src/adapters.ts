import type {Adapter, LoadContext} from "./coordinator.js";
import {LoaderError, releaseKey} from "./manifest.js";

export class RawWasmAdapter implements Adapter<WebAssembly.Instance> {
  private compiled?: Promise<WebAssembly.Module>;
  private owner?: string;
  constructor(readonly imports: WebAssembly.Imports = {}) {}
  async compile(context: LoadContext): Promise<WebAssembly.Module> {
    if (context.release.runtime !== "raw-wasm") throw new LoaderError("runtime", "Raw adapter requires raw-wasm");
    const key = releaseKey(context.release);
    if (this.owner && this.owner !== key) throw new LoaderError("release-conflict", "Use a new adapter per release");
    this.owner = key;
    if (!this.compiled) this.compiled = context.bytes(context.release.entrypoint)
      .then(bytes => WebAssembly.compile(bytes.slice().buffer))
      .catch(error => { this.compiled = undefined; throw error; });
    return this.compiled;
  }
  async activate(context: LoadContext) {
    const module = await this.compile(context);
    context.signal.throwIfAborted();
    return WebAssembly.instantiate(module, this.imports);
  }
}
export interface BindgenModule {
  default(options: {module_or_path: Uint8Array}): Promise<unknown>;
  [name: string]: unknown;
}
/** Supply the exact build's imported glue. Only generated glue knows its imports/start function. */
export class BindgenAdapter<T = BindgenModule> implements Adapter<T> {
  constructor(readonly wasmAssetId: string,
    readonly loadGlue: (context: LoadContext) => Promise<BindgenModule>,
    readonly start: (glue: BindgenModule, context: LoadContext) => Promise<T> = async glue => glue as unknown as T) {}
  async activate(context: LoadContext): Promise<T> {
    if (context.release.runtime !== "wasm-bindgen") throw new LoaderError("runtime", "Expected wasm-bindgen release");
    const asset = context.release.assets.find(a => a.id === this.wasmAssetId);
    if (asset?.kind !== "wasm") throw new LoaderError("asset", "Bindgen binary must be a declared WASM asset");
    const bytes = await context.bytes(this.wasmAssetId);
    context.signal.throwIfAborted();
    const glue = await this.loadGlue(context);
    context.signal.throwIfAborted();
    if (typeof glue?.default !== "function") throw new LoaderError("glue", "Generated glue does not export an init function");
    await glue.default({module_or_path: bytes});
    context.signal.throwIfAborted();
    return this.start(glue, context);
  }
}
/** Leptos islands: hydrate once per document; no assumptions about per-island bundles. */
export class LeptosAdapter extends BindgenAdapter<void> {
  constructor(wasmAssetId: string, loadGlue: (context: LoadContext) => Promise<BindgenModule>,
    hydrate: (glue: BindgenModule) => void | Promise<void>) {
    super(wasmAssetId, loadGlue, async (glue, context) => { context.signal.throwIfAborted(); await hydrate(glue); });
  }
}
/** Dioxus owns splitting/routing. The caller supplies its pinned build's launch hook. */
export class DioxusAdapter<T> extends BindgenAdapter<T> {}
