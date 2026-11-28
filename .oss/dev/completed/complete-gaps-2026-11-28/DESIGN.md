# Feature: complete-gaps

Status: COMMITTED

Last Updated: 2026-11-27 16:45 +07 by /oss:ideate

## Problem

FOLLOWUPS cards 1 and 2 (from phase-results, R-257) were filed as blockers for Sprint D→main after two `complete` refusals: R-257's own `ship complete` ("missing results/ship.json") and R-266's ("no_run_started"). Ideate found the cause of both: a **mixed install**. On 2026-11-24 16:36 a clean-copy test run copied R-257's hooks into the real `~/.oss/hooks` (oss-phase-result.sh, oss-node.sh, oss-statusline-settings.sh, and a gated oss-notify.sh). Every session then ran R-257's `complete` gate while the 2.2.x wrapper and the main-served prompts, which never run `assemble`, were still in use. That lasted until the 2.2.4 hook refresh on 2026-11-27 16:12. Three leftover files are still there; they are on hold until the owner decides.

With a consistent Sprint D install, archive → merge → `merged` → `complete` already works (D78, D84–D88, covered end to end by `hooks/__tests__/phase-results.acceptance.test.sh` cases 13a–13f). Two real gaps remain (owner pick "Narrow to (a)+(b)"):

- **(a) Fix round after the archive.** The served ship Step 6 archives the dev docs before the merge. If the merge test then fails, the fix goes through `/oss:build` on the same branch, but `build complete` refuses `no_feature`, because the D84 archived-folder lookup in `watcher/src/cli/phase-result.ts` `main()` runs only for `ship`.
- **(b) A phase in flight across the plugin upgrade.** A run started under a pre-R-257 plugin has no `run/<phase>` ledger row. When it reaches `complete` under Sprint D, assemble refuses `no_run_started` and `complete` refuses: a dead end with no legitimate way out.

## Solution

- **(a)** `build` gets the same archived-folder lookup as `ship`: no active feature, and the branch's own diff (from assemble's base) added exactly one `.oss/dev/completed/<F>-<date>/` folder whose `<F>` matches the branch name → assemble and check `build` there (`where.kind = 'completed'`). Every D84/D85/D86 rule carries over unchanged: same base, the snapshot, the one folder, the name match, the refusals and hints, and the deadline.
- **(b)** At `complete`, a phase whose run is **legacy** passes with a one-line D17-style notice, and the phase is recorded as **unverified** (owner pick "Pass + mark unverified"). Legacy means all three hold: there is no `run/<phase>` row in the ledger; the feature has no `results/` entry in the repo; and the feature has no ledger `results/<feature>` entry. These are the same results tests D17 uses at start, plus the missing run row. The chain then runs. The unverified record uses the existing ledger `unverified/<feature>/<phase>` marker that the Stop dispatcher writes (ADR-1), so the timeline and the team view show it as unverified, never as verified. **Narrowed by D6:** the run must also be proven pre-upgrade by a `legacy/<phase>` ledger row, recorded at the run's first non-start event when its workflow-state start time is older than the one-time `phase-results-since` marker.

## Approach

- (a): in `phase-result.ts` `main()`, widen the archived lookup's `args.phase === 'ship'` condition to `ship` and `build`. The ship-only parts stay ship-only: `mergedOrRefuse`'s merge proof, `--record-ready`, and D86 5c's "an archived re-run's complete always runs the merge proof". `build` in a completed folder needs no merge proof, because build never merges. The `oss-notify` start gate already treats an unresolved feature as legacy and prints the notice; assemble's own start gate (pen N1) re-applies the `plan` check in the completed folder.
- (b): the decision belongs in the complete gate in `hooks/oss-notify.sh`, before it calls `check`. It reads the run row (`_oss_ledger_*`) and the results tests (`_oss_ledger_has_results`, the repo `results/` path). It never trusts a model-written value. When the run is legacy: print the notice, write the unverified marker, and continue as a pass.
- No served-prompt (API) change; plugin only.

