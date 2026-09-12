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

## Repository-local Git worktrees

- Create or use a Git worktree only when the human operator explicitly authorizes it for the current task. Concurrency or a dirty checkout is not permission by itself.
- Put every authorized worktree at `<repository-root>/tmp/worktrees/<name>`; from the repository root, use `./tmp/worktrees/<name>`. Never place worktrees beside repositories or organization directories.
- Keep `tmp`, `temp`, `tmp/worktrees`, and `temp/worktrees` ignored in the repository-root `.gitignore`. Do not commit files from those directories.
- Relocate or remove a worktree only when the operator explicitly requests it. Before removal, preserve and publish intended changes, verify its commit is represented on the target branch, and confirm there are no tracked, untracked, ignored-sensitive, or in-use files that must survive. Remove it with `git worktree remove <path>` without `--force`; never delete a worktree directory with `rm`.
