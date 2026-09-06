# Real build-output manifests (WL-04)

This Rust build tool inventories approved public build assets, hashes their actual bytes,
rejects symlinks/hidden paths/noncanonical origins, and emits release-v2 JSON. It is not
another loader and does not change either release-schema authority. The consuming job
must validate its output through the pinned owls-interfaces package before serving it.

There are no CLI flags. Send one UTF-8 JSON object (at most 64 KiB) on stdin with root,
base_url, app_id, release, runtime, entrypoint, islands and toolchain. The base URL must
contain the exact immutable release as a path segment. runtime is wasm-bindgen or
flutter-web. A wasm-bindgen islands build must declare its actual exported island names.
Wasm companions must physically exist. Recipe/manifest validation failures are fatal.

Only static output with approved extensions is published. Unknown extensions are omitted;
source maps, keys and hidden files are never included. Build input is trusted CI output,
not a live mutable directory supplied by an untrusted web client. Metadata under config
records content types and toolchains using the existing extensible release contract.
Bootstrap/glue and application Wasm are optional preparation candidates, not an assertion
that they fit a 1 MiB policy. Flutter renderer/fallback fetching remains SDK-owned.

Generate Cargo.lock with the pinned CI toolchain, then use --locked. A missing lock must
be recorded as bootstrap state, not claimed as reproducible frozen installation. The
pilot CI retains the generated lock for review and commit before release qualification.
