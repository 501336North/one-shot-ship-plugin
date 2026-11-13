# Feature: phase-results (R-257, Sprint D #5)

Status: COMMITTED

Committed 2026-11-13 after the stress test (no dissent records). Decisions D1-D11 in DECISIONS.md.

## Problem
No site in the plugin, the API prompts or oss-lab checks a phase's result before treating the phase as passed (provenance survey, 2026-11-13):
- Plugin: a phase is complete when the model runs `oss-notify.sh --workflow X complete` (hooks/oss-notify.sh:303-341). No artifact is checked.
- API: the model aggregates the ship gates from prose reports. `verdict.txt` only feeds the timeline, which "never stops a ship" (ship.md:333).
- oss-lab: `ship-verdict.json` writers only ever write `pass:true` (bin/oss-git-shim:80-82, entry.sh:458). lab-ship's `verdict_gate` (bin/lab-ship:40-49) therefore never blocks: a gate weakness.
- Decisions are made on prose greps: PROGRESS.md `Current Phase` (oss-archive-check.sh:89-120, healthchecks/archive.ts:39, API plan.md:323) and the `[x]` count (checkpoint.sh:126-131).

Who has the problem: everyone running /oss:* (a skipped or hollow phase passes silently) and R-264/R-265, which depend on a phase result.

## Solution
Each phase ends with one JSON result file, built by code from evidence and checked against a JSON Schema. A missing or malformed result fails the phase: `complete` refuses and no chain fires.

## Approach
- **D1 Code-assembled.** Code builds each field from evidence. The model adds only free text, which it supplies through value files (Write tool), never through shell arguments. Each field records its source: `code` or `model`.
- **D5 Schemas.** JSON Schema files in `schemas/phase-results/` are the single source; oss-lab reads the same files. A small validator in the watcher bundle supports only these keywords: `type`, `required`, `properties`, `additionalProperties:false`, `enum`, `pattern`, `maxLength`, `maxItems`, `items`, `$ref` (into common). A schema that uses any other keyword is refused at load time, never silently ignored. No new runtime dependency.
- **Location.** `.oss/dev/active/<feature>/results/<phase>.json`. It is written atomically (temp file then rename). A symlinked target or parent is refused. Each result is at most 256 KB, and each free-text field at most 4000 characters.
- **D4 Enforcement.**
  - `oss-notify complete` re-validates `results/<phase>.json`. When it is missing or invalid, the phase is recorded `failed`, no chain fires, it exits 1, and the reason names the failing field and the command that rebuilds the result.
  - A single Stop dispatcher blocks the session from ending while a started phase has no valid result. R-265 adds its chain check to the same dispatcher (ADR).
  - Block mode applies on the Sprint D branch. R-267 decides warn vs block for release.
- **D2 Slices.** Slice A now. Slice B (per-task "green after the last production edit") follows after R-266 merges.
- **D9 R-266 gap.** The `hooks.json` entries (Stop to the dispatcher, SubagentStop capture) are added on a rebase after R-266 merges, as a tracked task. Until then only `complete` enforces.

