# Implementation Plan: phase-results (R-257, slice A)

## Summary
Each phase ends with a JSON result built by code from evidence and checked against a JSON Schema. A missing, malformed or `unverified` result fails the phase: `oss-notify complete` refuses and no chain fires. The plan also adds a Stop dispatcher (built now, wired after R-266) and removes the prose greps at decision sites.

## Design Reference
DESIGN.md (COMMITTED), REQUIREMENTS.md (US-001 to US-006), DECISIONS.md (SD-1, SD-2, D1-D13, ADR-1).

## Ground rules for build
- **Branches:**
  - plugin: `feat/phase-results/build`, branched from `origin/feat/determinism-sprint/build`;
  - API: `feat/phase-results/build`, from the API's Sprint D branch;
  - oss-lab: a new Sprint D branch from `origin/main`, created only after telling the coordinator.

  PRs target `feat/determinism-sprint/build` only (SD-1).
- **R-266's files are not touched (SD-2):** `hooks.json`, `oss-value.sh`, `oss-tool-gate.sh`, `oss-gate-run.sh`, `config/tool-gates.json`, `watcher/src/tool-gate/**`, `watcher/src/gate-run/**`. R-253's state files are **read** through their documented file format: `state-store.ts` types may be imported, never edited.
  - `watcher/scripts/bundle-cli.js` imports R-266's tool-gate bundle options. Adding the phase-result bundle there is an additive change, and the coordinator is told before T9.
- **Tests:**
  - only targeted files: `cd watcher && npx vitest run <files>`, and `bash hooks/__tests__/<file>.sh`;
  - never the full watcher suite;
  - hermetic temp repos (`git init` in a mktemp dir) with fixture files;
  - no network.
- **Repo resolution:** every new entry point resolves the repo from the **physical cwd's git toplevel**, never from `CLAUDE_PROJECT_DIR` (D10's root cause, `hooks/oss-safe-path.sh:140`).
- **Values:** model text reaches the CLI only through value files in the `oss-value.sh dir` folder, written with the Write tool. No value ever goes into a shell argument.
- **New decision D13 (2026-11-13, picker):**
  - only a valid `results/ship.json` archives a feature;
  - features with no `results/` dir are never auto-archived;
  - plan prints one line listing them.

---

## Phase 1: Foundation (watcher)

### Task 1: Keyword-subset JSON Schema validator
**Objective:** validate a value against a schema without any new dependency (D5).
**Tests (RED)**, file `watcher/test/phase-results/validate.test.ts`:
- `should accept a value matching type/required/properties/enum/pattern/maxLength/maxItems/items` (one pass row per keyword).
- `should reject with the JSON path of the field for each keyword violation` (one fail row per keyword; the error names `$.diff.base`, etc.).
- `should reject an unknown property when additionalProperties is false`.
- `should resolve $ref to the common schema`.
- `should refuse to load a schema that uses an unsupported keyword` (`oneOf`, `if`, `format`), giving `unsupported_keyword`.
- `should treat pattern as a full-string match and refuse patterns over 200 chars` (ReDoS cap).

**Implementation (GREEN):** `watcher/src/phase-results/validate.ts`:
- `loadSchema(json): Schema`, which throws `unsupported_keyword`;
- `validate(schema, value): {ok: true} | {ok: false, path: string, rule: string}`.

**Acceptance:** all rows pass; no new entry in `watcher/package.json`.

### Task 2: Phase result schemas (single source)
**Objective:** one JSON Schema per phase, with room for claims[] and chain[], and the `verification` field.
**Tests (RED)**, file `watcher/test/phase-results/schemas.test.ts`, with fixtures in `watcher/test/fixtures/phase-results/`:
- For each of ideate, plan, build and ship: `should accept the valid fixture` and `should reject` an unknown field, a wrong enum, an over-long text field (>4000) and a missing required field.
- `should require verification in {verified, unverified}`, plus `verificationError` when unverified.
- `should cap claims[] at 100 and accept label VERIFIED|REFUTED|UNVERIFIABLE`.
- `should accept chain[] entries {command, ranAt, initEventId}`.
- `should require ship.diff {base: 40-hex, files, insertions, deletions}` and `verdict in {ready_to_merge, blocked}`.

**Implementation (GREEN):** `schemas/phase-results/{common,ideate,plan,build,ship}.schema.json`, loaded through T1.

### Task 3: Result store (atomic, confined, capped)
**Objective:** read and write `results/<phase>.json` safely.
**Tests (RED)**, file `watcher/test/phase-results/store.test.ts`:
- `should write atomically` (temp file then rename; a concurrent reader never sees partial JSON).
- `should refuse when results/, the file or any parent under .oss is a symlink` (`unsafe_path`).
- `should refuse a feature name outside ^[A-Za-z0-9._-]+$ or starting with "."` (`bad_feature`).
- `should refuse a result over 256 KB` (`too_large`).
- `should resolve the repo from the physical cwd's git toplevel even when CLAUDE_PROJECT_DIR points elsewhere`.
- `should read a FIFO or non-regular results file as unsafe, not hang`.

**Implementation (GREEN):** `watcher/src/phase-results/store.ts`: `resolveRepo(cwd)`, `writeResult(repo, feature, phase, obj)`, `readResult(...)`, with `O_NOFOLLOW` / `lstat` checks matching `safe-project-write.ts`.

