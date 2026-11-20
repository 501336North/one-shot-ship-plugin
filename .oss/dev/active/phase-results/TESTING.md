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

### Ship round 3 fixes (D31-D36), 2026-11-18
- Builders A/B/C each ran RED then GREEN per fix; C's D34-corrected and D36 work: 348/348 across 15 files.
- stop-hook-wired: failed 3/10 before the shim warm-up (macOS first-exec scan); 15/15 after.
- Final, after the rebuild: build and tsc clean.
  - Targeted vitest (test/phase-results, stop, cli, hooks, tool-gate, healthchecks/archive): 194 files, 10211/10211.
  - Bash 3.2 sweep of every hooks/__tests__/*.test.sh: 112/112 rc 0.
- Load note: one earlier run, at load average 8 (Backblaze using a full core), failed 3 R-266 round20b trap tests plus
  notify-timeline and oss-stop-dispatch timing cases. Each passed alone and in a full rerun at lower load.

### Ship round 4 (Sprint D merge, D37, D38, notifier leak), 2026-11-18
- After merging Sprint D, these failed:
  - served-commands.acceptance: plan.md #7 refused, 2 failures;
  - oss-hook-env: 22 tests plus the exact-set test;
  - provenance: 1, a false positive on a comment.
- D37 GREEN: oss-hook-env 478/478, served-commands 3/3, provenance 5/5.
- D38: oss-stop-dispatch 10/10 idle and 10/10 under load; notify-timeline 10/10 and 10/10.
- Notifier tripwire (fake terminal-notifier, osascript, say and afplay first on PATH):
  - RED: 10 "OSS Done" lines from one oss-stop-dispatch run, and 1 from a forced-allow copy of acceptance case 7;
  - GREEN: 0 lines on every run.
- Final: build and tsc clean.
  - Targeted vitest: 195 files, 10701/10701.
  - served-commands (OSS_API_REPO set): 3/3.
  - Bash 3.2 sweep under the tripwire: 112/112, with 0 tripwire lines.
- protected-path-equivalence (R-266): 4 cases timed out once at load average 12 while a builder was loading the machine on purpose; they pass alone and in the final run. Passed to R-266.

### Ship round 5 (D39-D44), 2026-11-19
- Each builder showed RED, then GREEN. Sandbox repros from the gates became unit and acceptance tests:
  - pen a1/a3/a5;
  - security d34 cases A and B;
  - code review REPRO and REPRO3.
- Rebuilt-dist catch: ship-wrapper-chain failed 2 of 3. Its test repo had no origin ref, so the D40 snapshot was empty. Fixed in the test setup; 3/3 on 3 runs.
- Final: build and tsc clean.
  - Targeted vitest: 197 files, 10807/10807.
  - served-commands (OSS_API_REPO set): 3/3.
  - Bash 3.2 sweep under the tripwire: 113/113, with 0 tripwire lines.

### Ship round 6 (D45-D49), 2026-11-19
- Every builder showed RED before GREEN. The round-4 gate repros became tests:
  - pen M2a, M3a and M3b;
  - security M1 (minted pass), finding 2a, and the hard-linked transcript;
  - the code-review recheck flip;
  - the perf backtracking case.
- First full run: 10826 of 10833 passed. The 7 failures are in two R-266 tool-gate files, and both pass alone (240/240, twice):
  - protected-path-equivalence: the known load flake, owned by R-266;
  - round21b PERF MEDIUM-1: a 1.5 s wall-clock bound that breaks only under parallel load (427-464 ms alone).
  - R-257's matcher is not the cause: 1.16 ms per call, against 1.25 ms before.
  - Both were reported to R-266.
- After D50, final run: build and tsc clean; targeted vitest 10838 of 10838; served-commands 3/3; bash 114/114 behind the tripwire, with 0 tripwire lines.

### Ship round 7 (D51-D53), 2026-11-19
- Each builder showed RED before GREEN. The round-5 repros became tests:
  - revert to failed code;
  - cutoff past a fail;
  - replace and graft;
  - symref under refs/remotes;
  - assume-unchanged and info/exclude;
  - a big file or many paths;
  - a 20,000-path diff;
  - an upstream base.txt;
  - bracket glob forms.
- Full run: build and tsc clean; targeted vitest 10877 of 10878. The one failure was git-path.test.ts, whose old "no GIT_*" expectation the D51 git env broke; it was updated and test/phase-results reran 348/348. served-commands 3/3; bash 114/114 behind the tripwire, with 0 tripwire lines.

### Ship round 8 (D54-D57), 2026-11-19
- Each builder showed RED before GREEN. The round-6 repros became tests:
  - gc --prune=now and aged gc;
  - a repo-local excludesFile;
  - the LFS filter;
  - a stale local main;
  - a symref base;
  - [[: across word ends;
  - 200 rows on one tree, counted in git spawns (406 before, under 40 after).
- Sparse 302k capture went from about 1.8 s to about 0.9 s.
- Full run: build and tsc clean; targeted vitest 10909/10909; served-commands 3/3; bash 114/114 behind the tripwire, with 0 tripwire lines. The Mac slept for part of the run; nothing failed.

### Ship round 9 (D58-D60), 2026-11-19
- Each builder showed RED before GREEN. The round-7 repros became tests:
  - a rebase or merge with the flagged file unchanged;
  - 200 distinct cleared rows, counted in spawns;
  - a pruned headSha-only row;
  - fork plus upstream;
  - a base missing from the snapshot;
  - a symlinked ref and a symlinked refs/heads;
  - ls-files -m once per capture, and an LFS stat-dirty capture;
  - a sparse file-over-folder;
  - the ${...} split around the capture name.
- LFS 300x2 MB stat-dirty capture went from 2.1-3.1 s to about 1.2 s.
- Full run: build and tsc clean; targeted vitest 10936/10936; served-commands 3/3; bash 114/114 behind the tripwire, with 0 tripwire lines.

### Ship round 10 (D61-D63), 2026-11-20
- Full check: build 0, tsc 0, 199 files / 10976 tests passed, served-commands 3/3, bash 114/114 behind the tripwire (0 trip lines).
- New tests: D61 (rebase or merge of a newer origin/main with stale local main, with and without a snapshot), D62 (same-file upstream edit, clean conflict back to the flagged code, real fix after an upstream edit), reftable base, symlinked refs/refs/heads/packed-refs, a spawn bound at 200 deletion rows, diverged remotes (equal and skewed times), null or unknown headSha, one clean-filter run per modified file, .oss kept out of `tree`, the backslash-set split rows plus a 105k-character time bound, and the exported glob helpers.
- Repro replays: d58 rebaseorigin_nolocal and mergeorigin_nolocal blocked (12 files, not 13); sameFileUpstream blocked; divremotes 1 file / 1 insertion (was 4 / 301).

### Ship round 11 (D64-D66), 2026-11-20
- Full check: build 0, tsc 0, 199 files / 10991 tests passed, served-commands 3/3, bash 114/114 behind the tripwire (0 trip lines).
- 15 new tests: older-git (CLT 2.50.1, skipped with a message if absent) deletion and rebase fixes, submodules, fetch after rebase, diverged remotes, conflict kept flagged, interHunkContext, -diff lockfile, indentation-only fix, mode-only fix (guard, not RED), spawn bounds for batched D62 and the lookup cache.
- Changed test: the D62 conflict test now has the teammate edit two lines (code-review L4), so it fails on 66d0267e.

## Last Updated: 2026-11-20 14:47 CST by /oss:ship (round 11 fixes)