## Components

- `watcher/src/cli/phase-result.ts`: the archived lookup is widened to build.
- `hooks/oss-notify.sh`: the complete gate's legacy branch, the notice and the unverified marker.
- Tests: `hooks/__tests__/phase-results.acceptance.test.sh` gets new cases; targeted watcher tests cover the lookup.

## Success Criteria

- [ ] On a branch whose archive commit added `completed/<F>-<date>/`, `/oss:build` (start, then assemble build, then complete) passes, and the result is written in that completed folder.
- [ ] `build complete` with zero or 2+ added completed folders, or a folder `<F>` that doesn't match the branch, refuses with the same D85 hints as ship.
- [ ] A phase with no run row and no results anywhere passes `complete` with the notice. The unverified marker exists, and a later `check` of that phase still fails (it never reads as verified).
- [ ] A phase with no run row but with results in the repo or the ledger still refuses `no_run_started`. Deleting `results/` doesn't help, as with D17.
- [ ] Every existing D84–D88 acceptance case still passes.

## TDD Test Plan

- [ ] Acceptance (shell, temp HOME): the full Sprint D flow, then a merge-test failure after the archive commit, then a fix through build start, assemble, complete, then the ship re-run with record-ready, merge, merged and complete. All pass.
- [ ] Acceptance: legacy in flight. Write a pre-R-257 state (no run row, no results), send `complete` → it passes, the notice text is fixed, the unverified marker is written, and the chain is printed.
- [ ] Acceptance: not legacy. No run row, but `results/` or ledger results exist → refuses with exit 1 and no chain.
- [ ] Unit (watcher): the archived lookup runs for build and not for ideate or plan, and the build path never calls the merge proof.

## Out of Scope

- Changing when the served ship step archives (it stays before the merge: one PR per feature).
- A legacy path for `ideate` and `plan` beyond what (b)'s rule gives every phase. The rule is phase-generic and costs nothing extra.
- The three leftover files in `~/.oss/hooks`: held for the owner's answer through OSS DETERMINISTIC.
- ~~A guard so that no test or clean-copy run can write into the real `~/.oss`.~~ Moved into scope by D5 (owner pick "Add card 3", 2026-11-27): see **(c)** below.

## (c) Real-~/.oss write guard (card 3, D5)

A watcher vitest run, or a clean-copy run, must refuse to start when the HOME it would use is the real home, whose `.oss` is the real `~/.oss`. This is a globalSetup check that fails before any test file runs. The goal is that hooks, config and ledger can never be written by tests. /oss:plan settles the exact check (how "real home" is detected without trusting HOME itself, for example the passwd home from `os.userInfo()` compared to `HOME`) and where the guard applies (watcher vitest config, hooks shell test runner).
- gate-discipline's gate-round code: not merged, and its design is being redone, so nothing here depends on it.

## Stress Test

- **Security/abuse (Technical Debt):** (b) is a pass without a result. As first designed, a model could skip `start` on a new feature and pass. A heads-up caught this, and the owner then picked D6, "Only pre-upgrade starts": a legacy pass needs a `legacy/<phase>` ledger row, recorded only for a run whose start is older than the one-time `phase-results-since` marker. A skipped start is refused.
- **Feasibility:** (a) reuses D84's lookup as it is. The risk is that ship-only assumptions (merge proof, record-ready) leak into build. The unit test asserts that the build path never calls them.
- **UX friction:** after the archive, a fix round prints the D17 notice at start ("no phase results for this project") because `oss-notify`'s resolver only sees `active/`. Accepted for now: assemble still applies the plan check, and complete still checks the result.
- **Root cause (Technical Debt):** the mixed install came from a test run writing into the real home. It isn't fixed here; card 3 covers it.

No overrides; no dissent records.
