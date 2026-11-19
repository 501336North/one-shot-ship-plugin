# Progress: phase-results (R-257)

## Current Phase: build (complete; ship next)

## Tasks
- [x] Provenance survey: plugin, API prompts and oss-lab (completed 2026-11-13)
- [x] Ideate: DESIGN.md COMMITTED, D1-D12, ADR-1 (completed 2026-11-13)
- [x] Plan: PLAN.md + plan-only review folded in; D13-D18 (completed 2026-11-13)

### Build slice A
- [x] T1: keyword-subset validator (completed 2026-11-13, 1253e21)
- [x] T2: phase result schemas (completed 2026-11-13, dbbab01)
- [x] T3: result store (completed 2026-11-13, b048eeb)
- [x] T3b: owner-only run ledger (completed 2026-11-13, e75479d)
- [x] T4: assemble build (completed 2026-11-13, 9a3d171)
- [x] T5: assemble plan (completed 2026-11-13, d9ab435)
- [x] T6: decision hook cwd + FIFO + ledger (completed 2026-11-13, 5d326a5)
- [x] T7: assemble ideate (completed 2026-11-13, 1a22f0a)
- [x] T8: assemble ship (completed 2026-11-13, 6788d9f)
- [x] T8a: timeline gate-line hashes in the ledger (completed 2026-11-13, 4b93ae7)
- [x] T9: phase-result CLI and shell entry (completed 2026-11-13, a537870; ship base a83d471)
- [x] T9a: bounded runner that keeps the exit code (completed 2026-11-13, 4372f93)
- [x] T10: complete gate (completed 2026-11-13, 178c68c)
- [x] T10b: start gate + D17 migration (completed 2026-11-13, 178c68c)
- [x] T10c: resolve_cli reads ~/.oss/plugin-root before the cache (completed 2026-11-13, 178c68c; user pick via coordinator)
- [x] T11: Stop dispatcher, not wired (completed 2026-11-13, d91fc50)
- [x] T12: command wrappers call assemble (completed 2026-11-13, a34911b)
- [x] T13: archive check reads results (completed 2026-11-13, 178c68c)
- [x] T14: healthcheck reads results (completed 2026-11-13, 178c68c)
- [x] T15: checkpoint counts from results (completed 2026-11-13, 079bd12)
- [x] T16: delete the dead parser + provenance test (completed 2026-11-13, 1ccdf11)
- [x] D19: ship base from the PR base value file base.txt (completed 2026-11-13, 6bb26b8; user pick)
- [x] Session start copies oss-phase-result.sh to ~/.oss/hooks (completed 2026-11-13, 178c68c; found at T10)
- [x] T17: API plan archive step reads results; dead schemas removed (completed 2026-11-13, AgenticDevWorkflow-r257 2e3bc57e, local only)
- [x] D20: older plugins keep the old PROGRESS.md archive rule when the check is missing or exits 127 (completed 2026-11-14, API 0af2d521; trigger narrowed to 'hook not installed' in cf01dc28; user pick)

