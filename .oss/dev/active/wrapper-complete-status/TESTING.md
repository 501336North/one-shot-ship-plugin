# Testing: wrapper-complete-status

## T1: `commands/__tests__/wrapper-complete.test.sh`

Matching is literal (awk `index`, `grep -xF`), because `grep` here is ugrep and `$` mid-pattern misbehaves.

- Test 1: every `commands/*.md` with a `~/.oss/hooks/oss-notify.sh --workflow <w> start` line also has a `--workflow <w> complete` or `merged` line.
- Tests 2 to 24: each fixed wrapper has exactly `~/.oss/hooks/oss-notify.sh --workflow <w> complete '{}'`, and no other completion line for `<w>` (so no `{…}` placeholder).

### RED (2026-10-19)
`0/24 passed, 24 failed`. Test 1 reported 23 missing:
a11y audit bench chaos cost deploy docs experiment feature-flag incident license load monitor postmortem privacy release retro rollback smoke stage tech-debt test trace.

That is the 22 in the plan plus **a11y**, which the plan's list missed. a11y was fixed too; otherwise the test stays red.

### GREEN (2026-10-19)
- A count-checked script changed exactly 23 files (184 insertions, nothing else).
- Placement: before `## Error Handling` in load, smoke, tech-debt and trace. The other 19 have no such heading, so the step is appended at the end.
- `wrapper-complete.test.sh`: 24/24 passed.
- `commands/__tests__` folder, run sequentially: 56 run, 55 passed, 1 failed. The failure is `ideate-template` ("commands/ideate.md should contain API template fetch instruction"), which was already known.

### Anti-vacuity
- Stashed only the wrappers (`git stash push -m wcs-av -- commands/*.md`): RED again with the same 23 named, 0/24. Then applied the stash by SHA and dropped it by message.
- Mutated trace's line to `complete '{"n": {N}}'`: `trace.md has the fixed completion line` FAILED (23/24). Restored afterwards.

## T2
- v2.0.88 -> v2.0.89
- hooks/__tests__ + commands/__tests__: 32/36 files pass; the 4 failures are pre-existing on main (stale hooks/hooks.json path in 3 tests; ideate-template)
- watcher-dist-fresh: PASS after npm ci in the new worktree
- watcher/test/hooks (no-setup, CLAUDE_PROJECT_DIR unset): 31 files, 192/192

## Ship round 1, Track A (F1 F2 F5 F9 F13), 2026-10-19

`commands/__tests__/wrapper-complete.test.sh` grew from 25 to 95 assertions:
- F5: Test 1 finds a notify line anywhere on the line, any indent, in the `~/.oss/hooks/` or `$HOME/.oss/hooks/` spelling. A floor asserts at least 55 wrappers send a start line. That is today's count; the plan said 54, which was one short (the old detection also found 55).
- F1 (23): each fixed completion section's first line is exactly ``On success only. If the command failed (the prompt sent `failed`), do not send `complete`.``
- F2 (23 + 23):
  - the completion heading is the next `##` heading after the "Execute the Fetched Prompt" heading;
  - its line is inside a ```bash fence;
  - `## Step N:` headings run 1, 2, 3, ... with no repeats.
- F9 (1): every wrapper with an Execute heading has a non-blank body before the next heading.

Headings are only counted outside code fences.

### RED
- 52/95 passed, 43 failed:
  - 23 guard;
  - 19 placement: a11y audit bench chaos cost deploy docs experiment feature-flag incident license monitor postmortem privacy release retro rollback stage test;
  - 1 empty Execute, naming load smoke tech-debt trace.
- The numbering and F5 assertions pass on the real files. They were shown to bite on temp copies (M5, M6, M8 below).

### GREEN
These were count-checked scripts, and each exits non-zero unless it changes exactly the expected number of files:
- F1: inserted the guard in 23 files (+46 lines).
- F2: moved the completion section in 19 files, net 0 lines per file. Each moved step was already `Step N+1` of the Execute `Step N`, and no `## Step` heading followed it, so no renumbering was needed. The script asserts both.
- F9: added "Execute the prompt returned by the API." to load, smoke, tech-debt and trace. That sentence opens the Execute body of 7 other wrappers. The most common opener, "The prompt handles:", introduces a per-command list, so it is not a one-line body.

