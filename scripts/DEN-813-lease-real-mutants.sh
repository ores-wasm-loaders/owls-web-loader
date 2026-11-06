#!/usr/bin/env bash
# DEN-813 implementation mutation witnesses for actual Coordinator lease safety.
# All edits occur in a temporary copy; not an SMT-model or mocked function.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$root/owls-interfaces/index.mjs" ]] || {
  echo "Exact pinned same-org owls-interfaces checkout is required" >&2; exit 78;
}
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/case/test" "$root/evidence/DEN-813"
cp -R "$root/src" "$work/case/src"
cp "$root/index.mjs" "$root/package.json" "$work/case/"
cp "$root/test/lifecycle-hardening.test.mjs" "$root/test/atto-lease-refinement.test.mjs" "$work/case/test/"
# Shared contract checkout remains inside the same trusted job; no source
# leaves the originating organization and nothing is shipped via this symlink.
ln -s "$root/owls-interfaces" "$work/case/owls-interfaces"
baseline="$(sha256sum "$root/src/coordinator.mjs" | cut -d' ' -f1)"
printf 'head=%s\ntree=%s\noriginal_coordinator_sha256=%s\n' \
  "$(git -C "$root" rev-parse HEAD)" "$(git -C "$root" rev-parse HEAD^{tree})" \
  "$baseline" > "$root/evidence/DEN-813/mutation-provenance.txt"

kill_mutant() {
  local name="$1" old="$2" new="$3" test_file="$4" test_name="$5"
  local src="$work/case/src/coordinator.mjs"
  cp "$root/src/coordinator.mjs" "$src"
  local count
  count="$(grep -F -c "$old" "$src" || true)"
  [[ "$count" == 1 ]] || { echo "No unique guarded production expression for $name ($count)" >&2; return 1; }
  # Plain sed replacement treats '&' as the whole matched expression.
  # Use Node's literal string replacement so a valid source mutant stays
  # syntactically valid and only a named failing test can count as evidence.
  DEN813_OLD="$old" DEN813_NEW="$new" DEN813_SOURCE="$src" \
    node --input-type=module -e '
      import { readFileSync, writeFileSync } from "node:fs";
      const { DEN813_OLD, DEN813_NEW, DEN813_SOURCE } = process.env;
      const source = readFileSync(DEN813_SOURCE, "utf8");
      if (source.split(DEN813_OLD).length !== 2) process.exit(78);
      writeFileSync(DEN813_SOURCE, source.replace(DEN813_OLD, DEN813_NEW));
    '
  ! cmp -s "$src" "$root/src/coordinator.mjs" || { echo "$name left code identical" >&2; return 1; }
  local log="$root/evidence/DEN-813/$name.tap"
  if (cd "$work/case" && node --test \
       --test-name-pattern="$test_name" "$test_file") > "$log" 2>&1; then
    echo "Real lease test did not kill $name" >&2; return 1;
  fi
  # Require an actual identified failing test. Import/parse failures do not count.
  grep -Eq "^not ok [0-9]+ - $test_name$" "$log" || {
    echo "$name did not run the expected failing Node test" >&2; cat "$log" >&2; return 1;
  }
  grep -Eq '^# fail [1-9]' "$log" || return 1
  printf '%s_sha256=%s\n' "$name" "$(sha256sum "$src" | cut -d' ' -f1)" \
    >> "$root/evidence/DEN-813/mutation-provenance.txt"
  echo "PASS: real Coordinator test killed source mutation $name"
}

kill_mutant cancelled_while_another_owner_exists \
  'job.leases.size === 0' 'job.leases.size >= 0' \
  'test/lifecycle-hardening.test.mjs' \
  'preparation leases share one job and one release cannot cancel another'
kill_mutant disabled_shared_job_reuse \
  'pending && !pending.controller.signal.aborted' \
  'pending && pending.controller.signal.aborted' \
  'test/atto-lease-refinement.test.mjs' \
  'three concurrent leases emit exactly one preparation-start event'

test "$baseline" = "$(sha256sum "$root/src/coordinator.mjs" | cut -d' ' -f1)"
printf '%s\n' 'MUTATION_CLASS=PRODUCTION_NODE_MODULE' \
  'ATTO_GUEST_EXECUTION=NOT_EXECUTED' >> "$root/evidence/DEN-813/mutation-provenance.txt"
