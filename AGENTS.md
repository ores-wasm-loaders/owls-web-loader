# owls-web-loader — agent notes

- Preparation and activation are different operations and must stay that way: preparation
  never executes application code, authenticates, subscribes, or writes. There is a test that
  enforces this by scanning the source; do not weaken it.
- No third-party runtime dependencies and no build step in this org. The loading layer is the
  first thing a page runs.
- The release contract lives in `owls-interfaces` and is declared twice — JSON Schema and
  TypeSpec as independent peers. Change both, or the parity test fails.
- A release id is immutable. A host that sees one id describing different assets refuses it
  rather than reconciling; an old bootstrap meeting a new module is not debuggable.
- Never React/JSX, never a webview. Favor pure functions, explicit inputs and outputs,
  immutability, typed errors, and effects pushed to the edges.
- Resolve git conflicts semantically (reconcile both sides, never just pick one); never
  rebase, stash, or reset. `main` is production, `dev` is integration.
