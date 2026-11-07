# Implementation Plan: Radical Observability G2, Phase B2 (plugin 2.0.99)

## Summary
After the archive move, `oss-timeline.sh merge` files its line in `.oss/dev/completed/<feature>-<date>/timeline.ndjson` and queues it for push. Today it lands in `timeline-unfiled.ndjson` and is never pushed. The `decision:<uuid>` approval check reads `decisions.ndjson` from that same folder. Released as 2.0.99.

## Design Reference
- `DESIGN.md` in this folder (B7, B8, B9).
- API repo: `/Users/ysl/dev/AgenticDevWorkflow-g2c/.oss/dev/active/radical-observability-g2/` PLAN.md "Phase B2" and DECISIONS.md ADR-017.
- Earlier plugin decisions P-1 to P-19: `.oss/dev/completed/radical-observability-g2-2026-11-07/DECISIONS.md`.
- Plan decisions for this phase: B2-1 to B2-6 in `DECISIONS.md`.
- Follow-ups pulled in: FOLLOWUPS #186 (Task 7) and #197 (Task 6).

## Rules (every task)
- Hermetic hook tests only: sandbox HOME, `run_capped`, `GIT_CONFIG_GLOBAL=/dev/null`, the fake API and fake `gh`. Copy the harness from `hooks/__tests__/timeline-merge.test.sh`.
- Run one test file at a time: `/bin/bash hooks/__tests__/<name>.test.sh`.
- Never run npm, vitest or anything under `watcher/`: its test setup kills OSS processes machine-wide.
- After each agent round, run `pgrep -fl "oss-timeline|run-capped|sleep 60"` to check for orphan processes, and kill any it finds.
- Delegate the shell work to `oss:test-engineer` (RED) and `oss:code-reviewer` (review). No `any`, and no TypeScript is touched.

## Where the code goes
- `hooks/oss-timeline.sh`, and nothing else for B7 and B8. `oss_resolve_feature` in `hooks/oss-safe-path.sh` is NOT changed (DESIGN: out of scope).
- A new helper, `_oss_tl_archived <proj>`, in `oss-timeline.sh`. It sets `_OSS_TL_FEATURE` (the bare name) and `_OSS_TL_DIR` (the relative folder, `.oss/dev/completed/<f>-<date>`), or both `""`.
- A new helper, `_oss_tl_real_dirs <proj> <rel-dir>`, in `oss-timeline.sh`. It is read-only (no mkdir) and returns 0 only when every component from `<proj>` down is a real directory, not a link (B2-5).
- `oss_timeline_append` uses `_oss_tl_archived` only when the kind is `merge` or `merge-unknown` and `oss_resolve_feature` returned `""` (B2-3).
- The merge verb's decision check uses the same resolution: the active folder first, then `_oss_tl_archived` (B8).

## TDD Implementation Tasks

### Task 1: Acceptance test, a merge after the archive move is filed and queued (RED)
**Objective:** A failing boundary test, driven through `oss-value.sh timeline merge` exactly as a served prompt runs it.

**Tests to Write (RED step)** in the new file `hooks/__tests__/timeline-archived.test.sh`:
- [ ] `should file the merge line in the archived folder and queue it for push when the active folder was moved to completed/`
  - Setup: product repo on `feat/demo/ship`, with `.oss/dev/completed/demo-2026-11-07/` (holding `timeline.ndjson` with one earlier gate line) and no `.oss/dev/active/demo`. `approval.txt` = `merge-flag`, and the fake gh answers MERGED.
  - Assert: rc 0. The completed `timeline.ndjson` gains exactly one `merge` line with `feature: "demo"` and the gh facts. `.oss/dev/timeline-unfiled.ndjson` is absent or unchanged. `~/.oss/timeline-outbox/*.ndjson` holds one entry with that line's id and `state: "pending"`.
  - Must FAIL today: the line goes to unfiled and no outbox entry is made.

**Implementation:** none (RED only). **Acceptance:** fails for the stated reason, not for a harness error.

### Task 2: Resolve the archived folder for the merge verb (B7 core)
**Objective:** Task 1 passes, and the newest dated folder wins.

**Tests to Write (RED step)** in `timeline-archived.test.sh`:
- [ ] `should use the newest dated folder when the feature was archived twice`: `demo-2026-11-01` and `demo-2026-11-07` both exist, and the line goes to `-11-07`.
- [ ] `should ignore folders that only look like the feature's`: `demo-extra-2026-11-07`, `demo-2026-1-7`, `demo-2026-11-07-x`, `demox-2026-11-07` (and no real match), and the line goes unfiled with no outbox entry.
- [ ] `should stay unfiled and never push when no archived folder matches`: no `completed/` at all gives unfiled, no outbox entry, rc 0.
- [ ] `should keep filing in the active folder when it still exists`: both `active/demo` and `completed/demo-2026-11-07` exist, and the line goes to `active/demo` (unchanged behaviour).

