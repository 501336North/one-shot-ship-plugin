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
- D18 Zero picks (user, 2026-11-13, after a heads-up that headless runs like the DeepBlue benchmark would fail at ideate): **allow zero decisions**. The ideate result may have `decisions: []`, recorded as `decisionsRecorded: 0` (code-sourced). Ideate still fails without DESIGN.md `Status: COMMITTED`. Planted picks are excluded, not counted.
- D16 Start gate: **added**. `oss-notify start` for plan, build and ship refuses without a valid previous-phase result. This widens D4 by the user's choice.

## Build decisions (2026-11-13)
- D19 Ship base (user picker, after the heads-up "Ship's new result compares your branch against `main` unless you set a base per repo, so Sprint D features may get the wrong diff"): **PR base value file**.
  - Ship's assemble step writes `base.txt` with the Write tool, naming the branch the PR will target.
  - Code accepts it only when it names an existing local branch (`refs/heads/<name>`) that passes `check-ref-format`; otherwise it uses the repo setting `oss.shipBase`, then `main`.
  - The result records the base branch it used as `diff.baseRef` (source code), and `check` re-derives from that recorded branch, so the short-lived value file is not needed at check time.
  - The base is named by the model but checked against real git; oss-lab's T21 recomputes the diff on its own.
- Coordinator (user picks relayed, 2026-11-13): R-267 finding (a) keeps design_not_committed strict, and the R-267 seam stamps `Status: COMMITTED`; finding (c) adds T10c (resolve_cli reads `~/.oss/plugin-root` before the cache).
- D20 Old-plugin auto-archive (user picker 2026-11-14, after the heads-up "Once the API change goes live, everyone on an older OSS plugin stops getting auto-archive until they update"): **Old rule on old plugins**.
  - Only when `oss-phase-result.sh check ship --all` is missing or exits 127, plan Phase 0 archives with the pre-R-257 PROGRESS.md rule. It prints one notice to update the plugin.
  - With the check present, D13 holds unchanged: results only, PROGRESS.md never decides, and any other failure archives nothing.
  - Why: the API serves one prompt to all plugin versions, so this is the only way old-plugin users keep today's behavior. Their trust is the same as today's.
  - Follow-on pick (2026-11-14): US-004's plan prompt size base moves to 36,416 bytes for T17 and D20, keeping the +1,000 growth budget.
  - Built in API 0af2d521.
  - Narrowed 2026-11-14 after a heads-up, to keep D20's intent. The new hook also exits 127 (`cli_missing`) when its CLI is missing. So the fallback now runs only when `~/.oss/hooks/oss-phase-result.sh` is not installed. An installed hook that exits non-zero, 127 included, archives nothing. API cf01dc28.
