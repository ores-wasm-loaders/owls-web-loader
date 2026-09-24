# Split WebAssembly for MPAs

OWLS does not require one monolithic `.wasm` per page. The release contract already models an immutable dependency DAG, so a producer may publish stable shared/library Wasm separately from page- or route-specific user code.

## Recommended browser-native shape

```text
vendor-core.wasm            # stable, cacheable shared library
       ^
       |
page-home.wasm              # small page/user chunk

vendor-core.wasm            # same URL + same SHA-256 on another page
       ^
       |
page-settings.wasm          # different small page/user chunk
```

Manifest assets use existing OWLS fields:

```json
{
  "schemaVersion": 2,
  "appId": "example",
  "release": "2026.09.23-home",
  "runtime": "raw-wasm",
  "entrypoint": "page-home",
  "assets": [
    {
      "id": "vendor-core",
      "url": "https://assets.example.com/wasm/vendor-core.7f.wasm",
      "kind": "wasm",
      "role": "module",
      "stage": "critical",
      "dependencies": [],
      "bytes": 800000,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "prepare": true
    },
    {
      "id": "page-home",
      "url": "https://assets.example.com/wasm/page-home.3c.wasm",
      "kind": "wasm",
      "role": "chunk",
      "stage": "critical",
      "dependencies": ["vendor-core"],
      "bytes": 90000,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "prepare": true
    }
  ]
}
```

A second MPA page can publish a different `page-settings` entrypoint while declaring the identical `vendor-core` asset identity. With `createSameOriginNavigationStore()`, the next document reuses the verified vendor bytes from Cache Storage instead of downloading them again. The new document still creates new Wasm instances; OWLS never pretends a live JavaScript/Wasm object survives navigation.

## Activation

Use `ComposedWasmAdapter` for standard WebAssembly import/export composition:

```js
import {
  ComposedWasmAdapter,
  Coordinator,
  browserPolicy,
  createSameOriginNavigationStore,
} from '@ores-wasm-loaders/owls-web-loader';

const coordinator = new Coordinator(
  browserPolicy(['https://assets.example.com']),
  { store: createSameOriginNavigationStore() },
);

const release = coordinator.register(manifest);
const result = await coordinator.activate(
  `${release.appId}@${release.release}`,
  new ComposedWasmAdapter({
    imports: {
      host: {
        log(value) { console.log(value); },
      },
    },
  }),
);

result.instance.exports.main();
```

For every asset in the dependency closure, OWLS compiles and instantiates dependencies first. By default a dependency is exposed to its direct dependent under an import namespace equal to the dependency asset id. Thus `page-home.wasm` above must import the library exports from module namespace `vendor-core`. `namespaceFor` can override that convention when a toolchain needs another stable namespace.

Host imports may not silently shadow a declared dependency namespace. A collision fails activation.

## Caching and compilation

OWLS uses immutable `URL + SHA-256` asset identity. The same shared-library bytes can therefore be reused by multiple releases/pages without coupling their user chunks. Within one document, compiled `WebAssembly.Module` promises are also deduplicated by immutable asset identity. Across normal MPA navigation the byte cache is reusable, while each document creates fresh instances.

This gives the desired network behavior:

```text
first visit /home
  GET vendor-core.7f.wasm
  GET page-home.3c.wasm

navigation /settings
  vendor-core.7f.wasm -> verified Cache Storage hit
  GET page-settings.91.wasm
```

## Relationship to Emscripten and wasm-split

`ComposedWasmAdapter` is intentionally a browser-native import/export composer, not an ELF-style dynamic linker. It works when producers compile explicit Wasm module boundaries whose imports/exports match the manifest dependency graph.

Emscripten `MAIN_MODULE` / `SIDE_MODULE` remains a valid producer strategy for C/C++ projects, but its loader/linker conventions are toolchain-specific. Such output should keep using its generated Emscripten loading path rather than pretending ordinary Wasm imports implement all Emscripten dynamic-link semantics.

Binaryen/`wasm-split` is complementary: it can split hot/cold code generated from one program. OWLS can transport/cache the resulting immutable artifacts, but activation must follow the producer's emitted linking/runtime contract.

## MPA guidance

Prefer stable shared boundaries with high reuse and relatively low change frequency: framework/runtime support, codecs, math/crypto kernels, parsers, rendering primitives, or other large libraries. Keep route/page-specific business logic in smaller chunks. Do not split merely to maximize file count: every Wasm module still has fetch/validation/compile/instantiate overhead and cross-module calls may carry ABI costs.
