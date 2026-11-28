# Requirements: complete-gaps

Last Updated: 2026-11-27 16:55 +07 by /oss:requirements (from DESIGN.md)

## Overview
Close the two real `complete` gaps left by phase-results (R-257): (a) a build fix round after the archive commit, and (b) a phase in flight across the plugin upgrade to Sprint D.

## Actors
| Actor | Description |
|-------|-------------|
| Developer (via the model) | Runs /oss:build and /oss:ship on a feature branch |
| OSS hooks | `oss-notify.sh` complete gate, `oss-phase-result.sh` CLI |
| Team view / timeline | Shows each phase as verified or unverified |

## User Stories

### US-001: Fix round after the archive
**As a** developer whose merge test failed after the ship archived the dev docs
**I want** `/oss:build` on the same branch to start, assemble and complete
**So that** I can fix the code and re-run the ship without a dead end
**Priority:** High

**AC-001.1:** Given a branch whose own diff (from assemble's base) added exactly one `.oss/dev/completed/<F>-<date>/` with `<F>` matching the branch's feature, and no `.oss/dev/active/<F>/`, when build is started, assembled and completed, then assemble writes `results/build.json` in that completed folder, and `complete` exits 0 and prints the chain.
**AC-001.2:** Given zero added completed folders, or two or more, when `assemble build` or `complete` runs, then it refuses `no_feature` with the same fixed D85 hint as ship, and prints no chain.
**AC-001.3:** Given an added folder whose `<F>` does not match the branch name, then the same refusal is given (D85 name match).
**AC-001.4:** On the build path, no GitHub call is made: no merge proof, and no `--record-ready`.
**AC-001.5:** The ship re-run after the fix still passes through D84–D88 (record-ready, merge, merged, complete) with no change.

### US-002: A phase in flight across the upgrade
**As a** developer whose phase started under a pre-R-257 plugin
**I want** `complete` to pass with a clear notice
**So that** the upgrade leaves no dead end, and nobody mistakes the phase for a verified one
**Priority:** High

**AC-002.0 (D6):** Given the workflow state's current command is this phase with `currentCommandStartedAt` before the ledger `phase-results-since` marker, no `run/<phase>` row and no results, when the run's first non-start event (`quality_passed`, `pr_created`, `merged`, `task_complete` or `complete`) reaches oss-notify, then a ledger `legacy/<phase>` row is appended. Given a start after the marker, or a current command that is not this phase (a skipped start), no row is written, and `complete` refuses as today.
**AC-002.1:** Given a `legacy/<phase>` row (D6) with no later `run/<phase>` row in the ledger, no `results/` entry for the feature in the repo, and no ledger `results/<feature>` entry, when `oss-notify --workflow <phase> complete` runs, then it exits 0, prints one fixed notice line, writes the ledger `unverified/<feature>/<phase>` marker and prints the chain.
**AC-002.2:** Given the same, but with a repo `results/` entry or a ledger results entry for the feature, then `complete` still refuses (exit 1, no chain), as today.
**AC-002.3:** Given a legacy pass, a later `oss-phase-result.sh check <phase>` still does not report verified.
**AC-002.4:** Given a run row exists (a normal Sprint D run) with no valid result, then `complete` refuses as today: the legacy branch never applies.
**AC-002.5:** The notice and the marker contain no model-written values: the feature name comes from the resolver and is checked against `^[A-Za-z0-9._-]+$`.

## Edge Cases
| Scenario | Expected |
|----------|----------|
| Feature unresolved (no active folder, no branch feature) at a legacy complete | Notice names "this project"; no marker (there is no feature to bind it to); passes as D17 does at start |
| Ledger folder missing, linked or not owned | Not legacy (fail closed): refuse as today |
| results/ deleted to look legacy | The ledger results entry still blocks it (D17 rule) |
| build after archive on a new branch (fix/<F>/build off main) | No folder added by this branch → no_feature refusal with the D85 hint |
| Archived lookup past the 9 s deadline | DIFF_TIMEOUT, as for ship |

## Non-Functional
- No served-prompt (API) change; plugin only.
- Targeted tests only, always with a temp HOME. Never the full watcher suite, and never oss-notify-phase-result.test.sh.
- `complete` stays inside the hook's 10 s watchdog.
