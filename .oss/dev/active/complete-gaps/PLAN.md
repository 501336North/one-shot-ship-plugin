# Plan: complete-gaps

Last Updated: 2026-11-27 17:25 +07 by /oss:plan

## Summary
Three plugin-only fixes on Sprint D (no API change):
- **(a)** `build` uses the D84 archived-folder lookup.
- **(b)** `complete` passes a proven pre-upgrade run with a notice and an unverified mark (D3 narrowed by D6).
- **(c)** Watcher tests can never run with the real HOME (card 3, D5).

## Design Reference
DESIGN.md (COMMITTED), REQUIREMENTS.md (US-001, US-002, plus (c)), DECISIONS.md D1–D6 and ADR-1.

## Ground rules (owner and coordinator)
- Targeted tests only, each with a temp HOME. Never the full watcher suite, never `oss-notify-phase-result.test.sh`, never `setupFiles: []` with the real HOME.
- Don't depend on gate-discipline's gate-rounds code: it isn't merged.
- Every code task goes through /oss:build TDD with delegated builders. PRs go into feat/determinism-sprint/build only, and every merge needs its own owner pick.
- Existing tests are the contract. No task changes an existing test's expectations.

## Phase 0 note
Phase 0 would archive `ship-md-base-tests` (PROGRESS says "ship"). That is another session's feature (merged as #245), so I left it in place for its owner session to archive. This plan archives nothing.

## TDD Implementation Tasks

### Task 1: Acceptance tests (RED for all three) — /oss:acceptance
**Objective:** encode each gap at its boundary before any code.
**Tests (new file `hooks/__tests__/complete-gaps.acceptance.test.sh`; reuse `lib/archive-ship-fixture.sh` and the existing stubs, temp HOME per case):**
- [ ] (a) `should pass build complete on the branch after the archive commit` → build start, `assemble build`, `complete`: exit 0, the chain is printed, and `results/build.json` is in `completed/<F>-<date>/` (AC-001.1)
- [ ] (a) `should refuse build complete when the branch added no completed folder / two folders / a folder for another feature` → exit 1, the D85 hint, no chain (AC-001.2, AC-001.3)
- [ ] (a) `should still pass the ship re-run after the fix` → record-ready, merge, merged, complete (AC-001.5)
- [ ] (b) `should pass complete for a ship started before the phase-results marker` → workflow state with ship started before the marker, no run row, no results → `pr_created` writes `legacy/ship`, then `complete` exits 0 with the fixed notice, the unverified marker and the chain (AC-002.0, AC-002.1)
- [ ] (b) `should pass legacy complete after merged reset the workflow state` (D6 timing)
- [ ] (b) `should refuse complete when the model skipped start on a new feature` → current command is not ship, or started after the marker → no legacy row, exit 1 (D6)
- [ ] (b) `should refuse legacy complete when results exist in the repo or the ledger` (AC-002.2)
- [ ] (b) `should refuse when a run row follows the legacy row` (AC-002.4)
- [ ] (b) `should not report verified on check after a legacy pass` (AC-002.3)
**Acceptance:** every case fails for the right reason before Tasks 2–6.

### Task 2: (a) Archived lookup for build
**Tests (RED), new `watcher/test/phase-results/build-archived.test.ts`:**
- [ ] `should resolve the archived folder for build when no active folder exists`
- [ ] `should not run the archived lookup for ideate or plan`
- [ ] `should never call the merge proof or record-ready on the build path` (mock the gh/merge-ready collaborator at its interface)
**GREEN:** in `watcher/src/cli/phase-result.ts` `main()`, change `args.phase === 'ship'` to ship or build for the lookup only. The `--record-ready`, `mergedOrRefuse` and D86 5c branches stay `ship`-only. Rebuild `watcher/dist/cli/phase-result.cjs`.
**REFACTOR:** name the phase set (`ARCHIVED_PHASES`) if it reads better.

