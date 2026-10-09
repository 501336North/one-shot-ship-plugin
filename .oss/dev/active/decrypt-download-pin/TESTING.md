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
