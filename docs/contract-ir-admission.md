# Contract IR admission for the browser loader

`owls-web-loader` does not own or restate the release contract. It delegates parsing, schema
validation, release identity, asset ordering, and framework-specific activation invariants to the
exact `owls-interfaces` module selected by the host.

The contract has two independent authored authorities:

- TypeSpec source;
- JSON Schema Draft 2020-12 source (Schema A).

The TypeSpec compiler emits Schema B for comparison only. After direct declaration inventory,
structural/semantic comparison, and differential instance probes converge, the pinned validator
may emit a deterministic Contract IR. Schema B and Contract IR remain downstream evidence; they
cannot overwrite or outrank either authored source.

## Consumer gate

The `contract-ir-consumer` workflow checks out immutable commits for `owls-interfaces` and
`ORESoftware/typespec-json-schema-validator`, regenerates Schema B, the parity receipt, and
Contract IR, and then verifies all of the following:

1. the IR self digest, expected IR digest, and supplied IR ID are equal;
2. the current TypeSpec, generated Schema B, and authored Schema A digests still match the receipt;
3. no authority has precedence and the IR is not editable authority;
4. all 23 admitted declarations and their assertion digests are represented by the checked-in
   TypeScript, Rust, Dart, Go, and Gleam projections;
5. the deterministic language-projection receipt has an intact self digest and points to the same
   Contract IR and parity receipt;
6. every projection source digest still matches the immutable interface checkout;
7. the loader exports the exact contract functions and schema object from `owls-interfaces`, not
   local copies or wrappers;
8. all shared valid release fixtures parse through the loader's public contract path;
9. the complete loader test suite passes against that exact interface checkout.

The workflow writes and hashes a v2 consumer receipt containing the loader commit, interface
commit, validator commit, Contract IR ID, parity receipt run ID, language-projection receipt ID,
every projection source digest, admitted-declaration count, and fixture results. The evidence is
retained as a GitHub Actions artifact for 30 days.

The browser loader does not compile Rust, Dart, Go, or Gleam itself. Their exact compiler gates live
in `owls-interfaces`; this consumer gate independently reproduces and verifies the deterministic
projection receipt from the exact merged source. This prevents the loader from silently pinning a
contract whose language surfaces no longer match its admitted declaration set.

This gate certifies source and contract compatibility. It does not claim that a browser shares a
running runtime across documents, that a speculative response will remain cached, or that field
performance gates have passed. Those remain separate browser, deployment, and measurement
concerns.
