# Integration acceptance and remaining rollout gates — 2026-09-06

## Ownership and history (WL-01)

The active browser loading package is this existing owls-web-loader repository;
release-contract peers live in owls-interfaces. Native Rust and Dart host work
remains in its existing owls-runtime.rs / owls-flutter repositories. Independent
consumer acceptance belongs to ores-wasm-loaders-test/owls-e2e. The owl-legacy
repositories were already archived when this continuation inspected GitHub;
this change creates no third loader and does not rename, delete or archive any
repository. Existing histories and licenses are preserved. PR #8 semantically
incorporates concurrent main af3b42ff, retaining marketing/package improvements,
all upstream intent/teardown tests, and both marketing and pilot APIs.

## Real engineering evidence

The independent test-org PR #3 now builds a genuine Leptos SSR island and its
matching Wasm exports, plus a real Flutter Wasm/JS-fallback multi-view app.
GitHub Actions run 34058173581 passed 24/24 browser/framework/cohort scenarios:
Chromium, Firefox and WebKit x Rust/Flutter x A/B/C/D. It consumes candidate npm
archives built from loader 00f8d5d9d17726722243dc6221c4a209d67a604a and interface
d036d73c35ced08f028c402407c667c339df79e6, not sibling-source overrides.

Flutter actually used Wasm in Chromium, JavaScript fallback in Firefox/WebKit;
all Rust scenarios used Wasm. The matrix verifies real button interactions,
no application execution during preparation, keyboard activation, normal-vs-
persistent document behavior, invalid manifest MIME rejection, runtime reuse,
and Flutter unmount/remount without restarting Dart main. This is desktop
browser lab evidence, not real iOS/Android hardware or cross-site production
cache qualification. The test host is HTML-first; it is not a claim that all
35 Astro marketing repositories have already adopted the integration.

Artifact 9996676013 SHA-256:
63c81b35c16e12dab043b9c411264978f99b69ee44b4a71dd2124972645ef1a7.
It contains browser results, actual manifests and traces. CI artifact retention
is 30 days; preserve release evidence through normal reviewed storage before
expiration. No secret or local TLS private key is part of the artifact.

The build caught and fixed incompatible independently resolved Leptos macros,
incorrect generated-manifest fields, Flutter's empty no-PWA service-worker
placeholder, and Rust build caches being accidentally packed into the browser
package. Interface PR #7 separately fixes the missing named JavaScript runtime
export and was merged only after runtime and compiled peer-parity gates passed.
The browser loader now uses that reviewed contract revision in Node/packaging CI.

## Reproducibility and package boundaries (WL-03/04/13/14, WT-01)

TypeSpec and JSON Schema remain independent authorities in owls-interfaces.
The existing compiler-backed parity gate is reused, not replaced with string
comparison or an invented third authority. Rust build-output manifests are
validated against the installed contract. Actual Rust/Flutter/Playwright locks
are committed in the test project, and this repository commits the manifest
builder's reviewed Cargo.lock. Package allowlists exclude build caches.

The zed-candidate workflow uses checksum-pinned Zed 0.3.0 to pack both packages,
round-trip through an isolated registry, perform a frozen copy installation,
and import the contract, coordinator and lifecycle exports from installed
artifacts. A private file-registry test is intentionally NOT described as a
remote production-registry publication. The old development .zpkg.lock's local
registry reference is not a portable fleet-distribution receipt.

## Gates that remain open — no production approval

- Remote versioned publication and clean installation from the agreed production
  Zed distribution path, with exact immutable release/lock receipts.
- Real Dioxus build/route-chunk validation beyond the existing adapter guards.
- Actual product ores-otel SDK/backend wiring and field LCP/INP/activation data;
  the injected telemetry writer and lab event array are not that integration.
- Representative physical mobile devices, production-equivalent cross-origin
  cache/CSP/authentication flows, and product-specific hosting/CTA validation.
- A preregistered field experiment with sufficient samples and independently
  verified rollback/security/device/package receipts before broader enrollment.

The test project's gates.mjs / ROLLOUT.md implement a conservative evidence
analysis and disable/rollback procedure. Insufficient samples, missing metrics,
missing receipts and lab-only observations HOLD. Even favorable inputs produce
only eligibility for human review; productionRolloutAuthorized remains false.
There are no fabricated field samples, no claimed 20% speedup, and no fleet
flag, auth boundary, DNS route or production deployment changed by this work.