---

## Phase 2: Assemblers (code-assembled results)

### Task 4: Assemble build from R-253's recorder
**Tests (RED)**, file `watcher/test/phase-results/assemble-build.test.ts`, with fixture `.oss/tool-gates/events.ndjson` and `cycle.json`:
- red then green for this build gives `verification: verified`, `testRuns.sawRed: true`, `lastResult: green`, all `source: code`.
- green with no red fails with `no_red`.
- no test-run events fails with `no_test_runs`.
- last result red fails with `not_green`.
- events with another `startedAt` (an earlier build) are ignored.
- events.ndjson over 10k lines is read in a bounded way (tail cap) within the perf budget.

**Implementation:** `assemble-build.ts`, which reads through `CycleRecord` / `GateEvent` types imported from `tool-gate/state-store.ts`, read-only. Optional model `notes` come from the value file.

### Task 5: Assemble plan from the model's task file
**Tests (RED)**, file `assemble-plan.test.ts`:
- a valid `tasks.json` value file `[{id, title, testIds[≥1]}]` gives tasks with `source: model`.
- a duplicate task id fails with `duplicate_task`.
- a task without a test id fails with `task_without_test`.
- a missing or stale (>10 min) value file fails with `no_tasks`.

**Implementation:** `assemble-plan.ts`.

### Task 6: Decision hook: repo resolution, FIFO guard, private id ledger (D10, FOLLOWUPS 305, 184, 192)
**Tests (RED)**, file `hooks/__tests__/oss-decision-record.test.sh` (new cases only; existing cases are unchanged):
- `should file the record under the worktree feature when CLAUDE_PROJECT_DIR is the session start folder and the hook input cwd is in the worktree`.
- `should keep today's behaviour when the input cwd is not in a git repo`.
- `should not hang when workflow-state.json is a FIFO` (bounded; the command is ""). Closes FOLLOWUPS 184.
- `should append each written record id to the owner-only ledger ~/.oss/ledger/<key>/decisions/<feature> (rows {id, feature, sha256(line)})` (mode 600, dir 700, link refused).

**Implementation:** `hooks/oss-decision-record.sh`:
- use the `.cwd` of the hook input, resolved to its git toplevel with `.oss`, before `oss_resolve_project`;
- use `oss_is_regular` for `ws`;
- append ids to the ledger.

**Note:** the shared `oss_resolve_project` (`oss-safe-path.sh:139`) is **not changed**. The cwd-first resolution is local to `oss-decision-record.sh`. The wider misfiling in oss-timeline, oss-notify, oss-log, oss-precommand, oss-archive-check and oss-value is a separate FOLLOWUPS entry, out of scope.
- Regression row: `oss_resolve_project still returns CLAUDE_PROJECT_DIR for other callers`. The existing `timeline-*.test.sh` and `oss-notify-*.test.sh` run unchanged and green, which proves the timeline path didn't move.

### Task 7: Assemble ideate from decision records
**Tests (RED)**, file `assemble-ideate.test.ts`:
- records whose `feature` matches **and** whose id is in the private ledger become `decisions[]` with `source: code`.
- a planted record (repo file only, id not in the ledger) is excluded.
- no matching records gives a valid result with `decisions: []` and `decisionsRecorded: 0` (D18: headless and chat-answered ideation pass).
- only planted records (not in the ledger) gives `decisionsRecorded: 0`, never a failure and never counted.
- DESIGN.md without the `Status: COMMITTED` line fails with `design_not_committed` (an exact line match `^Status: COMMITTED$`, a single fixed token, not a prose grep).
- `openQuestions[]` come from the value file, with `source: model`.

**Implementation:** `assemble-ideate.ts`.

### Task 8: Assemble ship (diff, gates, overrides, verdict)
**Tests (RED)**, file `assemble-ship.test.ts`, with a temp git repo with a base branch:
- `diff.base` equals the merge-base with the base branch, and files/insertions/deletions match `git diff --numstat`.
- base equals head gives `empty_diff`; an already squash-merged branch (tree equal to base) gives `empty_diff`.
- the latest-round timeline gate lines for the feature become `gates[]` with `source: model`.
- a required gate missing gives `gate_missing`.
- all gates passing with no blockers gives `verdict: ready_to_merge` and `blockers: []`, and nothing else is named.
- a failing gate gives `verdict: blocked` with the blocker listed.
- an override with a decisionId in the private ledger copies `person` from the record. An id that is only in the repo file gives `override_unrecorded`. Closes FOLLOWUPS 192 for results.
- a free-text `summary` is redacted through the shared redaction.

**Implementation:** `assemble-ship.ts`. Git runs with `GIT_*` env unset and fixed argv (no shell).

---

## Phase 3: Boundary (CLI, complete gate, Stop dispatcher, commands)