### Task 3: (b) The one-time `phase-results-since` marker
**Tests (RED), in the acceptance file plus a hooks unit test `hooks/__tests__/legacy-since-marker.test.sh`:**
- [ ] `should write ~/.oss/ledger/phase-results-since once with the current UTC time` (dir 700, file 600)
- [ ] `should never rewrite an existing marker`
- [ ] `should refuse a linked or foreign-owned marker and write nothing` (fail closed: not legacy)
**GREEN:** `_oss_since_marker` in `hooks/oss-notify.sh`, called on every oss-notify run before the gates. Use the same folder checks as `_oss_ledger_run`.

### Task 4: (b) Record `legacy/<phase>` at the first non-start event
**Tests (RED):** the AC-002.0 cases, including the skipped-start and post-marker refusals.
**GREEN:** `_oss_ledger_legacy <phase>` runs on non-start events. It needs: no `run/<phase>` row; workflow state `currentCommand == phase` with `currentCommandStartedAt < marker`; no repo and no ledger results (`_oss_ledger_has_results`). It then appends `{startedAt, feature}` once per startedAt. The feature comes from `oss_resolve_feature`, never from a model value.

### Task 5: (b) Legacy branch in the complete gate
**Tests (RED):** the AC-002.1–002.5 cases.
**GREEN:** in the complete gate, before `_oss_phase_check`, pass when there is a `legacy/<phase>` row with no later `run/<phase>` row and no results. Print the fixed notice (`no phase results for <feature>: started before phase results; complete passes unverified`), write the ledger `unverified/<feature>/<phase>` marker (ADR-1 layout), log one timeline line, and go on to the chain. With feature `""`, print the notice and write no marker.

### Task 6: (c) Real-HOME guard for watcher vitest
**Tests (RED), new `watcher/test/guard/real-home.test.ts` (pure function, no real HOME touched):**
- [ ] `should replace HOME with a fresh temp dir when HOME is the passwd home` (`os.userInfo().homedir`, compared after realpath)
- [ ] `should throw before any test runs when HOME still resolves to the passwd home after setup`
- [ ] `should keep an already-temp HOME`
**GREEN:** add `watcher/test/global-setup.ts` and `globalSetup: ['./test/global-setup.ts']` in `vitest.config.ts`. It sets the temp HOME in the main process before any fork starts, so forks inherit it even with `setupFiles: []`. `test/setup.ts` stays as it is.
**Note:** a custom config file can still bypass this. The clean-copy rule (use the repo's own config) stays in memory; FOLLOWUPS card 3 gets the bypass noted.

### Task 7: Docs
- [ ] FOLLOWUPS: mark cards 1–3 as taken by complete-gaps, and note card 3's custom-config limit.
- [ ] TESTING.md: the targeted commands and results.

## Implementation Sequence
1. Task 1 (acceptance, RED)
2. Task 2 (a), independent of the rest
3. Task 3, then Task 4, then Task 5 (b), each depending on the one before
4. Task 6 (c), independent
5. Task 7

## Testing Strategy
- **Unit:** build-archived.test.ts and real-home.test.ts, run with `npx vitest run <file>` from watcher/ under the repo config (temp HOME via setup.ts).
- **Shell:** `bash scripts/run-shell-tests.sh hooks/__tests__/complete-gaps.acceptance.test.sh hooks/__tests__/legacy-since-marker.test.sh`, plus the existing `phase-results.acceptance.test.sh` as the regression check for D84–D88.
- **Edge cases:** linked or foreign marker; ledger missing; feature unresolved; past the 9 s deadline (DIFF_TIMEOUT); a branch off main after the merge.

## Security Checklist
- The legacy decision is made from ledger and workflow-state facts only. No model-written value goes into a command or a row (feature names are checked against `^[A-Za-z0-9._-]+$`).
- The marker and rows use owner-only dirs, links are refused, and any doubt fails closed (not legacy).
- Known limit, for the owner to judge at the gates (never deferred by me): workflow-state.json is user-writable, so a model that hand-edits `currentCommandStartedAt` to a time before the marker could fake legacy. The bar is the same as other same-user state. It still marks the phase unverified.

## Performance Considerations
At most two extra small ledger reads per oss-notify call, well inside the 10 s watchdog.

## Rollout Strategy
Plugin PR into Sprint D only. The marker is written at the first oss-notify call after the plugin update.

## Estimated Tasks: 7
## Estimated Test Cases: 21
