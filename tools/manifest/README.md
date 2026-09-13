# Real build-output manifests (WL-04)

This Rust build tool inventories approved public build assets, hashes their actual bytes,
rejects symlinks/hidden paths/noncanonical origins, and emits release-v2 JSON. It is not
another loader and does not change either release-schema authority. The consuming job
must validate its output through the pinned owls-interfaces package before serving it.

There are no CLI flags. Send one UTF-8 JSON object (at most 64 KiB) on stdin with `root`,
`base_url`, `app_id`, `release`, `runtime`, `entrypoint`, optional `framework`, framework
activation metadata, and `toolchain`. The base URL must contain the exact immutable release
as a path segment. Runtime is `wasm-bindgen` or `flutter-web`.

For backward compatibility a `wasm-bindgen` recipe with no `framework` remains a Leptos
islands recipe. Leptos must declare its actual exported `islands` and no route/dependency
map. Flutter may omit `framework` or declare `flutter` and must not declare Rust activation
metadata.

Dioxus must declare `framework: "dioxus"` and a non-empty `routes` object whose keys are
canonical route paths and whose values are relative paths to actual emitted split `.wasm`
files beneath `root`. A Dioxus producer may also provide a `dependencies` object mapping
an emitted split-Wasm path to the emitted split-Wasm paths it depends on. These are build
paths, not public asset IDs. The manifest tool validates their files, bounds each dependency
list to 64 entries, rejects duplicates/self-edges/missing files/cycles/disconnected roots,
and then translates every participating path into a deterministic immutable asset ID.

Every route-owned module and shared dependency is emitted as `role: "chunk"`, `kind:
"wasm"`, `stage: "lazy"`, `prepare: false`. The route-owned asset receives its dependency
asset IDs in `dependencies`; the manifest route map also contains asset IDs rather than
mutable filesystem paths. Missing, unsafe, non-Wasm, cyclic, or unrelated split outputs are
rejected rather than guessed.

Example Dioxus recipe shape:

```json
{
  "root": "dist/public",
  "base_url": "https://app.example/releases/r1/",
  "app_id": "example-web",
  "release": "r1",
  "runtime": "wasm-bindgen",
  "framework": "dioxus",
  "entrypoint": "app.js",
  "routes": {
    "/child": "split/module_0_routeChildSplit_a1b2c3.wasm"
  },
  "dependencies": {
    "split/module_0_routeChildSplit_a1b2c3.wasm": [
      "split/chunk_0_split.wasm"
    ]
  },
  "toolchain": {
    "dioxus": "0.7.9"
  }
}
```

The producer supplying `routes` and `dependencies` must derive them from the exact framework
build evidence. For Dioxus 0.7.x, the external acceptance lane parses the generated
`__wasm_split.js`: route-owned `module_*` URLs identify split modules and their referenced
`__wasm_split_load_chunk_*` loader symbols identify shared `chunk_*` prerequisites. Do not
infer dependency edges from filename order, file size, or a source-level guess.

Wasm companions must physically exist. Recipe/manifest validation failures are fatal. The
route/dependency metadata is build evidence only; Dioxus remains responsible for its actual
split runtime and routing semantics. OWLS never rewrites framework output or substitutes one
application's wasm-bindgen glue for another's.

Only static output with approved extensions is inventoried. Unknown extensions are
omitted; source maps, keys and hidden files are never included. Build input is trusted
CI output, not a live mutable directory supplied by an untrusted web client. Metadata
under the existing `extensions` field records content types and toolchains. The output
includes both required preparation-budget limits; the authorities are not weakened to
accept an ad-hoc config field. Asset count, nonzero size and per-asset byte limits are
checked before admitting the build. Zero-byte disabled service-worker placeholders
must be removed by an explicit no-PWA staging step, not admitted as executable assets.

Bootstrap/glue and application Wasm are optional ambient preparation candidates, not an
assertion that they fit a 1 MiB policy. Dioxus split assets are lazy/non-prepared by default
so manifest generation never turns route splitting into eager fleet-wide downloads. A later
explicit route-intent operation may fetch the admitted dependency closure, subject to the
same page/release byte ceilings, without executing application code. Flutter renderer/fallback
fetching remains SDK-owned.

The release contract remains declared independently in human-authored TypeSpec and
human-authored JSON Schema. Consumers run `ORESoftware/typespec-json-schema-validator`
against pinned authority revisions; generated Schema B, parity receipts, Contract IR,
and language projections are comparison/admission evidence only and never overwrite either
source authority.

Telemetry: the tool logs through `oresoftware-next-loggers` (`src/telemetry.rs`, a build-tool
dependency only; the browser loading layer stays dependency-free). stdout remains the manifest
JSON. One `next-loggers/v1` JSON line is written to stderr per run: info when a manifest is
built, error when it is rejected. Records carry the outcome with an inline `ores-trace-…`
literal and the `ores-routine-…` ID declared at the top of `main`. Recipe contents, build
paths, origins and rejection messages are never logged; the human-readable rejection line is
unchanged.

The real build's reviewed Cargo.lock is committed. Run:

    cargo +1.94.0 test --locked --manifest-path tools/manifest/Cargo.toml
    cargo +1.94.0 build --locked --release --manifest-path tools/manifest/Cargo.toml

The admitted lock's SHA-256 is
1b39d93f4b497eb2a092e921703a63a3c31bd29fb277b89be9b51de3cbff37c0.
It was produced by Cargo when DEN-666 added the `oresoftware-next-loggers` git dependency.
The change is additive: new package entries for that crate and its `time` dependency graph,
plus the new crate added to the root package's dependency list. Every previously admitted
package entry is otherwise unchanged. The previously admitted SHA-256 was
93c4f7399cee30fb9e88080c516d47c94b1965818d9bd0a1a71ebabfc5029996, generated by Cargo and
reproduced against the reviewed successful CI build. No dependency lock contents were
fabricated. Regenerate only as an explicit reviewed change and re-run the independent
real-framework/manifest admission tests.