### After the R-266 rebase (2026-11-18)
- [x] Rebased onto R-266's merge: plugin onto 829748a, API onto a80487c4; the manifest was regenerated, not hand-merged (completed 2026-11-18)
- [x] After-rebase gate check of plan Phase 0: refused (dq `((`…`$`). Fix is T22; with it, the whole block passes for main and builder, including the `"$top/..."` moves (completed 2026-11-18)
- [x] cd-then-write audit: R-257's four assemble steps pass the gate, and none has a cd before a write (completed 2026-11-18)
- [x] T22: plan.md greps single-quoted + served-command fixture (completed 2026-11-18, API a637039d, plugin 441305ed)
- [x] T23: plan-archive-step local date (completed 2026-11-18, API fc45237a)
- [x] T24: GNU-first stat in R-257 test files (completed 2026-11-18, 13a0d132)
- [x] T25: D17 notice only in an OSS project (completed 2026-11-18, af15fe4e)
- [x] T26: oss_node for the phase-result CLI (completed 2026-11-18; D21 fail closed, user pick)
- [x] T18: hooks.json Stop → oss-stop-dispatch.sh, 15 s (completed 2026-11-18, 7c54ed10)
- [x] T18b: ledger protected; results/ left to the OS sandbox card (completed 2026-11-18, db2647bd; D22 user pick "Ledger only")
- [x] T19: review-agent oss-verdict block + SubagentStop capture → ship evidence (completed 2026-11-18, plugin 6d041aa3, API 80953e7a)
- [x] T27: ship's required gates are ship.md's gate.txt names (completed 2026-11-18, 5efffb7d)
- [x] T28: setup for three hook tests broken by T10/T26 (completed 2026-11-18, 5580809a)
- [x] T29: captured-verdict gates count the round's fixes (completed 2026-11-18, 44f15f00; D24 user pick, re-confirmed after the correction)
- [x] Code-simplifier pass (completed 2026-11-18, e1697270)
- [x] Rebased onto Sprint D d9c65865 (#234, docs only; FOLLOWUPS kept both sides)
- [x] T30: setup for four more hook tests broken by T10/T26, found by the final sweep (notify-timeline, oss-archive-check, oss-notify-bounded-group, oss-notify-complete-bounds) (completed 2026-11-18)
- [-] T20: recorder hash chain, MOVED to an R-266 follow-up card by D23 (user pick); D15's "repo-file" label stays

- [x] Ship round 1 fixes (all 4 gates failed; D25-D30, user picks 2026-11-18) (completed 2026-11-18)
  - A, gate code (D25):
    - plugin-root and ~/.oss/watcher are protected;
    - CLAUDE_PLUGIN_ROOT is trusted only for the installed plugin;
    - oss-node.sh comes only from ~/.oss/hooks, and session start now copies it there;
    - git and jq come from fixed paths;
    - the D17 legacy bypass is closed;
    - run rows record their feature;
    - the D26 notice.
  - B, Stop:
    - the subject is the same session and feature, plus D30;
    - the nested repo is checked through CLAUDE_PROJECT_DIR;
    - the fast path checks markers and the hash;
    - the .oss check comes first;
    - git is bounded;
    - the notifier runs in the background;
    - lastRow reads the tail only;
    - a large ledger fails open.
  - C, ship evidence:
    - unverified markers are cleared after an assemble;
    - D26 gateEvidence;
    - D27 LOW+;
    - verdicts are bound to the reviewed tree (tree, plus trackedTree for untracked leftovers);
    - a re-roll can't erase a fail;
    - only the exact oss: agent types count;
    - the block parser is linear;
    - base must exist on origin;
    - archive uses the feature's latest ship;
    - writeResult re-checks before the rename.
  - D, API: D29 archives nothing on old plugins; verdict-block wording for D27; manifest at 138.

- [x] Ship round 2: code review and performance passed; security and pen-test failed (MEDIUM/LOW only). User picks D31-D35 (2026-11-18)
- [x] Ship round 3 fixes (D31 fix all; D32-D36) (completed 2026-11-18)
  - A, shell tools:
    - cat, mktemp, rm, mkdir, cut, find, sort, tail and env come from fixed paths; node runs with PATH=/usr/bin:/bin;
    - dirname is fixed in oss-notify, the archive check and checkpoint (a fake dirname loaded forged gate scripts);
    - oss-safe-path.sh resolves the feature with a fixed git (a fake git changed the feature);
    - D33 comment;
    - D35: ship complete needs ready_to_merge.
  - B, Stop:
    - every phase this session started is checked;
    - a run naming F is checked for F off-branch, and fails open with a marker if F's folder is gone;
    - the unfiled/<phase> marker;
    - gitBin(), git with PATH=/usr/bin:/bin;
    - PATH is fixed after the pre-check;
    - one git check (about 145 -> 80 ms).
  - C, ship evidence:
    - the race fix (readBack, written-bytes hash, code-pinned sources);
    - the no-feature start gate;
    - D32 fail until re-review;
    - the N4 deletion check;
    - SubagentStart snapshot with start match (removed in round 6, D45);
    - blob-free trees, 50 MB cap, one 4 s deadline;
    - D34 (corrected) real remote base made before the run;
    - archive reads no-feature ship runs, with a tail scan;
    - D35 verdict in check ship;
    - D36 a no-snapshot pass clears a fail on a new commit;
    - fixed tools in oss-verdict-capture.sh.
  - Flaky stop-hook-wired (3/10) fixed at the root: macOS scans a new executable on first run (1.5-4 s), longer than run_capped's 2 s grace. The test now runs its shims once first (15/15).

### Ship round 4 fixes, after the Sprint D merge (2026-11-18)
- [x] Merged origin/feat/determinism-sprint/build 5424a129 (R-266 #236) as 9b338a0a. The dev-docs guard passes.
- [x] D37: added the 11 variables set by R-257's plan archive block to HOOK_CALL_VARIABLES. No hook reads them before setting them. The provenance false positive is reworded.
- [x] D38: fixed R-257's two flaky hook tests, oss-stop-dispatch and notify-timeline. The cause was the macOS first-exec scan of fresh stubs; the stubs are now warmed once per run. R-266's round20b flake was already fixed by #236.
- [x] The notifier leak: four R-257 hook tests could reach the real terminal-notifier after `rm -rf $T`. They now use a safe PATH, a settings.json with style "none" and an fd-9 drain, and are proven with a tripwire.

### Ship round 5 fixes, after gate round 3 (2026-11-19)
- [x] Gate round 3: code review, security and pen test failed; performance passed. The user picked D39-D44.
- [x] Builder A (verdicts):
  - H1: only passes newer than the newest fail decide.
  - Pen F1: open fails survive a restarted run, and gate lines are compared at whole seconds.
  - Pen F2 and D43: rules for fails with no tree or no headSha.
  - M1: a blind start no longer records match.
  - D41: the capture CLI reads only the agent transcript.
  - The capture deadline runs from process start; changed-path caps; stale start markers are cleared; the 500 ms bound; no PATH dirname.
- [x] Builder B (Stop):
  - D42: evidence cutoff for build and ideate.
  - Pen F3: the Stop fast path decides from ledger run rows.
  - stop-hook-wired now fails when a notifier lingers.
- [x] Builder C:
  - D40: an origin snapshot in run/ship.origin, and the base must be contained in it.
  - D41: a new gate rule refuses direct calls to the capture hook or CLI.
  - IFS allowed only as a prefix to read.
- [x] Builder D: D43, D44 (refuse verdict-capture.js), and the ship-wrapper-chain setup (an origin ref for D40).

### Ship round 6 fixes, after gate round 4 (2026-11-19)
- [x] Gate round 4: performance passed; code review, security and pen test failed. The user picked D45-D49.
- [x] Builder E: D45 fails only; the verdictsFrom cutoff is frozen; hard-linked transcripts are refused.
- [x] Builder F: D46 same-name origin base, with ref-to-SHA snapshots.
- [x] Builder G: linear glob matcher, ideate same-second picks, oss-timeline fixed tool paths, Stop grep reads only phase files.
- [x] Builder H: D48 (a capture with no tree and no HEAD writes no row); the dead start-snapshot code is removed.

### Later
- [ ] Ship into feat/determinism-sprint/build (SD-1)
- [ ] T21 oss-lab (after the plugin ships)

## Blockers
- None. R-266's 4 red base tests are fixed in #233 (4458bddb), and R-257 is rebased onto it.

## Last Updated: 2026-11-19 10:20 CST by /oss:ship (round 6 fixes)
