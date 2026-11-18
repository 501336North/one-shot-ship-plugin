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

### D20 narrowed, 2026-11-14
- RED: 5 failing (the prose, plus the installed-hook-exits-127 and dangling-symlink cases in bash and zsh). GREEN: plan-archive-step 27/27; 4 targeted files 83/83; manifest 138 verified.
- Real-hook fixture, three states:
  - absent: notice, then `ARCHIVED prose`;
  - installed with no CLI: `NOT ARCHIVED: the ship result check failed (exit 127)`, nothing moved;
  - current: `no phase result, move by hand: prose`.

### After the R-266 rebase, 2026-11-18
- Rebase checks, plugin onto 829748a then 4458bddb (#233):
  - watcher-dist-fresh passes (126 files);
  - targeted vitest 16 files, 308/308 (phase-results, stop, phase-result CLI and dist, gate-run and tool-gate CLI, archive, provenance);
  - bash 3.2 hook sweep: 106/111. The 4 failures that were R-266's are fixed in #233; the 1 caused by R-257 is fixed in T25.
- API after rebasing onto a80487c4: manifest regenerated and verified (138); US-004 conflict resolved with both bases (plan 36,416, build 31,469).
- Gate check: plan Phase 0's archive step fed to the real hooks/oss-tool-gate.sh pre:
  - before T22, refused for main and builder (`((`…`$` in double quotes);
  - after T22, it passes for both, including the `"$top/..."` moves.
  - The four `assemble` steps pass too.
- T22: plan-archive-step RED 1 failing, GREEN 28/28. served-commands.acceptance: RED (stale fixture), GREEN 3/3 with OSS_API_REPO set to the R-257 API checkout, and 3/3 without it after #233.
- T23: RED 2 failing under TZ=Pacific/Pago_Pago. GREEN 27/27 under Pago_Pago, Kiritimati, Shanghai and UTC.
- T24: stat-order names none of R-257's files. oss-notify-phase-result, timeline-gate-ledger and oss-decision-record pass (bash 3.2).
- T25: analytics test RED, first on the notice, then on the ledger line. GREEN, along with oss-notify-phase-result, phase-results.acceptance, notify bounds and group, resolve-cli, notify-timeline and session-start-copy.

### T18-T30 and final checks, 2026-11-18
- T18 Stop wiring: RED 3 vitest + shell check; GREEN hooks-json files and test/stop 19/19, stop-hook-wired 2/2, oss-stop-dispatch 9/9.
- T18b ledger protection (D22): RED 10 ledger refusals; GREEN phase-results-protected 30/30, tool-gate 739/739, served-commands.acceptance 3/3.
- T19 verdict capture: API review-verdict-block RED 12/16, GREEN 16/16 (39 files, 1499/1499; manifest 138). Plugin verdict-capture 22/22, assemble-ship 27/27, oss-verdict-capture.test.sh 11/11.
- T27 gate names: RED phase-results.acceptance case 8 (gate_missing code-reviewer); GREEN 8/8, 227/227.
- T28 / T30 test setups broken by T10/T26 (setup only, no expectation changes): ship-wrapper-chain 3/3, oss-notify-telegram 3/3, oss-notify-workflow-name 12/12, notify-timeline 9/9, oss-archive-check 18/18, oss-notify-bounded-group 9/9, oss-notify-complete-bounds 9/9.
- T29 (D24): RED 2 of 4 new cases; GREEN assemble-ship 32/32, 231/231.
- Simplifier: tsc clean; 520/520 targeted.
- Final, after the rebase onto d9c65865:
  - vitest test/phase-results, stop, hooks, tool-gate, gate-run, phase-result acceptance and dist: 153 files, 8343/8343;
  - served-commands.acceptance (OSS_API_REPO set) 3/3;
  - bash 3.2 sweep of every hooks/__tests__/*.sh: 113/113 files rc 0;
  - watcher-dist-fresh pass.

## Last Updated: 2026-11-18 11:05 CST by /oss:build (T18-T30)
