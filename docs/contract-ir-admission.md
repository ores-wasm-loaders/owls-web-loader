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
4. the `Release`, `Asset`, `PrepareBudget`, and `Activation` declarations are admitted;
5. the loader exports the exact contract functions and schema object from `owls-interfaces`, not
   local copies or wrappers;
6. all shared valid release fixtures parse through the loader's public contract path;
7. the complete loader test suite passes against that exact interface checkout.

The workflow writes and hashes a consumer receipt containing the loader commit, interface commit,
validator commit, Contract IR ID, parity receipt run ID, admitted-declaration count, and fixture
results. The evidence is retained as a GitHub Actions artifact for 30 days.

This gate certifies source and contract compatibility. It does not claim that a browser shares a
running runtime across documents, that a speculative response will remain cached, or that field
performance gates have passed. Those remain separate browser, deployment, and measurement
concerns.
