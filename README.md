# OWLS browser, worker and server loader

TypeScript coordination layer distributed as browser-ready ESM and declarations through zed-pkg.

```ts
import {Coordinator, browserPolicy, RawWasmAdapter, prepareOnIntent} from "@ores-wasm-loaders/owls-web-loader";
const loader = new Coordinator(browserPolicy(["https://assets.example"]));
const release = loader.register(manifest);
const key = release.appId + "@" + release.release;
const stopPreparation = prepareOnIntent(openButton, loader, key);
const adapter = new RawWasmAdapter(imports);
// On explicit activation:
const instance = await loader.activate(key, adapter);
```

Preparation never executes JS or WASM. It checks declared budgets before requests, limits streaming reads, verifies exact sizes and SHA-256 hashes, and deduplicates ordinary concurrent warmups. Explicitly cancelled preparation belongs to its caller. Failed warmup does not prevent demand loading.

Use one Coordinator and one adapter object per release in a retained document. RawWasmAdapter supports optional compilation without instantiation through compile(context). BindgenAdapter accepts the exact generated glue, binary asset ID and application start hook. LeptosAdapter accepts a pinned hydrate hook; DioxusAdapter leaves routing and splitting to Dioxus. Do not call __wbindgen_start yourself.

FlutterAdapter loads a generated bootstrap containing only flutter_js and flutter_build_config. It calls the supported loader lifecycle and starts multi-view mode; mountFlutterView returns an idempotent view-removal callback. Independent Flutter builds require separate documents. Supply getLoader: () => window._flutter?.loader. Do not pre-execute default Flutter bootstraps.

Policy, transport, ByteStore, reporting and adapter callbacks are replaceable. MemoryStore is bounded; CacheStorageStore is opt-in and scoped to an origin and namespace. Cache storage does not register a service worker or intercept the framework's requests. Browser hints are best effort; only explicit fetching enforces streamed body limits. Server helpers under the /server export produce resource Link headers without accessing the DOM.

Asset integrity covers bytes fetched by the coordinator. Generated glue loaded by an application import and its transitive imports remain the host's responsibility: use immutable build URLs, CSP and build-owned imports/import-map integrity. A checked fetch does not add integrity to a later dynamic import.

See [architecture and installation](https://github.com/ores-wasm-loaders/owls-docs). The public registry is currently unavailable; use the immutable preview registry snapshot with zed install --frozen. Run npm ci first, then zed install --adapter node so npm does not remove Zed's Node links. npm test rebuilds and runs contract tests.
