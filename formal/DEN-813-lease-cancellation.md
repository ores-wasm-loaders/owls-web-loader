# DEN-813 — shared preparation lease safety: bounded formal obligation and AttoLang candidate

Scope: src/coordinator.mjs: a shared preparation owner should be cancelled only after its final interested lease is released, without affecting remaining owners.

- `formal/atto_lease_cancellation_safety.smt2` encodes a restricted SMT-LIB2 relation. The first query must be **unsat**; the second must be **sat** after the named guard is deliberately removed.
- `examples/atto/lease_cancellation.atto` is a pure `.atto` candidate with positive and negative checks. It does **not** replace real integration code, auth policy, sandbox enforcement, browser operation or persistent receipts.
- `.github/workflows/DEN-813-lease-cancellation.yml` verifies the Z3 model on an exact GitHub head when runner steps actually execute; it checks only source presence for the Atto file.

This is not production-code model refinement, a compiler-backed AttoLang result, backend parity, liveness proof, or legal/security certification. Before promotion, execute a domain API adapter with generated valid/invalid traces and negative mutations, pin compiler/backend source and binary identities, run the exact Atto source on each claimed backend, and capture non-zero job steps, solver version and artifact digests. Zero-step CI is runner/admission failure.

Tracking: https://linear.app/denman/issue/DEN-813/cross-org-formal-methods-land-repository-local-verification-procedures