## Result shapes (common + per phase)
Common fields:
- `v:1`, `phase`, `feature`, `startedAt` (the command's `currentCommandStartedAt`), `assembledAt`;
- `sources` (field to `code` or `model`);
- `verification`: `verified` or `unverified`, plus `verificationError?` (check id and error class). `unverified` counts as not passed everywhere (ADR-1);
- `claims[]` (R-264): `{text, kind, label?: VERIFIED|REFUTED|UNVERIFIABLE, evidence?}`, at most 100 entries;
- `chain[]` (R-265): `{command, ranAt, initEventId}`.

| Phase | Code-assembled from | Model (validated) |
|---|---|---|
| ideate | Decision records in `decisions.ndjson` whose feature matches and are in the ledger (D10, D14); zero is allowed, recorded as `decisionsRecorded: 0` (D18); DESIGN.md `Status: COMMITTED` present | `openQuestions[]` |
| plan | none | `tasks[]` `{id, title, testIds[≥1]}`, source `model`. Code checks unique ids and at least one test id per task (D11). |
| build | R-253 recorder events for this build (`.oss/tool-gates/events.ndjson`, `cycle.json`): red seen, then green, last result. Per task in slice B. | `notes` |
| ship | Git: `diff.base` (merge-base sha with the PR base branch), `diff.files`, `diff.insertions`, `diff.deletions`; an empty diff fails. Gates: per-gate `{gate, verdict, findings{critical..info}, fixed, source}` from the timeline gate lines (source `model`) until the SubagentStop capture of each agent's JSON block lands (source `agent`) (D6). Overrides: `{finding, decisionId, person}`, copied from the hook's decision record; the model never writes a name (D12). | `summary` |

**Ship verdict rule (card c):** when all gates pass and `blockers[]` is empty, `verdict = "ready_to_merge"` and nothing else is named as holding the merge. Merging still needs the user's `--merge` consent.

## Components
- `schemas/phase-results/{common,ideate,plan,build,ship}.schema.json`: the shape of each result.
- `watcher/src/phase-results/validate.ts`: the keyword-subset validator.
- `watcher/src/phase-results/assemble-{ideate,plan,build,ship}.ts`: build each result from evidence.
- `watcher/src/phase-results/store.ts`: atomic write, symlink refusal, size caps.
- `watcher/src/cli/phase-result.ts` and `hooks/oss-phase-result.sh`: the `assemble <phase>` and `check <phase>` commands.
- `watcher/src/stop/` and `hooks/oss-stop-dispatch.sh`: the Stop dispatcher with an ordered check list; R-257 adds the first check.
- Edits:
  - `hooks/oss-notify.sh` (`complete` runs `check`);
  - `commands/{ideate,plan,build,ship}.md` (an assemble step before `complete`);
  - `hooks/oss-archive-check.sh`, `watcher/src/healthchecks/archive.ts`, `hooks/checkpoint.sh` (read results, not prose);
  - delete `watcher/src/monitors/iron-law-log-parser.ts` (dead);
  - `hooks/oss-decision-record.sh` (D10: resolve the repo from the tool call's cwd).
- API PR: delete the unused `prompts/schemas/*.schema.json` and their test; `plan.md:323` reads `results/ship.json`.
- oss-lab (D3, after plugin slice A): lab-ship's `verdict_gate` validates `results/ship.json` against the plugin schema and fails on missing, malformed or empty diff. The `pass:true`-only writers are retired.
- Held for after R-266: the `hooks.json` entries, the SubagentStop capture plus the review-agent JSON block, and slice B.

## Success Criteria
- [ ] For each phase, `oss-notify complete` with a missing result exits 1, records `failed` and prints no `CHAIN:` line.
- [ ] For each phase, a result failing its schema (unknown field, wrong enum, over-long text, bad pattern) is refused with the field named.
- [ ] Ship with an empty diff (base equals head, or an already squash-merged branch) fails with `empty_diff`.
- [ ] Ship with all gates passing and no blockers gives `verdict: ready_to_merge` and nothing listed as holding it.
- [ ] Every code-assembled field carries `source: code`; model text carries `source: model`.
- [ ] The Stop dispatcher blocks when a phase has started with no valid result, and allows the stop once a valid one exists (hermetic; wired after R-266).
- [ ] In a worktree session, the decision hook files picks under the worktree's feature.
- [ ] Ideate with no matching decision records fails with a clear reason.
- [ ] A provenance test lists every decision site that reads phase output, and fails if a PROGRESS.md `Current Phase` or `[x]` grep returns.
- [ ] No new runtime dependency in watcher/package.json.

## TDD Test Plan
Tests first, outside-in from the hook and CLI boundary. Only targeted watcher test files are run, never the full suite.
- [ ] Acceptance: `oss-notify.sh --workflow plan complete` with no results/plan.json leads to exit 1, failed state and no chain.
- [ ] Acceptance: `oss-phase-result.sh assemble ship` on a branch with no diff gives `empty_diff`.
- [ ] Validator: each supported keyword (pass and fail); an unsupported keyword in a schema is refused at load.
- [ ] Store: a symlinked results dir or file is refused; an oversized result is refused; the write is atomic.
- [ ] Assemble build from fixture events.ndjson/cycle.json: red then green passes; green only fails; no events fails.
- [ ] Assemble ideate: matching decision records are included; a different feature is excluded; none fails.
- [ ] Assemble plan: a duplicate task id fails; a task without a test id fails.
- [ ] Assemble ship: gate lines become gates with `source: model`; an override copies the decision id and the person field.
- [ ] Stop dispatcher: block and allow rows; an ordered check list R-265 can extend.
- [ ] Stop dispatcher, check throws or times out: the stop is allowed, AND the phase is recorded `unverified`, AND `systemMessage` names the phase and the check, AND a `stop-check-error` event is logged (one test each).
- [ ] An `unverified` phase is not passed: `complete` refuses it, archive skips it, and oss-lab fails it (one test each).

**Plan review focus:** point the plan-review agents (security-auditor, penetration-tester, performance-auditor) at the fail-open path in ADR-1. It must never look like a pass. This is R-266's lesson: every silent fail-open became a ship finding.
- [ ] Decision hook: in a worktree cwd, the record goes to the worktree feature.
- [ ] Archive, healthcheck and checkpoint read results, not PROGRESS.md prose.
- [ ] Provenance test (no prose greps at decision sites).

## Out of Scope
- Slice B (per-task green after the last production edit, recorder per task): after R-266 merges.
- Wiring `hooks.json` and the SubagentStop capture before R-266 merges.
- R-264 verifier and R-265 chain enforcement (only room in the schema and the dispatcher).
- Metrics (oss-log-analyzer.sh), test-monitor, and oss-lab infra greps (overload, model refusal, gate.log): not phase output, listed in the provenance doc.
- Verifying a person's identity on decision records.
- What to do with the 8 misfiled decision lines in `/Users/ysl/dev/.oss/dev/active/plateforme-recrutement-asng/decisions.ndjson`: the user decides.

## Dissent Records
None. Every stress-test concern was resolved with the recommended option.
