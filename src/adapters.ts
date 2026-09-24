import type {Adapter, LoadContext} from "./coordinator.js";
import type {Asset, Release} from "./types.js";
import {LoaderError, assetKey, releaseKey} from "./manifest.js";

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

function dependencyClosure(release: Release, root: string): Asset[] {
  const assets = new Map(release.assets.map(asset => [asset.id, asset]));
  if (!assets.has(root)) throw new LoaderError("manifest", `Unknown dependency root \`${root}\``);
  const visiting = new Set<string>(), visited = new Set<string>(), ordered: Asset[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new LoaderError("manifest", `Dependency cycle encountered at \`${id}\``);
    const asset = assets.get(id);
    if (!asset) throw new LoaderError("manifest", `Dependency references missing asset \`${id}\``);
    visiting.add(id);
    for (const dependency of asset.dependencies ?? []) visit(dependency);
    visiting.delete(id); visited.add(id); ordered.push(asset);
  };
  visit(root);
  return ordered;
}

type WasmRuntime = Pick<typeof WebAssembly, "compile" | "instantiate">;
export interface ComposedWasmOptions {
  readonly rootAssetId?: string;
  readonly imports?: WebAssembly.Imports;
  readonly namespaceFor?: (dependency: Asset, dependent: Asset, context: LoadContext) => string;
  readonly webAssembly?: WasmRuntime;
}
export interface ComposedWasmResult {
  readonly rootAssetId: string;
  readonly instance: WebAssembly.Instance;
  readonly instances: ReadonlyMap<string, WebAssembly.Instance>;
}

const compiledModules = new Map<string, Promise<WebAssembly.Module>>();
async function compileAsset(context: LoadContext, asset: Asset, wasm: WasmRuntime): Promise<WebAssembly.Module> {
  const key = assetKey(asset);
  let pending = compiledModules.get(key);
  if (!pending) {
    pending = context.bytes(asset.id).then(bytes => wasm.compile(bytes.slice().buffer)).catch(error => {
      compiledModules.delete(key); throw error;
    });
    compiledModules.set(key, pending);
  }
  return pending;
}

/** Standard-Wasm import/export composition for shared libraries plus page/user chunks. */
export class ComposedWasmAdapter implements Adapter<ComposedWasmResult> {
  private owner?: string;
  readonly rootAssetId?: string;
  readonly imports: WebAssembly.Imports;
  readonly namespaceFor: (dependency: Asset, dependent: Asset, context: LoadContext) => string;
  readonly webAssembly: WasmRuntime;

  constructor(options: ComposedWasmOptions = {}) {
    this.rootAssetId = options.rootAssetId;
    this.imports = options.imports ?? {};
    this.namespaceFor = options.namespaceFor ?? (dependency => dependency.id);
    this.webAssembly = options.webAssembly ?? WebAssembly;
  }

  async activate(context: LoadContext): Promise<ComposedWasmResult> {
    if (context.release.runtime !== "raw-wasm") throw new LoaderError("runtime", "Composed Wasm adapter requires raw-wasm");
    const key = releaseKey(context.release);
    if (this.owner && this.owner !== key) throw new LoaderError("release-conflict", "Use a new adapter per release");
    this.owner = key;
    const rootAssetId = this.rootAssetId ?? context.release.entrypoint;
    const closure = dependencyClosure(context.release, rootAssetId);
    const assets = new Map(context.release.assets.map(asset => [asset.id, asset]));
    const instances = new Map<string, WebAssembly.Instance>();

    for (const asset of closure) {
      context.signal.throwIfAborted();
      if (asset.kind !== "wasm") throw new LoaderError("asset", `Composed Wasm dependency \`${asset.id}\` must be wasm`);
      const imports: WebAssembly.Imports = {...this.imports};
      for (const dependencyId of asset.dependencies ?? []) {
        const dependency = assets.get(dependencyId), instance = instances.get(dependencyId);
        if (!dependency || !instance) throw new LoaderError("dependency", `Dependency \`${dependencyId}\` is unavailable`);
        const namespace = this.namespaceFor(dependency, asset, context);
        if (!namespace) throw new LoaderError("dependency", `Dependency \`${dependencyId}\` has no import namespace`);
        if (Object.prototype.hasOwnProperty.call(imports, namespace))
          throw new LoaderError("dependency", `Import namespace \`${namespace}\` collides with host imports`);
        imports[namespace] = instance.exports;
      }
      const module = await compileAsset(context, asset, this.webAssembly);
      const instance = await this.webAssembly.instantiate(module, imports);
      instances.set(asset.id, instance);
    }
    const instance = instances.get(rootAssetId);
    if (!instance) throw new LoaderError("dependency", `Root Wasm asset \`${rootAssetId}\` was not instantiated`);
    return Object.freeze({rootAssetId, instance, instances});
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
    if (context.release.runtime !== "wasm-bindgen") throw new LoaderError("runtime", "Expected a wasm-bindgen release");
    const asset = context.release.assets.find(a => a.id === this.wasmAssetId);
    if (asset?.kind !== "wasm") throw new LoaderError("asset", "Bindgen binary must be a declared WASM asset");
    const bytes = await context.bytes(this.wasmAssetId);
    context.signal.throwIfAborted();
    const glue = await this.loadGlue(context);
    context.signal.throwIfAborted();
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
