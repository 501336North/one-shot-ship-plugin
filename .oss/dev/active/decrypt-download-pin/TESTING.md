# Testing: decrypt-download-pin

| Suite | Result 2026-10-09 |
|---|---|
| `__tests__/new-user-install.acceptance.test.sh` (A1 pinned fetch, A2 login via hook, A3 no latest/download) | 3/3 (RED 3/3 on main) |
| `hooks/__tests__/ensure-decrypt-cli.test.sh` | 16/16 (10 before; +2 tag pin, +4 committed manifest) |
| `watcher/test/hooks/session-start-hooks-copy.test.ts` | 3/3 (+1 manifest copied) |
| `__tests__/release-workflows.test.sh` | 1/1 |
| `hooks/__tests__/login-setup-gate.test.sh`, `version-check`, `check-updates` | 2/2, 4/4, 8/8 |
| All shell suites, branch vs origin/main | same 3 pre-existing failures on both (config-change-guard, format-hook, worktree-hooks); nothing new |

**Mutations (each must turn a test red):** remove committed-hash check → 2 red; remove plugin-root lookup → 1 red;
`-z` guard removal survived = equivalent mutant (empty never equals a 64-hex hash) → guard removed as redundant.
The plugin-root test passed vacuously before GREEN; the mutation proves it now guards the lookup.

**Clean machine (real GitHub, 2026-10-09):** temp HOME → real session start copies hook + manifest → hook downloads
from `releases/download/cli-decrypt-v1.2.3/`, in-release `.sha256` verified, committed hash verified; second run
does not download; tampered committed hash → refused, no binary left. (Found + fixed: mismatch message glued the hash.)

**Watcher vitest — NOT fully run.** Full `npx vitest run` exceeded 30 min and was stopped; `vitest run test/hooks` also hung (killed, no stray processes left). This branch changes no watcher source, only `test/hooks/session-start-hooks-copy.test.ts`, which passes 3/3 alone. Run the full watcher suite in CI / on the main checkout before merge.

## Integration (/oss:integration, 2026-10-09, branch head 7f628bf, real GitHub)
- Fresh HOME: session start copies hook+manifest → pinned download → in-release .sha256 + committed hash verified.
- Second run: no download. Existing installed binary byte-identical after the hook runs (existing customers untouched).
- Manifest missing from ~/.oss/hooks: plugin-root fallback verifies.

## Ship fix round 1 (2026-10-09)
| Suite | Result |
|---|---|
| ensure-decrypt-cli.test.sh | 23/23 (+atomic install ×2, curl hardening, tag validation, no login loop, beside-hook lookup, manifest completeness) |
| session-start-copy.test.sh (new, behavioural) | 4/4 |
| release-workflows.test.sh | 6/6 |
| new-user-install.acceptance | 3/3 (A2 now also requires the allowlisted invocation, no root-path fallback) |
| all shell suites | only the 3 pre-existing main failures |
Mutants killed: final-path download, delete-on-reject, missing EXIT trap, beside-hook lookup broken, manifest line deleted, tag bumped without manifest, chmod +x on data files.
Real GitHub clean machine after the round: pinned download with hardened curl → both hashes verified, binary 755, manifest 644, no temp leftovers.

## Integration after ship fix round 1 (2026-10-09, real GitHub)
- UPDATE path: v1.0.0 stub present → hook downloads pinned release, both hashes verified, atomically replaced (755), no temp leftovers.
- FAILED update (committed hash forced wrong): old binary byte-identical, actionable message, no leftovers.

## Ship fix round 2 (2026-10-09)
| Suite | Result |
|---|---|
| ensure-decrypt-cli.test.sh | 25/25 (+stale sweep, +checksum-interrupt; offline stubs in 2 legacy tests) |
| session-start-copy.test.sh | 7/7 |
| release-workflows.test.sh | 9/9 |
| command-decrypt-failure-text.test.sh (new) | pass (55 commands updated) |
| all shell suites | only the 3 pre-existing main failures |
Mutants killed: no sweep, sweep-all (would delete a concurrent install), checksum file outside trap, guidance removed. Two vacuous drafts caught and fixed before GREEN (TERM test passed on old code; TMPDIR ignored by macOS mktemp).

## Integration after round 2 (real GitHub)
- Fresh install with a stale SIGKILL leftover present: leftover swept, pinned download verified twice, bin dir holds only oss-decrypt; no checksum temp file left in the system temp dir.