- D21 Phase checks when the recorded node is gone (user picker 2026-11-18, T26): **Fail closed**.
  - The phase-result CLI runs on the node in `~/.oss/node-path`, through the plugin's `hooks/oss-node.sh`, never PATH's. This covers oss-phase-result.sh (assemble, the notify gates and plan's archive check), checkpoint.sh and oss-stop-dispatch.sh.
  - If the recorded node was removed and PATH has a different one, the check exits 127 with one `node_missing` line telling the user to delete `~/.oss/node-path`. The complete gate refuses, Stop marks the phase unverified, and checkpoint counts 0.
  - Why: a verdict must never come from an unrecorded node. The cost is rare, since nvm switches and brew upgrades keep the recorded path usable.
  - Not chosen: re-recording PATH's node (a fake node could become the recorded one), and falling back with an unverified label.
- D31-D35: ship round 2 decisions (user pickers, 2026-11-18). Security and pen-test failed (MEDIUM/LOW only); code review and performance passed.
  - **D31 Fix everything in round 3:** every MEDIUM and LOW from round 2, through /oss:build TDD.
  - **D32 A captured FAIL blocks until re-review.**
    - A captured fail row from this run keeps its gate failed until the same reviewer passes on a DIFFERENT reviewed tree.
    - A pass on the unchanged tree never erases it (closes the re-roll after a round line).
    - D24's fix counts still apply to model-only timeline lines.
  - **D33 Homebrew git or jq fallback = the recorded node's trust level (D21).**
    - The general fix goes to R-266's OS write-sandbox card.
    - R-257 still makes the node CLIs and hooks use the fixed paths, never PATH.
  - **D34 (corrected, user re-pick 2026-11-18, "Real remote branch, made before the run"): the ship base must be a real remote branch.**
    - A base is accepted when it is an ancestor of, or equal to, origin's default branch tip, OR it is an existing refs/remotes/origin/<name> whose reflog shows it was created before this ship run started.
    - A ref made during the run (by update-ref or fetch), or with an oss.shipBase-named ref made during the run, is refused.
    - The first picker said "ancestor of origin's default only". That would refuse every PR into an integration branch, R-257's PR into Sprint D included.
  - **D35 ship complete requires ready_to_merge.** A verified but blocked ship result refuses complete, so the chain never runs on a blocked ship.
- D36 (user picker, 2026-11-18, round 3 build, "Clear on a new commit"): a pass with no snapshot.
  - A verdict row's snapshot comes out empty when a changed file is over 50 MB or the capture runs past its 4 s deadline. Under D32 as built, such a pass never counts, so one captured fail blocked ship forever with no override.
  - Now a pass with no snapshot clears an earlier fail of the same reviewer only when its headSha differs from the fail's (a commit landed between them). The gate then keeps the model's timeline line with the "model" label (D26). A same-commit re-roll still never erases a fail.
- D25-D29: ship round 1 decisions (user pickers, 2026-11-18), from four failing gates.
  - **D25 Gate code location: lock it down.**
    - `~/.oss/plugin-root` and `~/.oss/watcher/**` join the tool gate's protectedPaths. This changes R-266's exact-list test, as the user's pick allows.
    - Gate scripts ignore a caller's CLAUDE_PLUGIN_ROOT unless it matches the protected plugin-root or resolves under ~/.claude/plugins.
    - oss-node.sh is always sourced from the protected ~/.oss/hooks copy.
    - Fixes round-1 CRITICAL security 1+2: a forged checker through plugin-root or a CLAUDE_PLUGIN_ROOT prefix.
  - **D26 No captured verdict: pass, but label it.**
    - A required gate with no captured agent row keeps the timeline line (source model).
    - The ship result marks gate evidence unverified, and the complete notice names those gates, like D15.
    - The gap stays as a security follow-up. Fixes the "verified" wording of round-1 HIGH security 3.
  - **D27 Security and pen-test gates: LOW+.**
    - For security and pen-test, any finding at LOW or above that is unfixed (net of the round's fixes) fails, matching ship.md.
    - D24 is unchanged for code-review and performance.
    - A captured pen-test fail blocks even though pen-test is optional.
  - **D28 Dependency CVEs:** pre-existing picomatch/micromatch ReDoS in dev and test tools, in both repos. They go to a Sprint D-wide card (the coordinator), not R-257, and are listed in the PR body as user-accepted.
  - **D29 Old-plugin archive fallback:** plan.md's archive step on a plugin without oss-phase-result.sh archives nothing and prints one update line. The PROGRESS.md prose rule is removed.
  - **D30 A run with no feature still blocks its own session's Stop** (user pick 2026-11-18, "Same session still blocks").
    - Round 1 changed the Stop subject to "same session and same feature". An ideate started on main has `feature: ""`.
    - A same-session run with an empty feature is checked against the feature resolved now.
    - If no feature resolves, the stop is allowed with the unverified marker and a systemMessage, never an instruction the model can't follow.
    - Other sessions and other features are never blocked.
- D24 Captured-verdict gate rule (user picker 2026-11-18): **count the round's fixes**, as ship.md's rule says ("left unfixed at the end of the round").
  - For a gate with a captured agent row: unfixed = max(0, critical − fixed.critical) + max(0, high − fixed.high), with `fixed` taken from that round's timeline line.
  - unfixed > 0 → fail.
  - Otherwise, if the agent reported any critical or high finding, all of them were fixed → pass. The agent's `fail` was about those findings.
  - Otherwise the agent's own verdict counts.
  - The fix count is model-claimed. CORRECTED 2026-11-18 after a heads-up: no later round checks it when every gate passes, because ship then merges. The first picker wrongly said "the next round's re-review checks it".
  - The user re-picked "Count the round's fixes" with that correction. The gap existed before R-257 too. A re-check of fixed serious findings is a follow-up card in .oss/dev/FOLLOWUPS.md.
  - This replaces T19's first rule, "any critical or high finding fails", which would have forced an extra ship round whenever something serious was found and fixed.
- D23 T20 owner (user picker 2026-11-18): **Ship R-257 now, T20 later**.
  - R-257 ships slice A plus T18–T28.
  - The recorder hash chain (D15) becomes an R-266 follow-up card, with its own one-shot security review, because it changes R-253/R-266's recorder (state-store.ts, oss-tool-gate.sh). The coordinator files it.
  - Until it lands, build results keep `evidenceTrust: "repo-file"` and the notice says so. D15's open item stays logged, not self-deferred.
  - Consumer step for later: assemble-build.ts trusts only chained events, and `evidenceTrust` becomes `ledger` (`events_tampered` on mismatch).
- D22 T18b scope (user picker 2026-11-18): **Ledger only**.
  - `~/.oss/ledger/**` joins R-266's `protectedPaths`. `.oss/dev/active/*/results/**` does not.
  - Why results/ is left out: R-266's gate refuses a write to any folder that holds protected files. So the archive `mv` of a feature folder, and ship's dev-docs guard `pwd` in `.oss/dev`, would be refused.
  - A results file edited by hand still fails its ledger binding (D14).
  - Results/ protection goes on R-266's OS write-sandbox card.
  - This changes R-266's provenance test, which pins the exact protected list, to add the ledger entry (user pick, quoted in the T18b commit).

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

## Last Updated: 2026-11-18 09:00 CST by /oss:build (D21)
