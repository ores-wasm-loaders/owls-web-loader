# `.ores-wasm.toml`

`.ores-wasm.toml` is the repository-level declaration for how a repository consumes OWLS. It is intentionally separate from release manifests: a release manifest describes one immutable application release, while `.ores-wasm.toml` describes the host(s), preparation policy, activation policy, and environment wiring for a source repository.

## Authorities and validation

The semantic object produced from TOML is governed by two independent peer authorities in `ores-wasm-loaders/owls-interfaces`:

- `contracts/config.tsp`
- `schemas/ores-wasm-config.schema.json` (JSON Schema Draft 2020-12)

Neither is generated from the other. `ORESoftware/typespec-json-schema-validator` is pinned to an immutable commit in CI and must admit the pair before a consumer can treat the contract as usable. The generated schema and Contract IR are evidence, never a third editable authority.

The web loader parses only the small TOML surface needed by this contract. It has no third-party runtime dependency and rejects unsupported TOML features rather than guessing.

## Mixed client/server repositories

Named host tables let one repository contain several consumers without conflating them:

```toml
version = 1
enabled = true
strict = true

[hosts.browser]
kind = "browser"
root = "."
releaseManifest = "dist/client/release.json"
allowedOrigins = ["https://cdn.example.com"]

[hosts.browser.prepare]
trigger = "intent"
maxBytes = 8388608
maxConcurrency = 4
furthestStage = "compile"

[hosts.browser.activation]
policy = "route"

[hosts.server]
kind = "ssr"
root = "."
releaseManifest = "dist/server/release.json"

[hosts.server.prepare]
trigger = "explicit"
furthestStage = "fetch"

[hosts.server.activation]
policy = "disabled"
```

The same repository root may be used by more than one host. A monorepo can instead set different `root` values, for example `apps/web` and `apps/mobile`.

## `flags-2-env` interop

`.ores-wasm.toml` does **not** replace `.cli-flags.toml`. There must be one authority for CLI names, aliases, short flags, help text, and CLI defaults: `flags-2-env` keeps that authority.

The interop seam is the environment key. Declare where an env key lands in OWLS configuration:

```toml
[env.prepareMaxBytes]
env = "ORES_WASM_PREPARE_MAX_BYTES"
type = "integer"
target = "hosts.browser.prepare.maxBytes"

[env.assetOrigins]
env = "ORES_WASM_ALLOWED_ORIGINS"
type = "array"
target = "hosts.browser.allowedOrigins"
```

Then a CLI can independently expose flags that emit those same keys:

```toml
# .cli-flags.toml
[flags.wasm-prepare-max-bytes]
env = "ORES_WASM_PREPARE_MAX_BYTES"
aliases = ["wasm-prepare-max-bytes"]
type = "integer"
help = "Maximum browser OWLS preparation budget in bytes."

[flags.wasm-allowed-origins]
env = "ORES_WASM_ALLOWED_ORIGINS"
aliases = ["wasm-allowed-origins"]
type = "array"
help = "JSON array of canonical HTTPS asset origins."
```

A Node wrapper can use the structured `flags-2-env` API to obtain argv-derived environment overrides and pass the merged environment map to `resolveOresWasmToml(...)` or `loadOresWasmConfig(...)`. The browser loader does not import `flags-2-env`; keeping the bootstrap dependency-free is a repository invariant. The shared env names and coercion vocabulary (`string`, `integer`, `bool`, `double`, `json`, `array`, `map`) are the ABI between the two systems.

Do not put credential values, tokens, passwords, or signing keys in `.ores-wasm.toml`. The file may declare the *name* of an environment variable. Secret values remain in the process environment or the configured secret manager.

## Precedence

For a resolved config:

1. `.ores-wasm.toml` provides the checked-in base configuration.
2. Only env keys explicitly declared under `[env.<name>]` may override it.
3. The override is coerced according to the declared `type`.
4. The fully resolved object is validated again and frozen.

Arbitrary env-to-object mutation is rejected. Host env targets are restricted to known safe settings; `extensions.*` is the explicit escape hatch for application-specific metadata.

## JavaScript API

```js
import {
  loadOresWasmConfig,
  parseOresWasmToml,
  resolveOresWasmToml,
} from '@ores-wasm-loaders/owls-web-loader';

const checkedIn = parseOresWasmToml(sourceText);
const resolved = resolveOresWasmToml(sourceText, process.env);
const conventional = await loadOresWasmConfig(); // reads ./.ores-wasm.toml in Node
```

`loadOresWasmConfig` is Node-only. Browser callers fetch or embed the text themselves and call `parseOresWasmToml`; configuration parsing does not activate application code.

## Fail-closed rules

The v1 implementation rejects, among other things:

- unknown contract fields;
- duplicate TOML keys or table declarations;
- TOML arrays-of-tables and inline tables (use named tables instead);
- absolute or `..`-escaping repository paths;
- non-canonical or non-HTTPS asset origins;
- duplicate env keys;
- env declarations whose type does not match the target setting;
- env targets outside the safe host-setting allowlist (except explicit `extensions.*`);
- preparation budgets/stages when preparation is disabled;
- compile-stage preparation for Flutter hosts;
- malformed or missing required environment values.

Preparation remains separate from activation. Parsing or resolving `.ores-wasm.toml` performs no network requests, subscriptions, authentication, application execution, or writes.
