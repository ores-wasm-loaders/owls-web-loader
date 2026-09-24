// Activation adapters.
//
// Every Rust web build reaches the browser the same way: a generated wasm-bindgen glue module
// that knows how to instantiate exactly one companion `.wasm`, and exports the page then
// calls. What differs is only the last step, so that is the only thing Leptos and Dioxus
// override. What is NOT shared is the glue itself — it is generated for one module's imports
// and belongs to that release; this package wraps the lifecycle, it never substitutes one
// app's glue for another's.
import {
  LoaderError,
  assetKey,
  dependencyClosure,
  releaseKey,
  chunkForRoute,
  roleOf,
} from './contract.mjs';

// Compiled modules are immutable and content-addressed. Sharing the compile promise avoids
// recompiling a common vendor module when several OWLS applications activate in one document.
// Normal MPA navigation gets network reuse from the Coordinator's CacheStorageStore instead;
// a WebAssembly.Instance is intentionally never shared across documents.
const compiledModules = new Map();

async function compileAsset(context, asset, webAssembly) {
  const key = assetKey(asset);
  let pending = compiledModules.get(key);
  if (!pending) {
    pending = context.bytes(asset.id)
      .then((bytes) => webAssembly.compile(bytes.slice().buffer))
      .catch((error) => {
        compiledModules.delete(key);
        throw error;
      });
    compiledModules.set(key, pending);
  }
  return pending;
}

/** Raw WebAssembly: no glue, no framework, just a module and its imports. */
export class RawWasmAdapter {
  #compiled;
  #owner;

  constructor(imports = {}) {
    this.imports = imports;
  }

  async compile(context) {
    if (context.release.runtime !== 'raw-wasm') throw new LoaderError('runtime', 'Raw adapter requires a raw-wasm release');
    const key = releaseKey(context.release);
    if (this.#owner && this.#owner !== key) throw new LoaderError('release-conflict', 'Use a new adapter per release');
    this.#owner = key;
    if (!this.#compiled) {
      this.#compiled = context
        .bytes(context.release.entrypoint)
        .then((bytes) => WebAssembly.compile(bytes.slice().buffer))
        .catch((error) => {
          this.#compiled = undefined;
          throw error;
        });
    }
    return this.#compiled;
  }

  async activate(context) {
    const module = await this.compile(context);
    context.signal.throwIfAborted();
    return WebAssembly.instantiate(module, this.imports);
  }
}

/**
 * Browser-native multi-module WebAssembly composition.
 *
 * A release can model stable libraries as `role: "module"` assets and page/user code as
 * `role: "chunk"` assets whose `dependencies` name those libraries. Dependencies are compiled
 * and instantiated first. Each direct dependency's exports are injected into its dependent under
 * an import namespace equal to the dependency asset id by default.
 *
 * This is deliberately not an ELF/Emscripten dynamic linker. It uses standard Wasm imports and
 * exports, so producers must compile module boundaries with matching import namespaces/types.
 */
export class ComposedWasmAdapter {
  #owner;

  constructor({
    rootAssetId,
    imports = {},
    namespaceFor = (dependency) => dependency.id,
    webAssembly = globalThis.WebAssembly,
  } = {}) {
    if (!webAssembly || typeof webAssembly.compile !== 'function' || typeof webAssembly.instantiate !== 'function') {
      throw new LoaderError('runtime', 'WebAssembly compile/instantiate APIs are unavailable');
    }
    if (typeof namespaceFor !== 'function') throw new TypeError('namespaceFor must be a function');
    this.rootAssetId = rootAssetId;
    this.imports = imports;
    this.namespaceFor = namespaceFor;
    this.webAssembly = webAssembly;
  }

  async activate(context) {
    if (context.release.runtime !== 'raw-wasm') {
      throw new LoaderError('runtime', 'Composed Wasm adapter requires a raw-wasm release');
    }
    const key = releaseKey(context.release);
    if (this.#owner && this.#owner !== key) throw new LoaderError('release-conflict', 'Use a new adapter per release');
    this.#owner = key;

    const rootAssetId = this.rootAssetId ?? context.release.entrypoint;
    const closure = dependencyClosure(context.release, rootAssetId);
    const assets = new Map(context.release.assets.map((asset) => [asset.id, asset]));
    const instances = new Map();

    for (const asset of closure) {
      context.signal.throwIfAborted();
      if (asset.kind !== 'wasm') {
        throw new LoaderError('asset', `Composed Wasm dependency \`${asset.id}\` must be a wasm asset`);
      }

      const importObject = { ...this.imports };
      for (const dependencyId of asset.dependencies ?? []) {
        const dependency = assets.get(dependencyId);
        const instance = instances.get(dependencyId);
        if (!dependency || !instance) {
          throw new LoaderError('dependency', `Dependency \`${dependencyId}\` was not instantiated before \`${asset.id}\``);
        }
        const namespace = this.namespaceFor(dependency, asset, context);
        if (typeof namespace !== 'string' || namespace.length === 0) {
          throw new LoaderError('dependency', `Dependency \`${dependencyId}\` resolved to an invalid import namespace`);
        }
        if (Object.prototype.hasOwnProperty.call(importObject, namespace)) {
          throw new LoaderError('dependency', `Import namespace \`${namespace}\` collides with host imports while linking \`${asset.id}\``);
        }
        importObject[namespace] = instance.exports;
      }

      const module = await compileAsset(context, asset, this.webAssembly);
      context.signal.throwIfAborted();
      const instance = await this.webAssembly.instantiate(module, importObject);
      context.signal.throwIfAborted();
      instances.set(asset.id, instance);
    }

    const instance = instances.get(rootAssetId);
    if (!instance) throw new LoaderError('dependency', `Root Wasm asset \`${rootAssetId}\` was not instantiated`);
    return Object.freeze({
      rootAssetId,
      instance,
      instances,
    });
  }
}

/**
 * wasm-bindgen. Supply the exact build's generated glue: only it knows its own imports and
 * start function. The module asset is found by role when the release declares one, so a
 * release with route chunks does not have to name its entry module by convention.
 */
export class BindgenAdapter {
  constructor(wasmAssetId, loadGlue, start = async (glue) => glue) {
    this.wasmAssetId = wasmAssetId;
    this.loadGlue = loadGlue;
    this.start = start;
  }