Results:
- `wrapper-complete.test.sh`: 95/95.
- `commands/__tests__` folder, run sequentially: 9 files, 127 assertions, 126 passed, 1 failed. The failure is `ideate-template`, which was already known.

### Mutations (each on a temp copy of `commands/`, never in the repo)
| # | Mutation | Old test (25) | New test (95) | Killed by |
|---|----------|---------------|---------------|-----------|
| M1 | wrong workflow name: audit's line says `audtt` | FAIL | FAIL | Test 1, audit fixed line, audit guard, audit placement |
| M2 | audit's notify line moved out of the ```bash fence | PASS | FAIL | audit placement (not fenced) |
| M3 | audit completion section moved to the end of the file | PASS | FAIL | audit placement |
| M4 | audit guard sentence removed | PASS | FAIL | audit guard |
| M5 | review start rewritten to indented `$HOME/` form, its `complete` removed | PASS | FAIL | Test 1 (start has completion) |
| M6 | audit completion renumbered `Step 6` (duplicate) | PASS | FAIL | audit step numbering |
| M7 | trace Execute body emptied | PASS | FAIL | Execute body |
| M8 | review start and complete lines removed (54 starters) | PASS | FAIL | start floor (55) |
| M9 | audit guard moved below the "You MUST" line | PASS | FAIL | audit guard (must be first line) |

All 9 were killed. Before this round, M2 to M9 survived.

Provenance: the only other test that reads "Execute the Fetched Prompt" is `watcher/test/agents/local-model-offload.test.ts`, which covers `agents/`, not `commands/`.

## Track B (F3 F4 F6 F7 F8 F10)
# Track B notes (wrapper-complete-status, ship round 1)

## F3 chain-trigger early return
- RED: chain-trigger.test.ts "a workflow with no config (audit) makes no API call and prints nothing":
  `expected "vi.fn()" to not be called at all, but actually been called 1 times` (73/74).
- GREEN: `if (!Object.hasOwn(DEFAULT_WORKFLOW_CONFIGS, workflowName)) return {0,0,[]}` before the fetch. 74/74 (+ integration 80/80).
- Anti-vacuity: guard disabled -> audit test RED (1 fail); guard always-true -> build test + 58 others RED.
- Drift test (client set == ideate, plan, build, ship) passes on first run: it is a characterisation guard.
- Provenance: server twin is AgenticDevWorkflow-g21/packages/api/src/schemas/workflow-config.ts:14
  `WORKFLOW_NAMES = ['ideate','plan','build','ship']`. Same set today. API repo not edited.

## F4 Telegram bound
- RED (vitest): `expected undefined to be an instance of AbortSignal`.
- GREEN: `signal: AbortSignal.timeout(10_000)` on the sendMessage fetch.
- RED (bash, oss-notify-complete-bounds case 1): stalled stub took 31s.
- GREEN: `run_with_timeout 15 node "$TELEGRAM_CLI" ...`. Took 16s (threshold < 24s).
- Bound: 15s, same order as the chain call's bound. Node aborts at 10s so the CLI normally exits by itself first.
- No env override added; the test pays the real 15s.

## F6 run_with_timeout keeps stderr
- RED: chain-trigger.log empty. GREEN: removed the three `2>/dev/null` inside run_with_timeout.
- Provenance (callers of oss-notify.sh run_with_timeout):
  - get-copy (2>/dev/null at the call site), check-updates (2>/dev/null), chain-trigger (2>> log), telegram (2>/dev/null, new).
  - wf_state_timeout -> 4 session calls had NO redirect -> added `2>/dev/null` to each (guarded by case 5).
  - complete path now uses `>/dev/null 2>&1`.
  - Twin `run_with_timeout` in hooks/oss-session-start.sh still swallows stderr. Its callers have no log redirect and rely on that swallowing, so it is correct as-is. Left unchanged.

