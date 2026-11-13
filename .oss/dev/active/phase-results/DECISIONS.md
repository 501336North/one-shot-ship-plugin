# Decisions: phase-results (R-257)

## Standing rules (Sprint D)

### SD-1: merge only into the Sprint D branch, never main (user, relayed by coordinator, 2026-11-13)
- Every PR targets `feat/determinism-sprint/build`, never `main`, in every repo: plugin, API and oss-lab (eval and harness changes included), even if a served /oss:ship prompt says `--base main`.
- oss-lab has no Sprint D branch yet: tell the coordinator first, then create it from `origin/main`.
- Replaces the earlier "ask whether oss-lab goes to main" rule.
- Merging still needs the user's own merge consent in this session; the coordinator orders merges.

### SD-2: R-266's files are off limits until R-266 merges
`hooks.json`, `hooks/oss-value.sh`, `hooks/oss-tool-gate.sh`, `hooks/oss-gate-run.sh`, `config/tool-gates.json`, `watcher/src/tool-gate/**`, `watcher/src/gate-run/**`; API `ship.md`, `review-team.md`, review-agent prompts. Tell the coordinator before touching any.

## Ideate decisions (2026-11-13, picker; records written by the hook)

- D1 Writer: **code-assembled** results from evidence; the model adds only free text.
- D2 Slicing: **slice A now** (schemas with claims[]/chain[] room, writer + validator, ship diff base/size, missing/malformed result fails); **slice B after R-266 merges** (per-task green after last production edit).
- D3 oss-lab: **in R-257, after plugin slice A**: lab-ship's verdict gate reads results/ship.json; retire the pass:true-only writers.
- D4 Enforcement: **oss-notify complete refuses + one shared Stop dispatcher blocks** (R-265 extends it); block mode on the sprint branch, R-267 decides warn vs block for release.
- D5 Validator: **plugin JSON Schema files + tiny validator in the watcher bundle**; no new runtime dependency; retire the API's unused prompts/schemas/*.schema.json.
- D6 Gate source: **agent JSON block, staged**: timeline gate lines (source "model") until R-266 merges, then SubagentStop capture.
- D7 Grep scope: **decision sites only** (archive checks, checkpoint count, API plan.md:323, dead iron-law-log-parser); metrics/test-monitor/oss-lab infra greps listed as not phase output.

- D8 Section 1 and 2 of the design approved as presented.
- D9 R-266 gap: **accept, wire hooks.json on rebase** after R-266 merges (tracked task); slice A merges with complete-refusal only.
- D10 Misfiled decisions: **fix the decision hook's repo resolution in slice A** (tool call cwd → git toplevel); ideate reads only records whose feature matches, none → fail.
- D11 Plan tasks: **model value file, validated** ({id, title, testIds[≥1]}, source model); PLAN.md stays the human doc; slice B checks test ids exist and ran.
- D12 Overrider: **decision record id** plus the hook's person field as recorded (unverified); the model never writes a name.

---

## Plan decisions (2026-11-13, picker)
- FOLLOWUPS pulled into this plan: 26 (complete chains without a check), 192 (planted decision id), 30+40 (archive-check bugs), 184 (FIFO hang); 305 (D10) was already in scope.
- D13 Legacy archive: **leave them, report once**. Only a valid results/ship.json archives a feature. Features with no results/ dir are never auto-archived, and plan prints one line listing them. User heads-up (exact): "The plan changes auto-archiving to read only the new result files, so features shipped before this change may never get archived again." Accepted as the chosen trade-off.

## Plan-review decisions (2026-11-13, picker)
- D14 Binding: **private ledger + re-derive**. assemble records the result's hash and run identity in an owner-only `~/.oss/ledger/<key>/` (moved out of the ~/.oss/run value folder). check refuses an unbound, stale or evidence-mismatched result. Evidence lines count only when their line hash is in the ledger.
- D15 Recorder: **label build evidence, fix in B**. Slice A's build result carries `evidenceTrust: "repo-file"` and the notice says so. The recorder hash chain lands in slice B after R-266 merges. This is an open security item, decided by the user, not self-deferred.
- D17 Start-gate migration: **legacy pass + notice**. A feature with no results/ dir starts with a notice. Once any result exists, the gate applies. /oss:quick is never gated; --team is gated like its main command; refusals name the command to run. Goes in the release notes.
- Ledger location (coordinator conflict fix): `~/.oss/ledger/<key>/`, outside the `~/.oss/run` value folder. T18b deny rules cover the ledger and results/ only, after R-266 merges, as R-257's own PR.
- D16 Start gate: **added**. `oss-notify start` for plan, build and ship refuses without a valid previous-phase result. This widens D4 by the user's choice.

---

## ADR-1: One Stop dispatcher, extended by R-265

**Date:** 2026-11-13
**Status:** Accepted
**Deciders:** the user (pickers D4 and D9, hook-recorded); the coordinator session's steering (one dispatcher, additive hooks.json)

