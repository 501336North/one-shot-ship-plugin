# Requirements: phase-results (R-257, slice A)

Source: DESIGN.md (COMMITTED 2026-11-13), D1-D12.

## Actors
| Actor | Description |
|---|---|
| Developer | Runs /oss:ideate, plan, build and ship in a repo |
| Model | Runs the phase prompt; supplies only free text and plan's task list |
| Gate | Code that reads a phase result: `oss-notify complete`, the Stop dispatcher, archive and checkpoint, oss-lab lab-ship |
| Chained card | R-264 (claims) and R-265 (chain), which extend the result and the dispatcher |

## User Stories

### US-001: A phase passes only with a valid result (Must)
**As a** developer **I want** a phase to complete only when its result file exists and passes its schema **so that** a skipped or hollow phase cannot pass silently.
- **AC-001.1** Given no `results/<phase>.json`, when the model runs `oss-notify.sh --workflow <phase> complete`, then the command exits 1, the workflow state records `failed`, and no `CHAIN:` line is printed.
- **AC-001.2** Given a result with an unknown field, a wrong enum value, an over-long text field or a pattern mismatch, when `complete` runs, then it is refused and the message names the field and the command that rebuilds the result.
- **AC-001.3** Given a valid result, `complete` behaves as it does today: state is updated and the chain is printed.

### US-002: Results are built by code from evidence (Must)
**As a** gate **I want** each field built from evidence and labelled with its source **so that** the result is not merely the model's claim.
- **AC-002.1** Every field set by an assembler has `sources[field] = "code"`; model text has `"model"`.
- **AC-002.2** The model's text reaches the assembler only through value files written with the Write tool, never through shell arguments.
- **AC-002.3** Assembling an unchanged repo twice gives the same result, apart from `assembledAt`.

### US-003: Per-phase content (Must)
- **AC-003.1 ideate:**
  - decisions come from the `decisions.ndjson` records whose feature matches;
  - none matching is allowed: `decisions: []` with `decisionsRecorded: 0` (source code), so headless runs (R-267 benchmark, oss-lab cage) and chat-answered ideation still pass (D18);
  - planted records (not in the ledger) are excluded, not counted;
  - DESIGN.md without `Status: COMMITTED` fails with `design_not_committed`.
- **AC-003.2 plan:**
  - the model's `tasks[]` have unique ids and at least one test id each;
  - a duplicate id fails with `duplicate_task`;
  - a task without a test id fails with `task_without_test`.
- **AC-003.3 build:** from R-253's events for this build (`startedAt` equal to `currentCommandStartedAt`):
  - red then green passes;
  - green with no red fails with `no_red`;
  - no test events fails with `no_test_runs`;
  - a last result of red fails with `not_green`.
- **AC-003.4 ship diff:**
  - `diff.base` is the merge-base with the PR base branch;
  - the files, insertions and deletions come from git;
  - zero files changed fails with `empty_diff`, including on an already squash-merged branch.
- **AC-003.5 ship gates:** timeline gate lines for this feature, latest round, become `gates[]` with `source: "model"`. A missing gate line for a required gate fails with `gate_missing`.
- **AC-003.6 ship verdict:** when all gates pass and `blockers[]` is empty, the verdict is `ready_to_merge` and no other holder is named. Otherwise the verdict is `blocked` with `blockers[]` listing each.
- **AC-003.7 overrides:** each override holds `decisionId` and `person`, copied from the hook's record. An override whose decision id has no record fails with `override_unrecorded`.

### US-004: Session cannot end with a started phase and no result (Must; wired after R-266)
- **AC-004.1** Given a phase started this session with no valid result, the Stop dispatcher returns `{"decision":"block","reason":…}` naming the phase.
- **AC-004.2** Given a valid result, or no phase started, the stop is allowed and the existing notification runs.
- **AC-004.3** A check that throws or times out fails open but never looks like a pass. The stop is allowed, and:
  - (a) the phase is recorded as `verification: "unverified"` with `verificationError` (check id plus error class, no stack or free text), in the result or in a `<phase>.unverified.json` marker;
  - (b) the hook output carries a `systemMessage` the user sees, naming the phase and the check;
  - (c) a `stop-check-error` event is logged.

  There is one test for each of (a), (b) and (c).