### Task 9: phase-result CLI and shell entry
*(Tell the coordinator first: this is an additive edit to `watcher/scripts/bundle-cli.js`.)*
**Tests (RED)**, file `watcher/test/cli/phase-result.acceptance.test.ts` and `hooks/__tests__/oss-phase-result.test.sh`:
- `assemble <phase>` writes a valid result and exits 0. On failure it exits 1, writes nothing, and the stderr reason names the rule.
- `check <phase>` exits 0 for valid+verified, and exits 1 for missing, malformed or `unverified`, naming the field and the rebuild command.
- an unknown phase name gives exit 2 and usage.
- `check` takes under 300 ms and `assemble` under 2 s on the 10k-event fixture.
- the shell entry passes no model value as an argument (provenance assertion on the script text).
- `bundle-cli.js still builds every bundle`: after `npm run build:cli-bundle` in a temp copy, `dist/cli/{chain-trigger,oss-launch,tool-gate,phase-result}.cjs` all exist and each loads with `node -e require(...)`. The entry is additive and rebased after R-266 merges (coordinator OK, 2026-11-13).

**Implementation:**
- `watcher/src/cli/phase-result.ts`;
- `watcher/scripts/phase-result-bundle-options.mjs` and one entry in `bundle-cli.js`;
- `hooks/oss-phase-result.sh`, which resolves the node CLI like `oss-notify.sh resolve_cli`.

### Task 10: oss-notify complete refuses an invalid result (US-001; closes FOLLOWUPS 26)
**Tests (RED)**, file `hooks/__tests__/oss-notify-phase-result.test.sh`:
- for each of ideate, plan, build and ship: no result means exit 1, workflow state `failed` (supervisor intervening), no `CHAIN:` on stdout, and the reason names the phase and the command.
- a malformed result is refused with the field named.
- an `unverified` result is refused.
- a valid result keeps today's behaviour (state updated, chain printed): the existing `oss-notify-complete-bounds` and `oss-notify-updates` tests stay green and unchanged.
- non-phase commands (requirements, adr, …) are unaffected.

**Implementation:** `hooks/oss-notify.sh`, in the `complete)` branch: for ideate|plan|build|ship, run `oss-phase-result.sh check "$WORKFLOW_CMD"` first. On a non-zero exit, take the failed path and `exit 1`.

### Task 11: Stop dispatcher with fail-open that never looks like a pass (ADR-1; not wired)
**Tests (RED)**, file `watcher/test/stop/dispatcher.test.ts` and `hooks/__tests__/oss-stop-dispatch.test.sh`:
- a started phase with no valid result gives `{"decision":"block","reason}` naming the phase and the assemble command.
- a valid result, or no phase started, allows the stop and runs the notification (`oss-stop.sh` behaviour).
- the checks run in a fixed list order, and a second fake check is reached only when the first allows (the R-265 extension point).
- **a check that throws or times out** allows the stop, AND (a) records `verification: "unverified"` plus `verificationError {check, errorClass}` in the result or in a `<phase>.unverified.json` marker; AND (b) the stdout JSON carries a `systemMessage` naming the phase and the check; AND (c) a `stop-check-error` event is logged. That is one test each.
- a `stop_hook_active: true` input does not block twice in a row for the same phase (loop guard).

**Implementation:** `watcher/src/stop/{dispatch,checks/phase-result-missing}.ts`, `hooks/oss-stop-dispatch.sh`. **No hooks.json change** (T18).

