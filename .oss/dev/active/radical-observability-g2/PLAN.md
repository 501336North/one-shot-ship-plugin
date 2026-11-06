# Implementation Plan: Radical Observability G2, Phase B (plugin side)

## Summary
The plugin writes a committed `.oss/dev/active/{feature}/timeline.ndjson` per feature (command, agent, gate and merge lines) and copies each line to the API through `POST /api/v1/timeline` in the background. Phase A, the API, shipped in AgenticDevWorkflow PR #418. Phase C (served ship/ship-team/auto prompts that call the gate and merge verbs) comes after this plugin release, on an API branch.

## Design Reference
- AgenticDevWorkflow `origin/main:.oss/dev/active/radical-observability-g2/`:
  - `DESIGN.md` (COMMITTED 2026-11-03);
  - `REQUIREMENTS.md` (US-G2-001 to 005 and the edge cases);
  - `API.md`;
  - `DECISIONS.md` (ADR-001 to ADR-010);
  - `PLAN.md` "Phase B" (B1 to B6, including the gate-name contract with G3 ADR-005).
- The API contract to match: `packages/api/src/services/timeline/schema.ts` on AgenticDevWorkflow main. Four strict kinds (`command`, `agent`, `gate`, `merge`) with `v: 1`, a lower-case uuid v4 `id`, ISO `ts`, `feature`, `session` (`^[A-Za-z0-9-]{1,64}$`), optional `repo` and `keyFp`. Unknown keys are refused.
- G1 code to mirror (this repo):
  - `hooks/oss-decision-record.sh` for the feature resolution (L24-39), uuid and ts (L65-70), the lock (L129-162), append (L164-168), outbox and push (L174-321);
  - `hooks/oss-api-curl.sh` for `oss_ask`, `oss_api_creds`, `oss_is_regular`, `oss_private_dir`, the lock helpers and `oss_decisions_push_off`;
  - `hooks/oss-safe-path.sh` for `oss_safe_target`, `oss_resolve_project` and `oss_valid_workflow_name`;
  - `hooks/oss-value.sh` for the value-file verb pattern (`_ov_cmd_agent`).
- Decisions for this phase: `DECISIONS.md` in this folder (P-1 to P-8).

## Rules for every task
- Hook tests are hermetic:
  - `unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK`, a sandbox `HOME` under `mktemp -d`, `GIT_CONFIG_GLOBAL=/dev/null`, GIT_* unset;
  - the fake API from `hooks/__tests__/fake-oss-api.sh`;
  - caps only through `run_capped` (`hooks/__tests__/lib/run-capped.sh`).
- Run each test file on its own, for example `/bin/bash hooks/__tests__/timeline-writer.test.sh`. **Never run the watcher's vitest suite**: its setup kills OSS processes machine-wide.
- No free text reaches a line. Every value is matched against the API's pattern before it is written.
- Values reach the gate and merge verbs only through value files under `~/.oss/run/<key>/`, never on a command line.
- The existing guards stay green after every task:
  - `hooks-registration.test.sh`, `tests-hermetic-env.test.sh`, `one-copy-helpers.test.sh`;
  - `referenced-hooks-tracked`, `oss-state-files-nofollow`, `oss-writer-nofollow`;
  - `no-hand-capped-tests.test.sh`.

## Branches
- Build: `feat/radical-observability-g2/build-b1-b8` from plugin `origin/main` (c80e004 or later). Split at Task 5 if the PR grows past review size: `build-b1-b4`, then `build-b5-b8`.

## TDD Implementation Tasks

### Task 1: Acceptance test at the boundary (written first, fails until Task 8)
**Objective:** Pin the whole Phase B behaviour from the outside, the way a customer's session sees it.

**Tests to write (RED):** `hooks/__tests__/timeline.acceptance.test.sh`, a sandbox product repo on `feat/demo/build` with `.oss/dev/active/demo/` and the fake API.
- `should append a command line when oss-notify reports start, complete and failed`: three valid lines in `demo/timeline.ndjson`, `status` start, complete, failed.
- `should append an agent line when an Agent tool run finishes`: PostToolUse JSON with `tool_name: Agent` and `subagent_type: oss:code-reviewer` gives one `agent` line with `agent: oss:code-reviewer` and the current command.
- `should append a gate line from value files only`: write the gate value files, run `oss-value.sh timeline gate`, and get one `gate` line. No value appears in the process argv (the fake curl records argv).
- `should append a merge line with GitHub facts from gh`: a fake `gh` on PATH returns number, mergeCommit, mergedAt and mergedBy. `approval.txt` holds `merge-flag`, giving one `merge` line.
- `should copy every pushable line to the API in the background`: the fake API receives one POST per line. Each body passes a copy of the API's rules (a jq check per kind in the test, listing the exact keys).
- `should keep the repo copy when the team has opted out`: the policy returns `pushEnabled: false`, so the lines are written and no POST is made.

