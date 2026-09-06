# owls-web-loader

Shared browser, worker and SSR loading for the fleet's WASM applications: bounded verified
preparation, framework adapters, and a strict split between preparing a release and
activating it.

## Two verbs, plus preparation leases

```js
await coordinator.prefetch(key);          // fetch-only convenience API
await coordinator.activate(key, adapter); // start or reuse the app in THIS document

const preparation = coordinator.prepare(key); // shared/reference-counted preparation
await preparation.promise;
preparation.release();
```

`prefetch` and `prepare` never execute application code, authenticate, subscribe or write, and
failure is a non-event — `activate` is tested from cold on every commit. A test in this package
scans its own source and fails the build if any preparation path so much as mentions
`import(`, `eval`, `new Function`, `createElement('script')` or `WebAssembly.instantiate`.

Concurrent preparation callers for the same release and startup variant share one job. Each
caller owns a lease; releasing one lease cannot cancel another caller. Pagehide and explicit
policy cancellation abort the real underlying request rather than merely deleting bookkeeping.
A caller with its own `AbortSignal` receives a prompt cancelled outcome while other interested
callers may continue the shared work.

Preparation takes what fits, in the order `owls-interfaces` declares, and returns a receipt
saying what it prepared and what it skipped and why. Over-budget truncates rather than
refusing the whole release: rejecting a release for being slightly over budget prepares
*nothing*, which is the opposite of the point. Two ceilings apply and the stricter wins — the
page's `policy`, and the publisher's `prepareBudget`.

Activation may join useful in-flight speculative work for `activationJoinMs` (50 ms by default).
After that bounded handoff it cancels the unneeded speculative owner and starts the foreground
activation path. A slow speculative request therefore cannot delay a click until the
preparation timeout.

## Intent preparation

`prepareOnIntent` defaults to a 150 ms hover/focus dwell and a 150 ms exit grace. Pointer-down
and touch intent start immediately. Focus keeps preparation alive when the pointer leaves, and
`pagehide` or a hidden document releases the lease. Viewport-only preparation is opt-in with a
positive `visibilityMs`; it is disabled by default so ordinary marketing-page visitors do not
pay for an application they may never open.

## Browser and CDN loading

The contract remains owned by `owls-interfaces`; the browser loader does not carry a second
copy. Deploy both packages as sibling directories, or configure the immutable interface module
URL before dynamically importing the loader:

```html
<script type="module">
  globalThis.__OWLS_INTERFACES_URL__ =
    '/vendor/ores-wasm-loaders/owls-interfaces/index.mjs';
  const { Coordinator, browserPolicy } = await import(
    '/vendor/ores-wasm-loaders/owls-web-loader/index.mjs'
  );
</script>
```

The override must be set before the first loader import in that document. It is bootstrap
configuration, not a runtime switch: one document should use one immutable interface release.
When no override is supplied, browser deployments try the conventional sibling layout. Node
continues to discover zed/source-tree installations, but the module has no static `node:`
imports, so native browser module loading does not fail during parsing.

## What is not reusable

A running application is **not** carried across a navigation. A new document gets a new realm;
an evaluated module and its initialized objects do not transfer. What may carry over is
downloaded responses — in an eligible, *site-partitioned* cache — and, at the browser's
discretion, compiled code. Where a live runtime genuinely matters the answer is a persistent
shell (for Flutter, one engine with embedded multi-view), not a claim that navigation hands a
runtime along. `addPrerenderRule` is the honest alternative: it prepares the destination's own
document.

## Integrity

Every asset is fetched credentialless, redirect-less and size-capped, then checked against the
length and SHA-256 the release declared — from cache as well as from the network. The Flutter
bootstrap is inserted with an SRI hash derived from that same digest, so the browser refuses to
execute anything the release did not describe.

## Adapters

| Adapter | Activation |
| --- | --- |
| `RawWasmAdapter` | compile + instantiate the entry module with supplied imports |
| `BindgenAdapter` | run the release's own generated glue against its companion module |
| `LeptosAdapter` | hydrate the declared islands, once per document |
| `DioxusAdapter` | mount the chunk the build graph declared for this route |
| `FlutterAdapter` | the supported `_flutter.loader` lifecycle, one engine per document, multi-view |

The generated glue is part of a release and is never swapped between apps: this package wraps
the lifecycle, it does not replace the glue.

## No runtime build step

The published source is the source: ESM, no bundler, no runtime dependencies, nothing generated
at install time. The loading layer is the first thing a page runs and must not drag a toolchain
in front of itself — which is also why schema validation here is hand-written rather than
generated by a build-time validator compiler.

```sh
node --test test/*.test.mjs
```