## F7 status lines on complete
- Provenance grep for "Step completed", "Current command cleared", "TDD phase cleared", "Last command set to", "Next command set/cleared", "Workflow complete set":
  - watcher/test, hooks, commands, agents, skills: no consumer.
  - API prompts (AgenticDevWorkflow-g21/packages/api/src/prompts): no consumer.
  - The only hits are the CLI itself plus one comment in services/workflow-state.ts.
- Decision: silenced on the complete path only (`>/dev/null`). The CLI's output is unchanged for other callers.
- RED: STATE-STDOUT lines in complete's output. GREEN: none, and the CHAIN block is still printed (control).

## F8 bounded state calls on complete
- All 6 wf_state calls in the complete branch now go through `wf_state_timeout 2`, including setNextCommand, clearNextCommand and setWorkflowComplete.
- RED: hanging stub took 41s (audit, 4 calls x 10s).
- Test now uses ship (6 calls) with a 20s hang. GREEN 12-13s (threshold < 20s).
- Anti-vacuity: one call unbounded -> 31s, RED.

## F10 refused write
- RED: stdout 'Step completed: build' etc. on a symlinked state file (4 of 4 commands).
- GREEN:
  - WorkflowStateService.writeRefused is set when safeWriteFileAtomic returns false.
  - The CLI buffers its success line and, on refusal, sets exitCode 1 and prints nothing. The refusal stays on stderr from the guard.
- Anti-vacuity: CLI check removed -> 4 RED; flag never set -> 4 RED.
- PROVENANCE CONFLICT:
  - hooks/__tests__/oss-writer-nofollow.test.sh section 3 asserted that the CLI exits 0 on refusal (ADR-1 "best-effort writers").
  - Changed only those 3 CLI cases to a new check_refused: rc != 0, refusal printed, no success line, outside unchanged.
  - Hook-level cases still assert rc 0.
  - Anti-vacuity: old CLI behaviour -> 42/45.
- Callers of the CLI's exit code:
  - Hooks with `|| true` or run_with_timeout: oss-notify, oss-session-start, oss-session-end, oss-notification, oss-precommand, oss-log setTddPhase.
  - oss-log agent lines use `(A && B) &`: B is skipped after a refusal, which is harmless because B targets the same refused file.
  - hooks/oss-workflow-auto.sh has no `|| true`; its last node call's rc becomes the script's rc. It is not registered in hooks.json and only watcher/test/hooks/oss-workflow-auto-hook.test.ts uses it (passes).

## Pre-existing, not fixed
- (Fixed in R2-1, below.) In oss-notify.sh run_with_timeout, the no-timeout fallback left the killer's `sleep` orphaned and holding stdout.

## R2-1 fallback timer (no timeout/gtimeout)
- Tests build a PATH of symlinks to /usr/local/bin, /usr/bin, /bin, /usr/sbin, /sbin minus timeout/gtimeout, plus a `sleep` wrapper that records its pid. They assert the PATH really hides both tools.
- oss-notify-complete-bounds.test.sh case 6: `--workflow audit complete '{}'` with stdout read through `| cat`; asserts < 5s, no `Terminated` on stderr, no recorded sleep alive 1s later.
  - RED: 31s, stderr `Terminated: 15 ( sleep "$timeout_secs" && kill -9 $pid ... )`.
  - GREEN: 0-1s, 6/6.
- New session-start-timeout-fallback.test.sh: session start with stdout to a file; asserts no `Terminated`, no recorded sleep alive.
  - RED: one orphan sleep alive. GREEN: 1/1 (3 runs).
- Gotcha: a freshly written script's first exec can lag ~0.3s+ on macOS, so the sleep wrapper is warmed once and the leftover check waits 1s (all timers are >= 2s).
- Anti-vacuity:
  - notify full revert -> RED (30s + Terminated).
  - notify mutant "stdio redirected + wait, no trap" -> RED (5 leftover sleeps), so the orphan assertion bites on its own.
  - session-start revert -> RED (1 leftover sleep).
- Suites: complete-bounds 6/6, oss-writer-nofollow 45/45, oss-notify-workflow-name 12/12, session-start-timeout-fallback 1/1, session-start-copy 8/8, session-start-iron-laws 4/4.