### Task 12: Command wrappers call assemble before complete
**Tests (RED)**, file `commands/__tests__/phase-result-step.test.sh`:
- `commands/{ideate,plan,build,ship}.md` each contain an "Assemble the phase result" step before the `complete` step, telling the model to write value files with the Write tool, then run `~/.oss/hooks/oss-phase-result.sh assemble <phase>` exactly.
- the keyword-based match (not exact phrases, per FOLLOWUPS 212's lesson).

**Implementation:** add the step to the four wrappers.

---

## Phase 4: Remove prose greps at decision sites (US-006, D7, D13)

### Task 13: oss-archive-check.sh reads results/ship.json (+ FOLLOWUPS 30, 40)
**Tests (RED)**, file `hooks/__tests__/oss-archive-check.test.sh`:
- a feature with a valid, verified ship result (`ready_to_merge` or merged) is archived.
- PROGRESS.md saying `Current Phase: ship (merged)` with no results/ dir is **not** archived, and is listed once in a "no phase result, move by hand" line (D13).
- an `unverified` or invalid ship result is not archived.
- two archivable features under bash 5 with `set -e` are both archived (FOLLOWUPS 30, `archived_count=$((archived_count + 1))`).
- a symlink at the archive destination is not followed when choosing a free name (FOLLOWUPS 40, `-e || -L`).

**Implementation:** replace the patterns at :89-110 with `oss-phase-result.sh check ship`; fix :181/183 and :220.

### Task 14: Healthcheck reads results
**Tests (RED)**, file `watcher/test/healthchecks/archive.test.ts` (new cases):
- a valid ship result gives a "completed, not archived" issue; PROGRESS.md prose alone gives no issue; an unverified result gives no issue.

**Implementation:** `healthchecks/archive.ts` uses `readResult` and `validate`.
**⚠ changes existing test (marked at build, 2026-11-13):** `watcher/test/healthchecks/archive.test.ts` has six "should detect ship/SHIP/complete/COMPLETE/(COMPLETE)/(complete)" cases that assert the PROGRESS.md prose detection. They now expect no issue. Spec line (REQUIREMENTS AC-006.1): "`oss-archive-check.sh` and `healthchecks/archive.ts` decide "shipped" from `results/ship.json` (valid, verdict `ready_to_merge` or merged), not from PROGRESS.md." The "warn when shipped" and "multiple completed" cases keep their expectations, and their fixtures add a valid ship result.

### Task 15: checkpoint.sh counts tasks from results
**Tests (RED)**, file `hooks/__tests__/checkpoint-task-count.test.sh`:
- the count is `plan.tasks.length` from a valid plan result; it is 0 with no result; PROGRESS.md `[x]` lines are ignored.

**Implementation:** `count_completed_tasks` uses `jq` on a validated `results/plan.json`, through `oss-phase-result.sh check plan`.

### Task 16: Delete dead parser + provenance test
**Tests (RED)**, file `watcher/test/phase-results/provenance.test.ts`:
- no file under `hooks/` or `watcher/src/` (excluding tests) matches `Current Phase` with grep/regex use, or `\[x\]` counting.
- `iron-law-log-parser.ts` does not exist.
- the decision-site list in the test equals the one in DESIGN.md.

**Implementation:** delete `watcher/src/monitors/iron-law-log-parser.ts` (no importer, verified by grep).

---

## Phase 5: API PR (AgenticDevWorkflow, into its Sprint D branch)

### Task 17: Retire unused schemas; plan archive step reads results
**Tests (RED):**
- `test/prompts/plan-archive-step.test.ts`: the served `plan.md` archive step checks `results/ship.json` (verification and verdict via the plugin's `oss-phase-result.sh check ship`), contains no `Current Phase` grep, and prints the D13 "no phase result" line.
- The deleted `test/prompts/schemas/output-schemas.test.ts` goes with the schemas; no other test references `prompts/schemas/` (grep assertion).

**Implementation:** delete `packages/api/src/prompts/schemas/*.schema.json` and the test; edit `prompts/commands/plan.md:323`.
**Manifest (shared rule):**
```
cd packages/api && DOTENV_CONFIG_PATH=/Users/ysl/dev/AgenticDevWorkflow/packages/api/.env npm run -s manifest:generate && npm run -s manifest:verify
```
- Run it in the same PR. Never copy or print the key.
- After each Sprint D API merge, rebase and regenerate.

---

## Phase 6: After R-266 merges (tracked; not in slice A's build)
- **Task 18 ⚠ changes existing test** (watcher/test/hooks/hooks-json-tool-gate.test.ts, `EXISTING.Stop: [command('oss-stop.sh')]` becomes the dispatcher). DESIGN.md D9: "The `hooks.json` entries (Stop to the dispatcher, SubagentStop capture) are added on a rebase after R-266 merges, as a tracked task." Add the hooks.json entries on a rebase, additively: Stop points to `oss-stop-dispatch.sh` (it replaces the `oss-stop.sh` entry; the notification runs inside the dispatcher), plus a SubagentStop entry. Tests: `hooks-json` tests for the new entries; R-266's entries are untouched.
- **Task 19:** each review agent ends with a fenced JSON verdict block; a SubagentStop capture puts it into ship evidence (`source: agent`). The API agent-prompt change also regenerates the manifest.
  - **Contract, fixed 2026-11-18:** the agent's final message ends with exactly one fenced block whose info string is `oss-verdict`, holding `{"verdict":"pass"|"fail","findings":{"critical":N,"high":N,"medium":N,"low":N,"info":N}}`. The last `oss-verdict` block of the final message counts. Nothing else in it is read.
  - **Capture (plugin):**
    - A SubagentStop hook entry, additive to R-266's gate-run entry, runs a capture for the review agents only (code-reviewer, security-auditor, penetration-tester, performance-auditor).
    - The gate name comes from the hook input's `agent_type`, mapped to the gate names ship's timeline uses, never from the block.
    - The capture validates the block against a schema and writes one ledger row, through code on the recorded node (D21). The model never writes the row.
  - **Ship assembly:**
    - For each gate of the latest round, a captured agent row written after the ship run started supplies `verdict` and `findings` (`source: agent`). `fixed` stays from the timeline line. A missing block falls back to the timeline line (`source: model`), as today; no stricter flow.
    - Ship's rule holds, in code: a gate is `fail` whenever the captured critical or high count is above zero, whatever the agent's own verdict says (ship.md: "Write `fail` whenever critical or high findings of that agent are left unfixed at the end of the round, whatever the agent said"). Otherwise it takes the agent's verdict. A later round's re-review reports the state after the fixes. (Corrected 2026-11-18 after a heads-up: an earlier draft let the agent's "pass" override its own high findings.)
  - **API:** the four review-agent prompts (packages/api/src/prompts/agents/) end with the block. They are never told to run oss-phase-result.sh (coordinator ruling). The manifest is regenerated.
  - ⚠ changes existing test: R-266's hooks.json EXISTING map gains the SubagentStop capture entry. DESIGN.md D9: "The `hooks.json` entries (Stop to the dispatcher, SubagentStop capture) are added on a rebase after R-266 merges, as a tracked task."
- **Task 20 (slice B):** R-253's recorder is tracked per task, so a task is valid only with a green after its last production edit. Branched from the Sprint D branch after R-266 merges.

## Phase 7: oss-lab (after plugin slice A; D3)
- **Task 21:** lab-ship's `verdict_gate` validates `results/ship.json` against the plugin schema. It fails on missing, malformed, `unverified` or `empty_diff`. `oss-git-shim:80-82` and `entry.sh:458` stop writing `pass:true`, or write only the intent. Tests in `test/test_git_shim.sh` and `test/test_lab_ship_verdict.sh`. The branch is a new oss-lab Sprint D branch (coordinator told first).

---

## Implementation Sequence
1. Foundation: T1, then T2, then T3.
2. Assemblers: T4, T5, T6, then T7 (needs the T6 ledger), then T8 (needs the T6 ledger).
3. Boundary: T9, then T10, then T11, then T12.
4. Grep removal: T13, T14, T15, T16.
5. API: T17 (independent; can run in parallel with phase 4).
6. After R-266: T18, then T19, then T20.
7. oss-lab: T21.

## Testing Strategy
- **Unit:** validator, schemas, store, assemblers (T1-T8).
- **Acceptance at the boundary:** the CLI, `oss-notify complete`, the Stop dispatcher and the archive check, run as shell processes in temp repos (T9-T13).
- **Integration:** a fixture repo that walks ideate, plan, build and ship assemble+check end to end, with a real git and real recorder files (added to T10's file).
- **Edge cases:**
  - symlinks, FIFOs, oversize files;
  - stale value files;
  - an earlier build's events;
  - an empty diff and a squash-merged branch;
  - planted decision records;
  - a throwing Stop check.

## Security Checklist
- [ ] No model value in any shell argument (value files only; provenance assertion in T9).
- [ ] Paths confined to `<repo>/.oss/dev/active/<feature>/results/`; links, FIFOs and hard links refused.
- [ ] Repo resolved from the physical cwd's git toplevel, never from `CLAUDE_PROJECT_DIR`.
- [ ] Decision ids trusted only from the owner-only ledger outside the repo (FOLLOWUPS 192).
- [ ] Pattern length capped; no catastrophic regex (validator).
- [ ] Free text redacted before writing.
- [ ] A failed check is never a pass (`unverified` counts as failed everywhere).
- [ ] Git called with fixed argv and `GIT_*` env unset.

## Performance Considerations
- [ ] `check` under 300 ms, `assemble` under 2 s on 10k events (asserted in T9).
- [ ] events.ndjson read with a tail cap; no full-suite runs; bounded timeouts on the Stop checks.

## Rollout Strategy
- Block mode on the Sprint D branch only. R-267's benchmark decides warn vs block before anything reaches `main`.
- Rollback: revert the `complete` gate in `oss-notify.sh` (T10) to restore today's behaviour. The results files are inert without readers.

## Plan Review (before build; sprint rule)
security-auditor, penetration-tester and performance-auditor review PLAN.md and DECISIONS.md only, with no code. Focus areas:
- (1) the ADR-1 fail-open path (it must never look like a pass);
- (2) the decision-id ledger (T6/T7/T8) against planted records;
- (3) repo resolution vs `CLAUDE_PROJECT_DIR`;
- (4) value-file handling and the size caps;
- (5) the `complete` gate's interaction with chains.

Each MEDIUM or HIGH finding becomes a test-first task here.

---

## Plan-review amendments (2026-11-13): these supersede the task text above where they differ

Reviewers: security-auditor (12 findings), penetration-tester (8), performance-auditor (8). User decisions D14 to D16 in DECISIONS.md. Every MEDIUM-or-higher finding is a test-first row below. Finding ids: S = security, P = pen test, F = performance.

### Trust model (D14): results are bound to a real run
A result counts only if this machine's assembler wrote it for this run, and it still matches the evidence. The model runs as the same user, so this is not a complete control: ADR-1 records the limit, and T18b asks R-266 for deny rules.

#### NEW Task 3b: Owner-only run ledger (S1, S3, S6, P1, P3, P5)
- **Location:** `~/.oss/ledger/<key>/`. This is its own owner-only tree (0700), **outside** the `~/.oss/run` value folder the model is told to write into (coordinator conflict, 2026-11-13). The key uses the same derivation as `oss-value.sh dir` (git toplevel plus `--absolute-git-dir`), so a worktree gets its own key.
- **Permissions:** dir 700, files 600. The dir is created with `mkdir -m 700` and checked with `test -O`; links refused.
- **Rows:** each row is one `O_APPEND` write under 512 bytes. Reads are capped (results and decisions files at 1 MB, everything else at 4 MB). Going over a cap means `unverified`, with `ledger_too_large`.
- **Files:**
  - `run/<phase>`: `{startedAt, session, headSha}`. Written by `oss-notify start`. This is the private run start; the repo's `workflow-state.json` is never trusted for it.
  - `results/<feature>/<phase>`: `{sha256(file), feature, phase, startedAt, headSha, session}`.
  - `pending/<feature>/<phase>` and `unverified/<feature>/<phase>` markers.
  - `decisions/<feature>`: `{id, feature, sha256(line)}`.
  - `gates/<feature>`: `sha256(line)` for each timeline gate line the writer appended.
- **Tests (RED)** in `watcher/test/phase-results/ledger.test.ts`:
  - perms 700/600, and a link or another owner is refused;
  - 50 parallel appends give 50 intact rows;
  - a worktree and its main checkout get different keys;
  - over-cap reads give `ledger_too_large`;
  - an unknown row shape is ignored.

#### Task 9, `check` (amended)
- `check` passes only when **all** of these hold:
  - (a) the file is schema-valid;
  - (b) its sha256 matches the ledger `results/` entry, else `unbound_result`;
  - (c) `startedAt` equals the ledger `run/<phase>` value, else `stale_result`;
  - (d) re-running the assembler in memory reproduces every `source: code` field, ignoring `assembledAt`, else `evidence_mismatch`;
  - (e) for ship, `headSha == git rev-parse HEAD`;
  - (f) there is no `pending` or `unverified` marker, in the repo or in the ledger.
- `check --repo <path>` takes the repo explicitly.
- `check ship --all` checks every feature in one node process and prints one line per feature (F6).
- **Tests (RED):**
  - a hand-written schema-valid build.json is refused (`unbound_result`);
  - a committed ship.json with no ledger entry is refused by both complete and archive;
  - a result built before a new commit is refused for ship;
  - a result copied from another feature, or from an older run, is refused (`stale_result`);
  - a result edited after assemble gives `unbound_result`;
  - code fields that differ from the evidence give `evidence_mismatch`.
- **Budgets (F8):** the tests assert only deterministic stand-ins: bytes read stay within the cap, node starts per call (counted with a PATH shim), no network binary is called, plus loose hang ceilings (check <1.5 s, assemble <6 s). The 300 ms and 2 s targets move to `watcher/scripts/bench-phase-result.mjs`, which reports the median of 5 runs and is run by hand at build verify. REQUIREMENTS NFR is updated to match.

#### NEW Task 9a: Bounded runner that keeps the exit code (F1, F3, S5)
- A new helper, `oss_run_bounded_rc`, lives in the new `hooks/oss-phase-result.sh` (it does not change `run_with_timeout`).
- The gate passes **only** on exit 0 **and** stdout `{"verification":"verified"}`. Everything else is refused: 124, 125, 127, 137, a missing CLI, no node, a crash or empty output.
- **Tests (RED):** each of those causes gives a refusal; a fake CLI that sleeps past the bound gives a refusal naming `timeout`.

#### Task 10, the complete gate (amended: S4, S5, P6, F1)
- `oss-notify` resolves the project **once**, passes it as `check --repo`, and refuses when the cwd's git toplevel differs from the project's (`repo_mismatch`).
- `check` runs **before** `completeStep`, `setNextCommand`, the checklist and the chain.
- **⚠ changes existing test:** `hooks/__tests__/oss-notify-workflow-name.test.sh` case 2 expects `complete` for `build` and `ship` to fire the chain with no result. Spec line (REQUIREMENTS AC-001.1): "Given no `results/<phase>.json`, when the model runs `oss-notify.sh --workflow <phase> complete`, then the command exits 1 … and no `CHAIN:` line is printed." Case 2 keeps `custom-cmd2` as is, and gets a valid assembled result fixture for `build` and `ship`. Check `oss-notify-updates.test.sh` and `oss-notify-complete-bounds.test.sh` the same way during T10.
- On refusal, every state call goes through `wf_state_timeout 2`.
- **Tests (RED):**
  - project A with ship started and no result, cwd in repo B with a valid result: exit 1 and no `CHAIN:`;
  - no node, no CLI, and exit codes 2/124/127 all give exit 1, `failed`, and no `CHAIN:`;
  - on refusal the state still shows the phase as not completed.

#### NEW Task 10b: Start gate (D16) with migration rule (D17)
**Migration (D17, user pick 2026-11-13, also goes in the release notes):**
- A feature folder with **no `results/` dir at all** (made before R-257, or never planned) starts with a one-line notice: `no phase results for <feature>: start gate skipped; run /oss:<prev> to enable it`.
- Once any result exists for the feature, the gate applies.
- `/oss:quick` is never gated. `--team` variants are gated like their main command.
- Every refusal names the exact command to run.
- **Tests (RED):**
  - a pre-R-257 feature (no results/) gets the notice and starts;
  - a feature with `results/ideate.json` but no plan result is refused at `start build` with a message naming `/oss:plan`;
  - `quick start` is not gated;
  - `build-team start` is gated like `build`.
- `oss-notify --workflow plan|build|ship start` runs `check <previous phase>` (ideate for plan, plan for build, build for ship). Without a valid result it exits 1 with a reason naming the missing result and the command that builds it.
- `start` also writes the ledger `run/<phase>` row (T3b).
- **Tests (RED):**
  - `start build` with no valid plan result gives exit 1 and the state unchanged;
  - with a valid result, start proceeds;
  - `start ideate` and non-phase commands are not gated.

#### NEW Task 10c: resolve_cli reads ~/.oss/plugin-root before the plugin cache (user pick via coordinator, 2026-11-13; R-267 finding c)
- **Why:** under `claude --plugin-dir` (R-267 benchmark arms) the plugin cache dir does not exist. `oss-notify.sh`
  started from `~/.oss/hooks` sets PLUGIN_ROOT=~/.oss, and `resolve_cli` falls back to the cache, so `setCurrentCommand`
  never runs: build `startedAt` stays null, and the phase-result gate would see `cli_missing`.
- **Order:** `CLAUDE_PLUGIN_ROOT` (when it holds the CLI), then `~/.oss/plugin-root`, then the cache. `~/.oss/plugin-root`
  gets the same checks used elsewhere: a regular file owned by the user, not a link; the dir it names is owned by the user,
  not a link, and inside an expected root. `oss-phase-result.sh` (T9) uses the same order.
- **Tests (RED):** a `--plugin-dir`-style layout with no cache dir and `~/.oss/plugin-root` naming the plugin. Today
  `notify build start` leaves `currentCommandStartedAt` null; after the fix it is set. Also: a symlinked or foreign-owned
  `plugin-root` is ignored, and the existing cache layout still resolves.
- **Constraints:** no change to hooks.json or oss-value.sh (R-266). Tell the coordinator before committing the
  `oss-notify.sh` change, so it can check for overlap with R-266.
- **(a) recorded by the same pick:** design_not_committed stays strict. R-267's seam stamps `Status: COMMITTED` into the
  copied DESIGN.md.

#### Task 11, Stop dispatcher (amended: F2, F3, S3, P5)
- **Bash fast path:** node is called only when the git toplevel has `.oss`, `workflow-state.json` is a regular file, and the ledger `run/` shows a started phase without a result. Test (RED): with no phase started, a node shim on PATH is never called and the notification still runs.
- **Before any check runs**, the dispatcher writes `pending/<feature>/<phase>` to the ledger. Only a successful assemble clears it.
- **Three nested bounds:**
  - each check's `spawnSync({timeout})` and non-blocking opens;
  - the shell wrapper's limit of 5 s. When it fires, the **shell** writes the `unverified` ledger marker and the repo marker, and prints the `systemMessage`;
  - the hooks.json timeout (T18), set longer than the shell bound.
- **Path problems block; they do not fail open:** `unsafe_path`, a FIFO, a link, or an oversized file. Only internal exceptions fail open.
- **Loop guard:** when `stop_hook_active` lets the stop through, it records `unverified` and sends a `systemMessage`.
- A second fail-open for the same phase in one session **blocks**.
- **Tests (RED):**
  - a synchronous busy-loop check still produces all three ADR-1 effects;
  - SIGKILL the dispatcher mid-check, then `complete` refuses (pending marker left behind);
  - a second stop with `stop_hook_active`, then `complete` refuses;
  - delete the repo marker, then `complete` still refuses (ledger marker);
  - a symlinked `results/` blocks and still sends the `systemMessage`;
  - a second fail-open in the same session blocks.

### Evidence integrity
#### Task 4, build (amended: F4, D15)
- Read events.ndjson backwards in chunks until reaching an event older than the run's `startedAt`, or the 8 MB cap. Hitting the cap gives `unverified` with `events_truncated`, never a wrong `no_red`.
- **D15:** until slice B's recorder hash chain, the build result carries `evidenceTrust: "repo-file"`. The complete notice says "build evidence is from repo files (not ledger-checked)", so it never looks agent- or ledger-verified.
- **Tests (RED):**
  - 100k lines (about 20 MB) with this run's red near the start give `verified` or `events_truncated`, never `no_red`;
  - bytes read stay within the cap (injected reader);
  - the result has `evidenceTrust: "repo-file"` and the notice says so.

#### NEW Task 8a: The timeline gate writer records line hashes (S2, P4)
- `hooks/oss-timeline.sh` (not an R-266 file) appends `sha256(line)` to the ledger `gates/<feature>` file whenever it writes a gate line.
- **Tests (RED):** a written gate line's hash is in the ledger; a gate line appended with Write is not.

#### Task 6, decision hook (amended: S6, F7)
- Ledger rows are `{id, feature, sha256(line)}` per feature.
- The hook adds only one `git rev-parse` and **no node call** (shim count).
- **Tests (RED):** worktree ideate finds its own picks; 50 parallel appends stay intact.

#### Tasks 7 and 8, assemblers (amended: S2, S6, S9, S10, F5, P4)
- Decisions and gate lines count only when their line hash **and** feature match a ledger row:
  - an edited `feature` excludes that record (`decisionsRecorded` drops by one);
  - an edited `person` gives `override_unrecorded`;
  - a planted gate line gives `gate_missing`.
- **Ship diff:**
  - `git diff --quiet` for the empty check, and `git diff --shortstat --no-renames <base> HEAD` for the totals;
  - spawn timeout 10 s; an error gives exit 1 with `diff_unavailable` and writes nothing;
  - the base comes from a local ref or config only, never `gh` or `fetch`, and is validated with `git check-ref-format` plus `--end-of-options`;
  - git runs with `-c core.fsmonitor= -c core.hooksPath=/dev/null --no-ext-diff --no-textconv`, `GIT_CONFIG_NOSYSTEM=1`, and `GIT_*` unset;
  - the result records `headSha`.
- **Tests (RED):**
  - a base named `--output=x` is refused;
  - a configured fsmonitor does not run;
  - 5k changed files give matching totals;
  - a slow or huge git gives `diff_unavailable`;
  - with `gh` absent from PATH, assemble still works.
- **Model text:** every model field (`openQuestions`, `notes`, `tasks[].title`, `claims[].text`, `summary`) is redacted, and control characters are refused by the schema pattern `^[^\x00-\x08\x0b-\x1f\x7f]*$`. `reason` and `systemMessage` never echo model text.
- **Tests (RED):** an ANSI escape is refused; a planted key is redacted in each field.

### Validator, schemas and store hardening
#### Task 1 (amended: S8)
- Patterns compile as `^(?:p)$`, and `maxLength` is checked before `pattern`.
- Each shipped pattern is tested to have no nested quantifier.
- The walk is driven by the schema, so a value nested 100k deep fails at depth 1 without a RangeError.

#### Task 2 (amended: S8)
- Schemas load only from the plugin root, with a realpath check.
- Test (RED): a planted `<repo>/schemas/phase-results/` is ignored.

#### Task 3 (amended: P7, P8, S10)
- Reads require `nlink === 1` and the owner to be the current uid.
- The temp file is created with `O_EXCL|O_NOFOLLOW` and a random name. After the rename, a realpath check confirms the file is inside `results/`; otherwise it is deleted and the write fails.
- Value files are opened with `O_NOFOLLOW`; `fstat` must show a regular file; at most 64 KB + 1 bytes are read.
- **Tests (RED):**
  - a hard link (`nlink > 1`) gives `unsafe_path`;
  - `results/` swapped for a symlink during the write is detected after the rename;
  - a 10 MB value file is refused without reading it all.

### Archive and checkpoint (F6, S12)
- **T13:** bash skips features with no `results/ship.json`, which builds the D13 list at no extra cost. The rest go through one bounded `check ship --all` call; a timeout archives nothing. Archive uses ledger existence from any session.
- **T13 tests (RED):**
  - with 50 features of which 2 have results, the node shim is called at most once;
  - a result assembled in session 1 archives in session 2;
  - a committed result with no ledger entry is not archived.
- **T15:** one bounded call.

### Tracked for after R-266 (coordinator)
- **NEW T18b (S2, P1-P3), after R-266 merges, as R-257's own PR into the Sprint D branch (not in R-266's PR):**
  - Add `protectedPaths` entries to `config/tool-gates.json`, additively, for `~/.oss/ledger/**` and `.oss/dev/active/*/results/**` only, never `~/.oss/run/**`.
  - They are covered by Write/Edit and by the gate's Bash path checks (`cp`, `tee`, `>`, through R-266's command reader).
  - **Tests:**
    - a Write to the value folder `~/.oss/run/<key>/verdict.txt` still passes;
    - Write, Edit, `cp`, `tee` and `>` to the ledger or to results/ are refused;
    - an ordinary builder session still runs `oss-value.sh timeline gate`, `oss-phase-result.sh assemble` and `oss-notify complete`.
- **T20 (slice B), amended (P2, D15):** the recorder keeps a hash chain (each line's sha256 includes the previous one), with the chain head and line count in the ledger. The build assembler trusts only events whose chain matches, and `evidenceTrust` becomes `ledger`.
  - Test: an event appended without a matching chain head gives `events_tampered`.
  - Open security item (user decision D15, 2026-11-13): it is logged, not silently deferred.
- **T21 (oss-lab), amended (S7):** `verdict_gate` recomputes the merge-base, the diff stat and HEAD itself and compares them with the result; a mismatch or empty diff fails. Test: a forged ship.json claiming a non-empty diff on an empty branch fails.

### After the R-266 rebase (2026-11-18): fixes found by the rebase checks, built before T18
- **T22 (API + plugin): plan Phase 0's grep regexes go in single quotes.** R-266's gate reads `((` followed by `$` inside double quotes as arithmetic, and refuses the whole archive step for every agent. Single quotes keep the same regex and behavior. The coordinator confirmed this fix on 2026-11-18; the gate is not loosened.
  - Test (API, plan-archive-step): neither PROGRESS.md grep has its regex in double quotes.
  - Then, in the plugin: regenerate `watcher/test/fixtures/served-command-blocks.json` with `node scripts/served-command-blocks.mjs` from the API checkout, and run `watcher/test/cli/served-commands.acceptance.test.ts`. That test feeds every served block to the gate, as the main agent and as builders. Commit the fixture with the plugin PR.
- **T23 (API): plan-archive-step's today() uses the local date,** as `date +%Y-%m-%d` in the archive step does. RED: run it under a TZ whose local date differs from the UTC date.
- **T24 (plugin): R-257's own test files use GNU-first `stat`.** The files are oss-notify-phase-result, timeline-gate-ledger and oss-decision-record. The test is `stat-order.test.sh`. R-266's three offenders are R-266's own fix.
- **T25 (plugin): the D17 start notice prints only in an OSS project,** that is, one whose project folder has `.oss`. The existing test, `oss-notify-analytics.real.integration` ("the start event writes nothing", from a non-OSS folder), keeps its expectation, and the code changes to fit it. The test suite has no `⚠ changes existing test` mark.
- **T26 (plugin): `oss-phase-result.sh` and the phase gate in `oss-notify.sh` run the CLI through `oss_node` (`hooks/oss-node.sh`),** not PATH's node. This is the NOTES rebase item. If there is no usable node, the call fails as cli_missing does today, with one clear line.

## Estimated Tasks: 21 in slice A (T1-T17, plus new T3b, T8a, T9a, T10b), plus 5 tracked (T18, T18b, T19, T20, T21)
## Estimated Test Cases: about 160

## Last Updated: 2026-11-13 19:10 CST by /oss:build (T10c, T14 note)
