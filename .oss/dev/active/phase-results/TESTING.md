# Testing: phase-results (R-257)

## Strategy
- Outside-in: acceptance tests at the hook/CLI boundary (`oss-notify.sh complete`, `oss-phase-result.sh`, the Stop dispatcher), then unit tests for the validator, assemblers and store.
- Hermetic: fixture repos in temp dirs, with fixture events.ndjson, cycle.json and decisions.ndjson. No network, no real API.
- Run only targeted files (`cd watcher && npx vitest run <files>`, `bash hooks/__tests__/<file>.sh`). Never the full watcher suite: its setup kills every OSS process on the machine.
- The test cases are listed in DESIGN.md under "TDD Test Plan".

## Results
### Acceptance (RED), 2026-11-13
`hooks/__tests__/phase-results.acceptance.test.sh`: 7 rows, **7 failing as expected** (bash 3.2):
1. complete with no result is refused: fails (today rc 0 and the chain fires).
2. assemble then complete passes: fails (`oss-phase-result.sh` missing, rc 127).
3. hand-written result gives unbound_result: fails (today accepted).
4. pre-R-257 feature start gives the D17 notice: fails (no notice).
5. start ship without a build result is refused: fails (today it starts).
6. ship empty diff gives empty_diff: fails (CLI missing).
7. Stop dispatcher blocks: fails (dispatcher missing).

Not committed while red (IRON LAW #1: no commit with failing tests). The test lands with the build commits that turn it green.

### T9, 2026-11-13
- RED: `watcher/test/cli/phase-result.acceptance.test.ts` 16/16 failing (no bundle), dist test failing (no options);
  `hooks/__tests__/oss-phase-result.test.sh` 4/6 failing (bad-phase and provenance rows are guards, passed on the stub).
- GREEN: vitest 12 files / 181 tests (phase-result acceptance 18, dist 1, test/phase-results/*, tool-gate and
  chain-trigger dist); oss-phase-result.test.sh 6/6 (bash 3.2 and 5); runner test 24/24; watcher-dist-fresh PASS.
- Fixed a flake in oss-phase-result-runner.test.sh: macOS scans a new executable on first exec, which ate the 1 s bound
  before the slow CLI recorded its child pid; the case now runs it through /bin/sh.
- System acceptance: 0/7 still (rows 2 and 6 fail only on `no_run_started`: notify start does not write `run/<phase>`
  until T10b; with the row written by hand, assemble plan + check plan pass and ship gives empty_diff).
- Bench (`node watcher/scripts/bench-phase-result.mjs`, 10k events, median of 5): assemble build 191 ms, check build 165 ms.

### T10-T17 and D19, 2026-11-13
- System acceptance `hooks/__tests__/phase-results.acceptance.test.sh`: **7/7 passing** (bash 3.2), committed with T10.
- Vitest targeted: 13 files / 224 tests green (phase-results, cli, stop, healthchecks/archive, provenance).
- Hook sweep green under bash 3.2, including session-start-copy, oss-archive-check, phase-result-step, runner, notify.
- watcher-dist-fresh PASS (125 files).
- Changed existing tests rest on AC-001.1 and AC-006.1; the list is in commit 178c68c's message.
- Flakes fixed at the root: runner bound (exec via /bin/sh); the 5k-file ship test gets a 60 s timeout (load, not logic).
- API (T17): 4 targeted files / 73 tests green; 921/921 across 19 targeted files; `manifest:verify` 138 prompts match.
  test/manifest.test.ts does not load here: @agentic/mcp-time is not built in this worktree (environment, pre-existing).

### /oss:integration, 2026-11-13
Each faked boundary compared with the real collaborator:

| Fake | Real | Result |
|------|------|--------|
| API `ship-check-fake.ts` (`check ship --all`) | plugin hook + CLI, run from plan.md's archive block in a fixture repo | **Mismatch fixed** (API f9a2a122): the real CLI prints `<f> missing` for a feature with no ship.json; the fake skipped it. No behavior impact, because only `ok` lines move a feature. |
| notify tests' phase-result CLI (`{"verification":"verified"}`, exit 0) | `check` success output in watcher/src/cli/phase-result.ts | Match. phase-results.acceptance runs the real path 7/7. |
| Assemblers, ledger, store | real git repos and files in temp dirs, with no mocks | Nothing to validate. |

Run against the real hook (fixture with a hand-written ship.json and a feature with no results):
- old plugin: `NOT ARCHIVED: auto-archive needs a newer OSS plugin`;
- real hook: `handwritten unbound_result` / `noresult missing`, rc 0;
- archive: nothing moved, `no phase result, move by hand: noresult`.

Refinement (code-simplifier, c9d2632): vitest 224/224, the hook sweep and watcher-dist-fresh are all green after it.

### D20, 2026-11-14
- RED: plan-archive-step had 8 failing (the notice and the fallback, in bash and zsh). GREEN: 25/25, and 4 targeted files 81/81.
- US-004 size base raised by user pick.
- Manifest verified: 138 prompts.
- Real-hook fixture:
  - old plugin: notice, then `ARCHIVED noresult` (PROGRESS says ship);
  - new plugin with the same prose and no result: `no phase result, move by hand: prose`, nothing moved.

## Last Updated: 2026-11-14 08:09 CST by /oss:build (D20)