- **AC-004.5** An `unverified` phase counts as not passed: `oss-notify complete` refuses it, the archive check doesn't archive it, and oss-lab's reader fails it. There is one test per reader.
- **AC-004.4** Checks run in a fixed order from one list, so R-265 adds one entry and nothing else.

### US-005: Decision records land in the right feature (Must, D10)
- **AC-005.1** When a picker is answered in a session whose start folder is not the repo, the record goes to the feature of the repo at the tool call's cwd (git toplevel).
- **AC-005.2** When the cwd is not inside a git repo, behaviour is unchanged.

### US-006: No decision site greps phase prose (Must, D7)
- **AC-006.1** `oss-archive-check.sh` and `healthchecks/archive.ts` decide "shipped" from `results/ship.json` (valid, verdict `ready_to_merge` or merged), not from PROGRESS.md.
- **AC-006.2** `checkpoint.sh` counts tasks from `results/plan.json` and `results/build.json`.
- **AC-006.3** `iron-law-log-parser.ts` is deleted (no importer).
- **AC-006.4** A provenance test lists the decision sites and fails if a PROGRESS.md `Current Phase` or `- [x]` grep is added to hooks/ or watcher/src.

## Edge Cases
| Scenario | Expected |
|---|---|
| `results/` or the result file is a symlink | Refused (`unsafe_path`), and the phase fails |
| Result over 256 KB, or a text field over 4000 characters | Refused (`too_large` / field named) |
| Schema file uses an unsupported keyword | Validator refuses to load it (`unsupported_keyword`), and the phase fails closed |
| Two assembles at once | Atomic rename; the last writer wins; the file is never half-written |
| Value file older than 10 minutes, or missing | Model text absent, so a required model field fails validation |
| No feature folder resolved | `complete` fails with `no_feature` |
| Events from an earlier build | Ignored (`startedAt` mismatch) |
| Old plugin prompt that never calls assemble | `complete` refuses (Sprint D branch only; R-267 decides warn vs block) |

## Non-Functional Requirements
- **Performance:**
  - Targets: `check` under 300 ms and `assemble` under 2 s on 10k events. They are measured by `watcher/scripts/bench-phase-result.mjs` (median of 5 runs), run by hand at build verify.
  - The tests assert deterministic stand-ins only: bytes read stay within the cap, node starts per call, no network calls, and loose hang ceilings (check <1.5 s, assemble <6 s).
  - On a turn with no phase in progress, the Stop hook starts no node process.
- **Security:**
  - no model value ever reaches a shell command;
  - paths are confined to the repo's `.oss/dev/active/<feature>/`;
  - the feature name matches `^[A-Za-z0-9._-]+$` and does not start with `.`;
  - redaction runs on free text before writing (shared redaction.ts).
- **Dependencies:** no new runtime dependency in watcher/package.json.
- **Testing:** only targeted watcher test files are run.

## Out of Scope
- Slice B (per-task green after the last production edit).
- Wiring hooks.json and the SubagentStop capture before R-266 merges.
- The R-264 verifier and R-265 chain enforcement.
- Metrics, test-monitor and oss-lab infra greps.
- Verifying a person's identity on records.

## Dependencies
- R-253's recorder: events.ndjson and cycle.json.
- oss-timeline gate lines.
- The decision hook's records.
- R-266 merging, for the hooks.json wiring.

## Open Questions
None open; D1-D12 settled them.

## Traceability
| US | Test (planned) | Code |
|---|---|---|
| US-001 | hooks/__tests__/oss-notify-phase-result.test.sh | hooks/oss-notify.sh, cli/phase-result.ts |
| US-002/003 | watcher/test/phase-results/assemble-*.test.ts | phase-results/assemble-*.ts |
| US-002 | watcher/test/phase-results/validate.test.ts, store.test.ts | validate.ts, store.ts |
| US-004 | watcher/test/stop/dispatcher.test.ts | stop/, hooks/oss-stop-dispatch.sh |
| US-005 | hooks/__tests__/oss-decision-record.test.sh | hooks/oss-decision-record.sh |
| US-006 | watcher/test/phase-results/provenance.test.ts | archive, checkpoint, healthchecks |
