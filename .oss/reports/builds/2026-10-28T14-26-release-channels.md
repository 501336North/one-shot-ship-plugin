# Build Report: release-channels (ship round 5, UR17)
**Generated:** 2026-10-28T14:26+08:00 (CST) | **Status:** DRAFT
**Branch:** feat/release-channels/ship

Delta report on top of `2026-10-28T12-07-release-channels.md` (round 4), which holds the full-branch
design rationale, decisions, import graph and coverage map. Nothing in those sections changed in this round.

## What Changed?

### Files Modified (cac7440..HEAD)
| Type | File |
|---|---|
| M | watcher/test/skills/workflows.test.ts |
| M | .oss/dev/FOLLOWUPS.md |
| M | .oss/dev/active/release-channels/PLAN.md (UR17 task) |
| M | .oss/dev/active/release-channels/PROGRESS.md |
| M | .oss/dev/active/release-channels/TESTING.md |
| M | LEARNINGS.md |

Whole branch vs origin/next: 328 files (see the round-4 report).

### Tests Added/Updated
- 1 stale test replaced by 2: the workflows skill fetches through `oss-value.sh api workflows` / `api workflow`
  (whole-line), and inlines no raw `/api/v1/`, Bearer header, `{apiKey}` or `grep apiKey`.
- RED against the pre-T7 `commands/workflows.md` (2 failed); 4 mutations, each killed.
- Full watcher suite (safe config): 259 files, 3675/3675; tsc clean.

### Database Changes
None.

## Why Was It Built This Way?

### Design Rationale
T7 moved every keyed command fetch behind `oss-value.sh api ...` so the key reaches curl on stdin and the
address follows the trusted `apiUrl` (ADR-005). The command file was correct; the test asserted the pre-T7
contract and stayed red for three rounds because each round ran only part of the watcher suite.

### Key Decisions
- Round-5 rule (maintainer): CRITICAL/HIGH/MEDIUM block; LOW/INFO go to FOLLOWUPS and the PR description.
  Pentest, performance and security passed; code review's one MEDIUM became UR17.
- IRON LAW #1b grep: no other test asserts a raw API path in a T7-moved command file.

## What Else Does It Affect?

### Downstream Consumers (Import Graph)
None: a test file only, no source change.

### Test Coverage Map
| File Changed | Tests Covering It | Coverage |
|---|---|---|
| commands/workflows.md (unchanged, now asserted correctly) | watcher/test/skills/workflows.test.ts | guarded (4 mutations killed) |

### Uncovered Risk Areas
- Recorded in FOLLOWUPS (round 5): the `\p{Cf}` shell table member and the `.iron-laws-verified` symlink refusal
  have no killing test; the shim log's 188 refused production requests have no proven source (HIGH).
