# Immutable marketing probe

`empty.wasm` is the smallest valid WebAssembly module (magic/version only). Marketing sites use
it to prove the shared coordinator's fetch-only preparation, integrity verification, cache
handoff and explicit activation path without starting a product runtime or moving private data.

The fixture is 8 bytes and has SHA-256
`93a44bbb96c751218e4c00d479010ce4c7e22d0fe8c71ac08fb6a39ccca33e24`.

Consumers must pin the exact repository commit in the asset URL. This probe is an operational
canary, not a claim that one cross-site download is universally reusable: browser caches are
partitioned by top-level site.