### Context
- R-257 (no valid phase result) and R-265 (a chain step not run) both need a `Stop` hook that returns `{"decision":"block","reason":…}`.
- Today the plugin has exactly one Stop hook, `hooks/oss-stop.sh`. It plays a notification and always exits 0. There is no SubagentStop hook.
- `hooks.json` belongs to R-266 until R-266 merges. R-266 also adds a SessionStart entry and possibly a Monitor PreToolUse matcher, so R-257's change to hooks.json must be additive (new entries only, no reordering) for the rebase to stay trivial.
- Block mode applies on the Sprint D branch. R-267's benchmark decides warn vs block for the release.

### Research
| Option | Pros | Cons | Fit |
|---|---|---|---|
| A. One dispatcher, ordered check list | One hooks.json entry. One place to read why a stop was blocked. R-265 adds one list entry. Notification ordering is controlled. | A broken check could trap every session unless it fails open. | **Best** |
| B. One Stop hook per card | Cards stay independent. | Claude Code runs matching hooks in parallel, so two hooks can both block with different reasons, and the notification fires even when blocked. Each card edits hooks.json, which is a rebase conflict with R-266 every time. | Poor |
| C. Fold the checks into `oss-stop.sh` | No new file. | Mixes notification and enforcement. The notification's always-exit-0 contract breaks. Harder to test hermetically. | Decent |

Evidence: the provenance survey (only one Stop hook exists, and it never blocks), hooks.json on `origin/feat/determinism-sprint/build` @952c01b, and the R-265 card (its Stop block is part (c)).

### Decision
- `hooks/oss-stop-dispatch.sh`, a thin shell entry, calls `watcher/src/stop/dispatch.ts`. The dispatcher runs a fixed, ordered list of checks. The first check that returns `block` wins, and the dispatcher prints `{"decision":"block","reason":…}`.
- R-257 adds the first check, `phase-result-missing`: a phase started in this session has no valid `results/<phase>.json`. R-265 later adds `chain-step-pending` to the same list, and does nothing else.
- When nothing blocks, the dispatcher runs the existing notification (`oss-stop.sh`'s behaviour), so the "Done" sound plays only on a real stop.
- A check that throws or times out **fails open, but never looks like a pass** (coordinator steering 2026-11-13, from R-266's 6 ship rounds, where every silent fail-open became a finding). The stop is allowed, so a broken check can't trap the session, and three things happen:
  1. the phase is recorded as `verification: "unverified"` (with `verificationError` set to the check id and an error class, never a stack or free text). This goes in the result file when one exists, and otherwise in a `results/<phase>.unverified.json` marker;
  2. the dispatcher prints a notice the user sees: the hook's `systemMessage`, naming the phase and the check;
  3. a `stop-check-error` event is logged.

  `oss-notify complete`, the archive check and oss-lab treat `unverified` as **not passed**. Each of these cases gets its own test. **Plan review focus:** the plan-review agents (security, pen test, performance) are pointed at this fail-open path.
- hooks.json changes once: the Stop entry points to the dispatcher instead of `oss-stop.sh`. This is added on a rebase after R-266 merges, as a tracked PLAN.md task. Until then, slice A enforces only at `oss-notify complete` (D9).

### Consequences
**Positive**
- A single source for "why can't this session stop", with the reason naming the phase or step.
- R-265 extends the list without touching hooks.json.
- The rebase onto R-266 is a one-line change to an existing entry.

**Negative**
- Until R-266 merges, nothing stops a model that never calls `complete` (accepted as D9).
- Failing open means a crashing check does not block the stop. It is never silent: the phase is marked `unverified` (which counts as not passed downstream), the user sees a notice, and an event is logged.
- There is a risk of loops: a Stop block re-prompts the model, so the reason must be specific and actionable (the command that builds the result).

- **Accepted limit (plan review, D14):** the model runs as the same user as every hook, so it can still forge the owner-only ledger (`~/.oss/ledger/`) through Bash. The ledger turns a quiet Write into a deliberate bypass. The deny rules on `~/.oss/run/**` and `results/**` (T18b, R-266's rule file) make that bypass refusable and logged (`~/.oss/ledger/**` and `results/**`, never the `~/.oss/run` value folder). It is not a complete control, and is never described as one.

**Neutral**
- The check list is code, not configuration. Adding a check needs a plugin release.

### Alternatives Considered
- **B, one hook per card:** rejected because of parallel-hook races, a double notification, and a hooks.json conflict for every card.
- **C, extend `oss-stop.sh`:** rejected because it mixes notification and enforcement and breaks its exit-0 contract.

### Related Decisions
- D4 (complete refuses and Stop blocks), D9 (R-266 gap: wire on rebase).
- R-265 (c) extends this dispatcher. R-254's oss-lab state machine may later read the same result files.

## Last Updated: 2026-11-13 14:47 CST by /oss:ideate
