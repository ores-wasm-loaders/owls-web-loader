// owls-web-loader — the shared browser/worker/SSR half of the fleet's WASM loading layer.
//
// One coordinator, adapters per activation shape, and a strict split between preparing a
// release (fetch-only, bounded, cancellable, integrity-checked) and activating it (which owns
// the document). See README.md for what is and is not reusable across a navigation.
export { Coordinator, browserPolicy } from './src/coordinator.mjs';
export { httpTransport, MemoryStore, verifyBytes } from './src/transport.mjs';
export { CacheStorageStore } from './src/cache-storage.mjs';
export { RawWasmAdapter, BindgenAdapter, LeptosAdapter, DioxusAdapter } from './src/adapters.mjs';
export { FlutterAdapter, mountFlutterView, startupVariant } from './src/flutter.mjs';
export { hintDescriptors, addHints, prepareOnIntent, prepareWhenIdle, addPrerenderRule } from './src/hints.mjs';
export { createWebViewBridge } from './src/webview.mjs';
export { LoaderError, parseRelease, releaseSchema, preparableAssets, chunkForRoute, assetKey, releaseKey } from './src/contract.mjs';