**Implementation:** none. Leave the test RED and note it in PROGRESS.md.

### Task 2: One copy of the feature resolution (refactor only)
**Objective:** G1 and G2 must find the same feature folder for the same branch. Two copies would drift (provenance), so the logic moves into one helper.

**Tests to write (RED):** `hooks/__tests__/feature-resolve.test.sh`, a table over branch shapes:
- `feat/demo/build` with the folder present gives `demo`;
- `feat/missing/build` gives unfiled;
- branch `main` with exactly one active folder gives that folder;
- branch `main` with two active folders gives unfiled;
- a name failing `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` gives unfiled;
- an active folder that is a symlink still resolves to its name. The write is then refused by `oss_safe_target` (AC-G2-001.5, and G1's existing refusal tests), never silently filed as unfiled.

**Implementation (GREEN):**
- `hooks/oss-safe-path.sh`: add `oss_resolve_feature PROJ` (sets `_OSS_FEATURE`, empty for unfiled), the body moved from `oss-decision-record.sh` L24-36.
- `oss-decision-record.sh` calls it.

**Refactor:** none beyond the move.

**Acceptance:** `decision-record.acceptance.test.sh`, `oss-decision-record.test.sh` and `decision-push.test.sh` all pass unchanged.

### Task 3: B1, the timeline writer
**Objective:** One fixed script appends one validated line under the G1 lock and refuses symlinks (AC-G2-001.3, 001.5; unfiled fallback).

**Tests to write (RED):** `hooks/__tests__/timeline-writer.test.sh`.
- `should write v 1, a lower-case uuid v4 id, an ISO UTC ts, kind, feature and session on every line`.
- `should take the session from the hook input, else CLAUDE_CODE_SESSION_ID, else "unknown"`, all matched to `^[A-Za-z0-9-]{1,64}$`; anything else becomes `unknown`.
- `should write to .oss/dev/timeline-unfiled.ndjson with feature omitted when no feature folder resolves`. Unfiled lines are never pushed (P-3).
- `should refuse a symlinked timeline.ndjson and write nothing`.
- `should refuse a symlinked feature folder and write nothing`.
- `should refuse a timeline.ndjson with more than one hard link`.
- `should add a newline first when the file does not end in one`.
- `should keep both lines when two sessions append at once`: two writers under `run_capped`, two lines, two distinct ids.
- `should skip after 10 s when another session holds the lock, and never wait longer`.
- `should refuse any value outside the API pattern for its field` (a table per kind, including U+200B written as an escape), and write nothing.
- `should exit 0 and write nothing when the project has no .oss folder`.

**Implementation (GREEN):**
- `hooks/oss-timeline.sh`, sourcing `oss-api-curl.sh` and `oss-safe-path.sh`.
- Internal entry `oss_timeline_append KIND FIELDS_JSON`:
  - `oss_resolve_project`, then `oss_resolve_feature` (Task 2);
  - the target is `.oss/dev/active/$feature/timeline.ndjson` or `.oss/dev/timeline-unfiled.ndjson`;
  - `oss_safe_target`, then the lock at `~/.oss/locks/<rid>` using the same helpers as G1 (`oss_lock_id`, `oss_take_stale`, `oss_release_lock`);
  - build the line with `jq -c --arg`, check it per kind, then append.
- The uuid and ts code is G1's. If `one-copy-helpers.test.sh` flags the copy, move it to `oss-api-curl.sh` as `oss_uuid4` and `oss_utc_now`, and have both scripts call it.
- No call to `oss-log.sh init`.

**Refactor:** keep the per-kind field checks in one table at the top of the script.

### Task 4: B2, command lines from oss-notify, plus follow-up #130
**Objective:** Each `--workflow <cmd> start|complete|failed` appends one `command` line, even when `watcher/dist` is missing (AC-G2-001.1). The hook no longer exits silently on non-JSON input (FOLLOWUPS #130, pulled in 2026-11-06).

**Tests to write (RED):** `hooks/__tests__/notify-timeline.test.sh`.
- `should append one command line for start, complete and failed`.
- `should append nothing for task_complete or merged`.
- `should still append the line when watcher/dist is absent`.
- `should not delay oss-notify by more than 1 s when the API hangs`: the fake API waits 10 s and the call returns under `run_capped 3`.
- `should finish the state update when the copy service prints non-JSON` (#130): for the get-copy output, the `task_complete` context and the `--issue` message, under `set -euo pipefail`.

**Implementation (GREEN):**
- `hooks/oss-notify.sh`, before the `if [[ -f "$WORKFLOW_STATE_CLI" ]]` block:
  - for start, complete and failed, call `oss-timeline.sh command "$WORKFLOW_CMD" "$WORKFLOW_EVENT"`, with the name already validated by `oss_valid_workflow_name`;
  - then start the push detached: `( ... ) </dev/null >/dev/null 2>&1 &`, as the analytics POST does.
- #130: add `|| <default>` to each `$(… | jq …)` that the follow-up names.

### Task 5: B3, agent lines from a PostToolUse hook
**Objective:** Every Agent or Task tool run appends one `agent` line with its type and the running command (AC-G2-001.2).

**Tests to write (RED):** `hooks/__tests__/timeline-agent-hook.test.sh`.
- `should record subagent_type and the current command from workflow-state.json`.
- `should lower-case a type such as Explore before checking it, and skip a type that still fails ^[a-z0-9:_-]{1,64}$` (P-5).
- `should omit command when workflow-state.json is missing, a symlink, or names an invalid command`.
- `should do nothing for any other tool_name`.
- `should do nothing on stdin that is not JSON, and exit 0`.

**Tests to update:** `hooks/__tests__/hooks-registration.test.sh`: a new matcher `Agent|Task` is registered, async, and its command exists.

**Implementation (GREEN):**
- `hooks.json` PostToolUse: add `{"matcher":"Agent|Task","hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/oss-timeline.sh","async":true}]}`.
- `oss-timeline.sh` with no verb reads the hook JSON from stdin (2 s timeout, as G1 does).

### Task 6: B4a, the gate verb
**Objective:** A ship round records each gate through value files only, and every value is checked (AC-G2-002.1, 002.2). Gate names follow the G3 contract.

**Tests to write (RED):** `hooks/__tests__/timeline-gate.test.sh`.
- `should write one gate line from round.txt, gate.txt, verdict.txt, findings.txt, fixed.txt and mode.txt`.
- `should refuse a round outside 1..20, a verdict other than pass or fail, or a mode other than full, quick, no-checks or team`.
- `should refuse a gate name that is neither one of security, code-review, performance or pen-test nor a quality-gate agent name without its prefix` (P-6).
- `should accept only critical, high, medium, low and info counts, each 0..1000`, in the form `critical=0 high=2`, with no other key and no repeats.
- `should delete every value file it read, whether it accepted or refused them`.
- `should pin the gate-to-agent map of G3 ADR-005`:
  - `security` → `security-auditor`;
  - `code-review` → `code-reviewer`;
  - `performance` → `performance-auditor` or `performance-engineer`;
  - `pen-test` → `penetration-tester`.
  The test compares this to a copy of G3's `flags.ts` table pasted in the test, with the AgenticDevWorkflow commit it came from.

**Implementation (GREEN):**
- `hooks/oss-value.sh`:
  - a verb `timeline gate` (`_ov_cmd_timeline`) that uses `_ov_take` with one regex per file, then calls `oss-timeline.sh gate` with the checked values;
  - add the six new `.txt` files to the `_ov_cmd_dir` `rm` list;
  - add the verb to the header and to `_ov_usage`.
- `hooks/oss-session-start.sh`: add `oss-timeline.sh` to `HOOKS_TO_COPY`, so served prompts can call it from `~/.oss/hooks`.

### Task 7: B4b, the merge verb
**Objective:** The merge line takes its facts from `gh` and its approval from a value file (AC-G2-003.1, 003.2). Missing `gh` is recorded locally (P-2).

**Tests to write (RED):** `hooks/__tests__/timeline-merge.test.sh`, with a fake `gh` on PATH.
- `should take pr, sha, mergedAt and mergedBy from gh pr view --json number,mergeCommit,mergedAt,mergedBy`.
- `should read approval.txt as merge-flag, chat-instruction, none or decision:<lower-case uuid v4>, and refuse anything else`.
- `should record approval none when approval.txt is missing`.
- `should write a local merge-unknown line, and queue nothing for the API, when gh is missing, fails or reports the PR is not merged`.
- `should refuse a sha that is not 40 hex characters, or a login outside ^[A-Za-z0-9-]{1,39}$`.
- `should never pass a value file's content to gh`: the fake gh records its argv.
- `should give up on gh after 10 s` (`run_capped` in the test; the script's own call is bounded by `oss_tl_bounded`, a third inline copy of the supervisor: see DECISIONS.md P-9).

**Implementation (GREEN):** `oss-value.sh timeline merge` plus `oss-timeline.sh merge`.

### Task 8: B5, background push
**Objective:** Copy each pushable line to the API without delaying the command, and obey the same switch, policy and replies as decisions (AC-G2-005.2, 005.6).

**Tests to write (RED):** `hooks/__tests__/timeline-push.test.sh` (the acceptance test from Task 1 also goes GREEN here).
- `should queue each new feature line as pending in ~/.oss/timeline-outbox/<rid>.ndjson (folder 700, file 600)`.
- `should never queue an unfiled line or a merge-unknown line`.
- `should send nothing when the local push switch is off` (`oss_decisions_push_off`: the marker file, or `decisionsPush: false`).
- `should GET /api/v1/decisions/policy first and withhold every waiting line when pushEnabled is false`.
- `should POST each waiting line to /api/v1/timeline with keyFp, the key on stdin and --max-time 5`, with no key in argv.
- `should handle each reply`:

  | Reply | Result |
  |---|---|
  | 200/201 | `verified` |
  | 400 | `refused`, never retried; one stderr line names the line id (a "Holds a secret" refusal is reported, never dropped silently) |
  | 409 `policy_off` | withhold everything waiting, then stop |
  | 409 `answered_while_off` / `account_mismatch` | `withheld` |
  | 409 `conflict` | `conflict` |
  | 5xx | `retry`; the third 5xx marks it `failed` |
- `should retry the waiting lines on the next push after the API was down`.
- `should send at most 8 POSTs per run and start none after 40 s`.
- `should hold one push lock per outbox, and leave the lines pending when the lock is busy`.
- `should refuse an outbox that is a symlink, has a second hard link or belongs to someone else`.

**Implementation (GREEN):**
- `oss-timeline.sh push` uses `oss_ask` and `oss_api_creds` from `oss-api-curl.sh`, so one-copy-helpers stays green.
- It mirrors G1's outbox state log (`waiting()`, `mark()`).
- **Refactor:** if the outbox and reply code matches G1's line for line, move it into `oss-api-curl.sh` as `oss_outbox_*` used by both. If not, keep two short copies and say why in DECISIONS.md.

### Task 9: B6, timeline files are never removed, plus the release
**Objective:** Nothing in the plugin deletes or rotates a timeline file (AC-G2-001.4). Ship the release as 2.0.98.

**Tests to write (RED):** `hooks/__tests__/timeline-kept.test.sh`.
- `should leave timeline.ndjson and timeline-unfiled.ndjson untouched after oss-worktree-remove.sh`.
- `should leave both files untouched after oss-log.sh init, rotate and purge --force`.
- `should find no rm, mv or truncation of timeline files anywhere in hooks/`: a grep guard that excludes the tests.

**Implementation (GREEN):**
- No product change is expected. If a test fails, fix the script it names.
- `.claude-plugin/plugin.json`: `2.0.97` → `2.0.98`. `__tests__/plugin-version-bump.test.sh` passes.

## Ship fix round 1 (2026-11-06, from the four quality gates)
Every task: RED first, then GREEN, the same rules as Tasks 1-9. G1 and every G2 test stay green.

### Task 10: Delivery never stalls or strands a line
- `should send waiting lines of every outbox, not only the current feature's` (a branch switch or the ship archive must not strand a pending merge or gate line). The push walks `~/.oss/timeline-outbox/*.ndjson`, each under its own lock; the switch and policy checks are unchanged.
- `should count 401, 403, 404, 413, 422, 429, an unknown 409, a 2xx with no account.id and a curl timeout or 000 as a retry, and mark the line failed after the retry cap`; `should not let one retrying line block the lines behind it`.
- `should compact an outbox once it holds only lines in a final state (verified, refused, withheld, conflict, failed), under its lock`, so a push never re-parses a whole history.
- `should stop the run when a state mark cannot be written` (no 40 s spin, no double POST).

### Task 11: A merge line says only what is true
- `should accept decision:<uuid> only when that id is in this feature's decision record` (G1's decisions.ndjson); otherwise refuse the approval.
- `should refuse a value file older than 10 minutes` for the gate and merge verbs (a file left by another session is never reused), and delete it.
- `should run gh with every GIT_* variable unset`.
- `should write a local merge-unknown line when gh's facts fail the schema` (a bot login, a null mergeCommit, a mergedAt before 2020).
- No `repo` field is added (user decision 2026-11-06: no repo name leaves the machine, as in the approved plan and G1; the same-feature-name collision goes to FOLLOWUPS for G3).

### Task 12: Nothing unsafe or unbounded is written or read
- `should refuse a line holding the API's bare-secret run` (32+ letters and digits with a digit, in session, repo, feature, agent, gate, command, mergedBy), before the committed file is written.
- `should read workflow-state.json only when it is a single-link regular file of at most 64 KB`, and the hook's stdin only up to 1 MB.
- `should refuse a timeline.ndjson the person does not own`.
- `should write nothing when the project resolves to $HOME`.
- `should file a line for a feature folder name over 128 characters as unfiled`, and `should stop appending to timeline-unfiled.ndjson once it reaches 1 MB`.
- The outbox id check uses `\A…\z`.

### Task 13: Gate lines are consistent, and the gate map test can fail
- `should refuse verdict pass when a critical or high count exceeds its fixed count`.
- The G3 map test checks something the product decides (each mapped gate and agent name is accepted, a prefixed or misspelled-case name is refused) and its title says what the code does.

## Implementation Sequence
1. **Boundary first:** Task 1 (RED until Task 8).
2. **Shared rules:** Task 2, a refactor with G1 green.
3. **Writer:** Task 3.
4. **Sources:** Task 4, then Task 5, then Task 6, then Task 7. Each needs Task 3; Task 7 needs Task 6's verb.
5. **Copy to API:** Task 8, which turns Task 1 GREEN.
6. **Guards and release:** Task 9.
7. **Afterwards, on AgenticDevWorkflow:** Phase C (C1 to C3 in the API plan), once 2.0.98 is released.

## Testing Strategy
### Unit tests (bash, hermetic)
- [ ] The writer's per-kind validation and line shape (Task 3).
- [ ] Each value-file verb's accept and refuse tables (Tasks 6, 7).
- [ ] The push reply table (Task 8).

### Integration tests
- [ ] Task 1's acceptance test, end to end: real hooks, a fake `curl` and a fake `gh` only.
- [ ] A body check per kind that mirrors the API's strict schema. This is the contract between repos. When Phase C starts, AgenticDevWorkflow `test/timeline/plugin-push.real-hooks.integration.test.ts` should run these real hooks against the real route, as G1's `plugin-push.real-hooks` test does.

### Edge cases (from REQUIREMENTS)
- [ ] No active feature folder: the unfiled file, never pushed.
- [ ] Two sessions on one feature: the lock, unique ids.
- [ ] API down: the line is kept and retried.
- [ ] Merge outside OSS, or no `gh`: approval `none`, or a local `merge-unknown` line.
- [ ] Team opts out after earlier pushes: future pushes are withheld.

## Security Checklist
- [ ] No free text: every field is checked against the API's pattern before the write.
- [ ] Values reach the verbs only through value files; nothing goes on argv. Tests check argv.
- [ ] The API key is passed on stdin (`oss_api_curl`), never in argv. `--max-filesize "$OSS_BODY_MAX"`.
- [ ] Symlinks and hard links are refused for the timeline file, the feature folder, the outbox and the value files.
- [ ] The server runs `redactRecord` on every field. No client redaction is needed because no field can hold free text (P-4).
- [ ] The lock lives outside the repo (`~/.oss/locks`), so a repo cannot plant it.
- [ ] Header auth only (no `?token=`). Each body stays far under the API's 16 KB limit. `repo` is omitted, since it is optional.

## Performance Considerations
- [ ] Each hook does a local append only: one jq call plus one locked append, well under 100 ms.
- [ ] The push is detached, or rides on `async: true`. It never delays a command (Task 4 test).
- [ ] At most 8 POSTs and 40 s per push run.

## Rollout Strategy
- [ ] No feature flag. The push obeys the existing decisions switch and team policy (P-7).
- [ ] Release: plugin 2.0.98. Then Phase C on the API, so the served prompts call the gate and merge verbs.
- [ ] Rollback: revert the plugin release. Lines already in repos stay as committed history, and API rows stay (append-only).

## Estimated Tasks: 9
## Estimated Test Cases: about 75

## Last Updated: 2026-11-06 by /oss:plan