  static moduleAssetId(release) {
    const byRole = release.assets.find((a) => roleOf(a, release) === 'module' && a.kind === 'wasm');
    if (!byRole) throw new LoaderError('asset', 'Release declares no wasm module beside its glue');
    return byRole.id;
  }

  async activate(context) {
    if (context.release.runtime !== 'wasm-bindgen') throw new LoaderError('runtime', 'Expected a wasm-bindgen release');
    const id = this.wasmAssetId ?? BindgenAdapter.moduleAssetId(context.release);
    const asset = context.release.assets.find((a) => a.id === id);
    if (asset?.kind !== 'wasm') throw new LoaderError('asset', 'Bindgen binary must be a declared WASM asset');
    const bytes = await context.bytes(id);
    context.signal.throwIfAborted();
    const glue = await this.loadGlue(context);
    context.signal.throwIfAborted();
    if (typeof glue?.default !== 'function') throw new LoaderError('glue', 'Glue module exports no init function');
    this.validateGlue?.(glue);
    await glue.default({ module_or_path: bytes });
    context.signal.throwIfAborted();
    return this.start(glue, context);
  }
}

/**
 * Leptos islands: the page is server-rendered and only the marked islands become interactive,
 * so activation hydrates islands once per document — not a whole-app mount. An island
 * boundary is not automatically its own bundle; only the emitted build graph decides that,
 * which is why the release declares the island list rather than the adapter inferring it.
 */
export class LeptosAdapter extends BindgenAdapter {
  constructor(wasmAssetId, loadGlue, hydrate) {
    const defaultHydration = hydrate === undefined;
    hydrate ??= (glue) => {
      if (typeof glue.hydrate_islands !== 'function') throw new LoaderError('hydrate', 'Leptos glue exports no hydrate_islands function');
      return glue.hydrate_islands();
    };
    super(wasmAssetId, loadGlue, async (glue, context) => {
      context.signal.throwIfAborted();
      if (context.release.activation && context.release.activation.mode !== 'hydrate-islands') {
        throw new LoaderError('activation', `Release declares \`${context.release.activation.mode}\`, not island hydration`);
      }
      await hydrate(glue);
      return Object.freeze({ mode: 'hydrate-islands', islands: context.release.activation?.islands ?? [] });
    });
    if (defaultHydration) this.validateGlue = (glue) => {
      if (typeof glue.hydrate_islands !== 'function') throw new LoaderError('hydrate', 'Leptos glue exports no hydrate_islands function');
    };
  }

  async activate(context) {
    if (context.release.activation && context.release.activation.mode !== 'hydrate-islands') {
      throw new LoaderError('activation', 'Leptos adapter requires island hydration');
    }
    return super.activate(context);
  }
}

/**
 * Dioxus owns its own splitting and routing. This adapter resolves the route to the chunk the
 * build graph declared and hands both to the pinned build's launch hook; it never re-implements
 * splitting on top of the framework's.
 */
export class DioxusAdapter extends BindgenAdapter {
  constructor(wasmAssetId, loadGlue, mount, route = () => globalThis.location?.pathname ?? '/') {
    super(wasmAssetId, loadGlue, async (glue, context) => {
      context.signal.throwIfAborted();
      const path = context.resolvedRoute;
      const chunk = chunkForRoute(context.release, path);
      if (context.release.activation?.mode === 'mount-route' && !chunk) {
        const declared = Object.keys(context.release.activation.routes ?? {}).join(', ') || 'none';
        throw new LoaderError('route', `Route ${path} maps to no chunk in this release (declared: ${declared})`);
      }
      await mount(glue, { route: path, chunk, context });
      return Object.freeze({ mode: 'mount-route', route: path, chunk });
    });
    this.route = route;
    if (typeof mount !== 'function') throw new LoaderError('activation', 'Dioxus adapter needs a mount hook');
  }

  async activate(context) {
    if (context.release.activation && context.release.activation.mode !== 'mount-route') {
      throw new LoaderError('activation', 'Dioxus adapter requires route mounting');
    }
    const path = typeof this.route === 'function' ? this.route() : this.route;
    if (context.release.activation?.mode === 'mount-route' && !chunkForRoute(context.release, path)) {
      throw new LoaderError('route', 'Route maps to no declared chunk');
    }
    return super.activate({ ...context, resolvedRoute: path });
  }
}