**Implementation (GREEN step):**
- `_oss_tl_archived <proj>`: the branch is read the same way as in `oss_resolve_feature` (GIT_* unset, `git symbolic-ref --short -q HEAD`) and must match `^[^/]+/([^/]+)/[^/]`. The feature must pass `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` and be at most 128 chars. Glob `"$proj/.oss/dev/completed/$feature-"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]`, then take the last in lexical order (YYYY-MM-DD sorts by date).
- In `oss_timeline_append`, after `oss_resolve_feature`: when `feature` is empty and the kind is `merge` or `merge-unknown`, call `_oss_tl_archived`, and if it resolves, set `feature` and `rec="$_OSS_TL_DIR/timeline.ndjson"`.

**Refactor:** one place builds `rec` from (feature, folder). The header comment at the top of `oss-timeline.sh` names the archived case.

**Acceptance:** Task 1 and Task 2 tests pass. `timeline-merge.test.sh` and `timeline-writer.test.sh` still pass.

### Task 3: Refusals stay unfiled and never push (B7 safety)
**Objective:** An unsafe or wrong archived folder never receives a line and never queues one.

**Tests to Write (RED step)** in `timeline-archived.test.sh`. In each case rc is 0, the line is in unfiled, no outbox entry is made, and the target outside is untouched:
- [ ] `should refuse a symlinked archived folder`: `completed/demo-2026-11-07` is a link to a folder elsewhere. The link is the newest, and an older real `demo-2026-11-01` is NOT used instead (B2-2).
- [ ] `should refuse a linked .oss/dev/completed`.
- [ ] `should refuse an archived timeline file with another hard link`.
- [ ] `should refuse an archived timeline file that is a symlink`.
- [ ] `should refuse an archived folder owned by someone else` (the `test -O` seam the other tests use).
- [ ] `should refuse a branch whose feature fails the name rule`: `feat/.demo/ship` with `completed/.demo-2026-11-07`.
- [ ] `should refuse a branch that is not <type>/<feature>/<phase>`: `main` with `completed/demo-2026-11-07` gives unfiled.

**Implementation (GREEN step):** `_oss_tl_archived` keeps the newest match only when `_oss_tl_real_dirs "$proj" "$_OSS_TL_DIR"` passes, the folder is owned (`test -O`), and `oss_single_link` holds for its `timeline.ndjson`. Anything else gives `""` (unfiled). `oss_safe_target` still runs after it in the writer, so a swap after the check is refused there.

**Acceptance:** all refusal tests pass. Nothing is written outside `$P`.

### Task 4: Every other kind is unchanged
**Objective:** Prove the fallback is merge-only (DESIGN: G1 and the other writers see no difference).

**Tests to Write (RED step)** in `timeline-archived.test.sh`, all with only `completed/demo-2026-11-07` present on `feat/demo/ship`:
- [ ] `should still file a gate line as unfiled`: through `oss-value.sh timeline gate` with valid value files.
- [ ] `should still file a command line as unfiled`: `oss_timeline_append command` sourced.
- [ ] `should still file an agent line as unfiled`: the PostToolUse hook with Agent JSON on stdin.
- [ ] `should leave oss_resolve_feature returning no feature`: a direct call gives `_OSS_FEATURE=""`.

These pass immediately if Task 2 is merge-only. They are regression guards, so write them before Task 2's GREEN if the builder can (they must stay green through it). Record any that never went red in TESTING.md as a guard.

**Implementation:** none beyond Task 2. **Acceptance:** green.

### Task 5: The decision approval reads the archived record (B8)
**Objective:** A decision recorded before the move still approves the merge after it.

**Tests to Write (RED step)** in `timeline-archived.test.sh`:
- [ ] `should accept a decision id recorded before the archive move`: `completed/demo-2026-11-07/decisions.ndjson` holds `$UUID`, and `approval.txt` = `decision:$UUID`. The result is rc 0 and one `merge` line in the completed file with `approval: {type: decision, decisionId: $UUID}`. Must FAIL today (refused: no active folder).
- [ ] `should still refuse an unknown decision id`: another uuid gives rc 1 and only a `merge-unknown` line, filed in the completed folder (B2-3) and absent from the outbox (P-2).
- [ ] `should refuse a decision record that is a symlink or has another hard link in the archived folder`: rc 1 and merge-unknown.

**Implementation (GREEN step):** in the merge verb, set `drec` from `oss_resolve_feature`, and when that is empty, from `_oss_tl_archived` (`$_OSS_PROJ/$_OSS_TL_DIR/decisions.ndjson`). Keep the existing `oss_is_regular`, `oss_single_link` and 1 MB checks.

**Acceptance:** the B8 tests pass, and the decision rows in `timeline-merge.test.sh` still pass.

### Task 6: No links on the way to decisions.ndjson (FOLLOWUPS #197)
**Objective:** The decision check never reads a record reached through a linked parent folder, whether active or archived.

