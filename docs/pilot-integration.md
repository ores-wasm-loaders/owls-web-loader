# Pilot lifecycle integration (WL-05–WL-15, WT-05–WT-06)

This extends the existing owls coordinator. It is not a third loader or a claim
that Flutter, Leptos, Dioxus, package publication, or production performance has
been certified. One coordinator and one ActivationHost belong to one document.
Normal navigation does not carry their running runtime into another document.

## Install and release identity

Keep the generated framework glue and Wasm paired with the exact release used by
server-rendered HTML. Register the release, then use `releaseKey(release)` as the
coordinator key. `Coordinator.load` accepts only allowlisted canonical HTTPS
manifest URLs without credentials, queries or fragments; responses must be JSON,
fit its byte limit, and complete within its deadline. Inline trusted release data
can still be registered without making a manifest request.

The current `.zpkg.lock` points to a local file registry. CI source checkouts and
local tests do **not** prove clean published-package installation. That remains a
separate WL-14/WT-01 gate. Do not manufacture a replacement lock or claim a
release was published by opening this PR.

## HTML-first entry and speculation switches

```js
import {
  Coordinator, ActivationHost, pilotPolicy, connectApplicationLink,
  createLoaderReporter, releaseKey,
} from '@ores-wasm-loaders/owls-web-loader';

// writePublicLoaderEvent is the product's ores-otel integration: no credentials,
// full URLs, private account data, or raw error messages belong in its events.
const report = createLoaderReporter({
  write: writePublicLoaderEvent,
  labels: { cohort: 'B', framework: 'leptos', runtimeMode: 'wasm' },
});
const coordinator = new Coordinator(pilotPolicy([assetOrigin]), { report });
const release = coordinator.register(releaseEmbeddedByServer);
const key = releaseKey(release);
const host = new ActivationHost(coordinator, { report });

// B: normal navigation with bounded preparation. A: change prepare to false.
const dispose = connectApplicationLink(openAppAnchor, coordinator, key, {
  prepare: true,
});
```

The proposed pilot policy is 1 MiB per candidate, one speculative application,
and two concurrent asset requests. It is not a measured optimal configuration.
Hover/focus dwell defaults to 150 ms; the link wrapper does not speculate on
initial load, touch, or pointerdown. A normal href remains usable; modified,
download, external-origin and new-tab clicks keep native navigation behavior.
Call the disposer on shell teardown. It removes listeners and releases only its
preparation interest, not another consumer's ownership.

Direct low-level `prepare(key, signal, {variant})` returns a lease with
`done`/`promise` and `release()`. Existing `prefetch` remains a promise-returning
convenience API. Do not confuse its receipt with useful interaction or durable
cross-page cache residency. Variant selection is caller/build-specific: Flutter's
actual runtime choice still belongs to its supported loader. The existing
`startupVariant` helper is not proof that a particular browser ran WasmGC.

## Persistent-shell mounting

For C/D, supply `start` to the link integration. `start` must acquire runtime
ownership synchronously before returning its promise; `ActivationHost.activate`
does this. Turn `prepare` off for C and on for D.

```js
const dispose = connectApplicationLink(openAppAnchor, coordinator, key, {
  prepare: true,
  start: ({ signal }) => host.activate(key, adapter, {
    kind: 'document', document,
  }, {
    signal,
    // Supply a real product assertion (input accepts a filter and results update).
    // Do not resolve merely because an entrypoint was imported.
    ready: assertSearchIsUsable,
  }),
});
```

`hydrate-islands` accepts a document target. `attach-view` accepts a connected
`flutter-view` element. Other modes accept an element `root`. Element targets
require `attach(runtime, element)` returning a cleanup function; readiness is
always an explicit `ready(runtime, target)` hook. The returned handle exposes
`interactive` and `unmount()`. Runtime readiness is a different event from
application-defined useful interaction.

Leptos hydration requires real matching server-rendered markup and the exact
build's export. Missing default `hydrate_islands` exports and mismatched modes
now reject rather than reporting success. Dioxus routes are checked against the
emitted manifest before evaluating application glue; no new splitter is added.
Actual SDK/build/browser conformance remains required for both adapters.

A caller's cancellation stops its wait/mount; it does not rewind imported code
or cancel another consumer's running engine. Shared asset requests abort only
when no consumers remain. Removing a view is not engine destruction. A document
hydration cannot be safely undone by a generic cleanup hook; replace the document.
Failed partial mounts without cleanup and failed runtime initialization retain
ownership conservatively, requiring a supported cleanup or full-page recovery.

## Flutter bootstrap and views — explicit integration change

`FlutterAdapter` now requires `bootstrapMode: 'loader-only'`. Supply a custom
build-generated bootstrap containing `{{flutter_js}}` and
`{{flutter_build_config}}`, **without an automatic `_flutter.loader.load()`**.
The adapter owns that call. Executing Flutter's default auto-start bootstrap and
then calling load again is not a safe preparation or initialization mechanism.
Preserve the build's metadata and serve the exact bootstrap whose digest appears
in the manifest. The adapter sets script SRI; hashing a separate fetch alone is
not proof of the subsequently executed script's integrity.

```js
const adapter = new FlutterAdapter({
  document,
  bootstrapMode: 'loader-only',
  getLoader: () => globalThis._flutter?.loader,
  loadConfig: { assetBase: appAssetBase },
  engineConfig: {},
});
const result = await host.activate(key, adapter, {
  kind: 'flutter-view', element: flutterContainer,
}, {
  attach: (app, element) => mountFlutterView(app, element, initialViewData),
  ready: assertFlutterPrimaryControlIsUsable,
});
await result.interactive;
```

The container must be connected and have positive width/height. Use one adapter
instance/configuration per Flutter document; simultaneous compatible activations
share its startup promise, while another adapter/release is rejected. The custom
entrypoint callback merges `loadConfig` into `initializeEngine` and applies
explicit engine overrides, then the manifest's multi-view setting. Pin and test
the Flutter SDK and Dart multi-view entrypoint separately; modeled Node tests
are not real Flutter certification.

## Tests and evidence

Run `node --test --test-reporter=tap test/*.test.mjs` with the explicitly pinned
owls-interfaces source discoverable beside the package. CI records both source
commits and Node version, runs the same suite, and retains TAP plus an explicit
public-source archive. Checkout credentials and .git/environment files are not
included. Artifacts expire after seven days; retain reviewed release evidence
through the product's normal evidence store before relying on long-term links.

The suite distinguishes existing regressions from added ownership, manifest,
framework-hook, intent, Buffer-integrity and telemetry tests. Mocks assert
boundary behavior only. Real mobile/browser networking, actual SDK hydration,
external zed package resolution, statistical performance thresholds and 35-org
rollout approval remain separate unchecked gates. No production flag is enabled
by this implementation.
