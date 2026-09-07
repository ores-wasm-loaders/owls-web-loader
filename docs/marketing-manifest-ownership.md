# Marketing manifest ownership

Tracking: https://github.com/ores-wasm-loaders/owls-web-loader/issues/1

Each meaningful link intent now owns a cancellable manifest waiter before it owns an asset preparation lease. Canonical manifest URLs share the existing `SharedFetches` primitive. Releasing one link must not cancel another interested link. Releasing the last waiter, hiding the document, or disposing the installation aborts the underlying manifest request. Disposal before the scheduled request starts must perform no I/O.

Successful manifests are retained for this installation only. Failed or abandoned requests are not cached. A custom coordinator that ignores abort cannot repopulate the cache with a late result or overwrite a replacement request. The public narrow TypeScript coordinator contract exposes the optional `AbortSignal` passed to `load`; custom implementations must propagate it to their transport to stop real network I/O. The built-in Coordinator already does so through `fetchManifest`.

Preparation remains fetch-only. This change does not execute applications, alter navigation, transfer running runtimes across documents, change release wire schemas, or expand origin/CSP permissions. A page restored after `pageshow` waits for new intent. Reentrant teardown while acquiring an asset lease releases that returned lease exactly once.

## Regression evidence

The new `test/marketing-cancellation.test.mjs` contains 18 cases for no initial request, shared and independent URLs, last-owner abort, idempotent disposal, pre-scheduling disposal, pagehide/pageshow, hidden documents, abort-ignoring late success/rejection, successful cache reuse, sync/async failures, focus, touch cancellation, reentrant acquisition, and rejecting instrumentation callbacks.

Local Node v22.16.0 replay against the real recovered producer/contract source: 142 loader tests and 16 contract tests passed, zero failures or skips. The relevant original marketing, intent and ownership module Git blob identities were verified against main `deae23537d27aed94bdc2510649f99393379a617`. Running the same 18 new tests against the unmodified baseline produced 13 failures and 5 passes; these are regression tests, not just post-change smoke checks.

Hosted exact-head checks and independent browser tests are still required before merge. This is lifecycle hardening, not a claim of completed production fleet rollout or cross-site cache reuse.