**Tests to Write (RED step)** in `timeline-archived.test.sh`:
- [ ] `should refuse a decision when .oss/dev/active is a link`: `active` links to an outside folder holding `demo/decisions.ndjson` with `$UUID`. The result is rc 1 and merge-unknown. Must FAIL today (the read follows the link).
- [ ] `should refuse a decision when .oss/dev/active/demo is a link`: same shape.
- [ ] `should refuse a decision when .oss/dev is a link` (archived case).

**Implementation (GREEN step):** the decision read requires `_oss_tl_real_dirs "$_OSS_PROJ" "<the folder>"` before reading.

**Acceptance:** the three tests pass, and FOLLOWUPS #197 is closed by this task (already marked as pulled in).

### Task 7: A bot-style merger login leaves a local trace (FOLLOWUPS #186)
**Objective:** Confirm that a `mergedBy.login` outside the API pattern still leaves a merge in the timeline.

**Tests to Write** in `hooks/__tests__/timeline-merge.test.sh` (merge facts live there):
- [ ] `should write a local merge-unknown line with the PR number when gh reports a bot login`: gh answers MERGED with login `renovate[bot]`. The result is rc 0, one `merge-unknown` line with `pr: 4242` and no `mergedBy`, and no outbox entry.

**Expected:** the current code already maps facts outside the schema to merge-unknown (`oss-timeline.sh` merge verb, the `fields_ok("merge")` branch), so this may pass on first run. If it does, record it in TESTING.md as a guard test that never went red, with the reason. If it fails, fix with minimal code in the merge verb. **Acceptance:** green, and the result recorded.

### Task 8: Release 2.0.99 (B9)
**Objective:** Ship the plugin release that Phase C's C1 acceptance test needs.

**Steps:**
- [ ] Bump `.claude-plugin/plugin.json` to `2.0.99`, then run `/bin/bash hooks/__tests__/version-check.test.sh`.
- [ ] Regression, one file at a time: `timeline-archived`, `timeline-merge`, `timeline-writer`, `timeline-gate`, `timeline-push`, `timeline-delivery`, `timeline-bounds`, `timeline-kept`, `timeline-agent-hook`, `notify-timeline`, `timeline.acceptance`, `decision-record.acceptance`.
- [ ] `shellcheck hooks/oss-timeline.sh`, with no new warnings.
- [ ] Through `/oss:ship` (normal review rounds): PR from `feat/radical-observability-g2-b2/build` to main, then the tag `v2.0.99` per the usual release flow. The user's 2.0.97 release authority does not carry over (CLAUDE.md: approval in one context doesn't extend), so ask before merging or tagging.
- [ ] Tell the API session (Phase C) that 2.0.99 is out, so C1's merge assertions can run.

## Implementation Sequence
1. **Boundary:** Task 1 (RED).
2. **Guards:** Task 4 tests written (green, must stay green).
3. **Core:** Task 2, then Task 3 (depends on 2's helper).
4. **Decision check:** Task 5 (depends on 2), then Task 6 (depends on 5's read path).
5. **Independent:** Task 7 (any time; it touches only `timeline-merge.test.sh`).
6. **Release:** Task 8 last.

## Testing Strategy
### Unit / hook tests
- [ ] The resolution rule: newest wins, exact name shape, merge-only.
- [ ] Refusals: a link at any level, a hard link, a foreign owner, a bad name, a non-convention branch.
- [ ] The decision check: before and after the move, unknown ids, unsafe records, linked parents.
### Integration
- [ ] `oss-value.sh timeline merge` drives the whole path (value file, gh, writer, outbox).
- [ ] The API repo's C1 real-hooks test (Phase C) exercises 2.0.99 end to end. That is not run here.
### Edge cases
- [ ] Two archive folders, and a link as the newest one.
- [ ] Active and archived both present: active wins.
- [ ] A feature name that is a prefix of another archived feature.

## Security Checklist
- [ ] No value from a value file reaches a path or argv. The folder name comes only from the project's own branch and the glob.
- [ ] Every folder from the project root to the file is checked for links, read-only, before reading `decisions.ndjson` (#197). The writer still goes through `oss_safe_target`.
- [ ] Never-pushed rules are unchanged: unfiled (P-3), merge-unknown (P-2), push switch off (P-7).
- [ ] Hermetic tests: nothing touches the real `~/.oss`.

## Performance Considerations
- [ ] One extra glob and a few `stat`s, only on the merge verb, only when no active folder resolves. No change on the command, agent and gate paths.

## Rollout Strategy
- [ ] No feature flag: the change only acts after an archive move, which only Phase C's ship prompt does.
- [ ] Older plugins (2.0.98) keep filing the merge line unfiled (API PLAN B9 says Phase C still works there).
- [ ] Rollback: revert the PR. Archived lines already written stay local and are harmless.

## Estimated Tasks: 8
## Estimated Test Cases: 24
