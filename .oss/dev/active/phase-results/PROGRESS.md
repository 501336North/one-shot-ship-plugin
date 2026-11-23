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

### Ship round 7 fixes, after gate round 5 (2026-11-19)
- [x] Gate round 5: performance passed; code review, security and pen test failed. The user picked D51 (honest-model scope), D52 and D53.
- [x] Builder I:
  - every fail row counts, so a revert to failed code stays blocked;
  - verdictsFrom is no longer written;
  - git calls run with no replace objects and no grafts;
  - large diffs no longer overflow;
  - the D50 base.txt gap is closed;
  - the git-path test is updated.
- [x] Builder J:
  - D52: no row without a reviewed tree;
  - assume-unchanged and skip-worktree bits are cleared;
  - D53: ignore files are .gitignore plus the global file, not info/exclude;
  - git env set.
- [x] Builder K: the snapshot drops symrefs and its loop is linear; the gate rule handles brackets and extensions.

### Ship round 8 fixes, after gate round 6 (2026-11-19)
- [x] Gate round 6: performance passed; code review, security and pen test failed (1 medium, 6 low). The user picked D54-D57.
- [x] Builder L (assemble-ship):
  - D55: gc'd trees fall back to the headSha tree, else the row is ignored;
  - cached, newest-first verdict walk;
  - merge-base diff for a stale local base;
  - a symref base is refused;
  - a hint when there is no local base;
  - D57 blocker text;
  - stale test names fixed.
- [x] Builder M (capture):
  - global-only core.excludesFile;
  - D56 fixed filter PATH for LFS;
  - hidden-bit lists read once per capture, with a per-folder existence cache;
  - duplicate env removed.
- [x] Builder N (gate rule): the class-form close is bounded to its word.

### Ship round 9 fixes, after gate round 7 (2026-11-19)
- [x] Gate round 7: security and code review passed; performance and pen test failed (1 medium, 7 lows). The user picked D58-D60.
- [x] Builder P (assemble-ship, CLI):
  - D58: fails are compared on the feature's own paths only;
  - object checks run only after a git error (606 to 208 spawns at 200 rows);
  - a headSha-only row with a pruned commit is ignored;
  - the most advanced remote is used for the stale-base diff;
  - a hint for a base missing from the snapshot;
  - hint format `id: detail`, and the hint only for valid names;
  - a symlinked ref is refused.
- [x] Builder Q (capture): modified files are listed once per capture (LFS stat-dirty); the sparse ENOTDIR crash is fixed; the LFS docblock is updated.
- [x] Builder R (gate rule): a raw literal-name check, and `$ { }` end the form-close search.

### Ship round 10 fixes, after gate round 8 (2026-11-20)
- [x] Gate round 8: code review and performance passed; security and pen test failed (1 medium found by three gates, 5 lows). The user picked D61-D63.
- [x] Builder S (assemble-ship):
  - D61: the live same-name remote base that HEAD contains and that fast-forwards `from` becomes the start of the diff and the feature's paths;
  - D62: a feature path upstream also changed is compared by the patch-id of its own -U0 change;
  - reftable repos skip the loose-ref walk (ENOTDIR counts as no file);
  - symlinked refs, refs/heads or packed-refs under the common dir are refused;
  - the D58 walk: one ancestry-path list and one cat-file batch (608 to about 400 spawns at 200 deletion rows); only the merge-base and review-base diffs are cached;
  - diverged remotes are ordered by topology, with one merge-base --independent first; a fallback test was added;
  - a null or pruned headSha counts only the feature's own paths.
- [x] Builder T (capture): each modified file goes through the clean filter once (240 x 2 MB LFS edits: 2.2-2.8 s to 1.5-1.9 s); `tree` is unchanged, .oss entries are written back from the tracked index.
- [x] Builder U (gate rule): the set scan ends at `$ { }` too (backslash-set split closed); the dead NAMES check is removed; globTokens, globMatch, specialSetsAsAny and Token are exported for R-266.

### Ship round 11 fixes, after gate round 9 (2026-11-20)
- [x] Gate round 9: all four gates failed (1 high, 4 distinct mediums). The user picked D64-D66.
- [x] Builder V (assemble-ship):
  - older git: lookups use `ls-tree` (no %(objectmode)), with the diff-list route as a fallback; tested under Apple CLT git 2.50.1;
  - submodule entries count as present;
  - D64: the live base is merge-base(ref, HEAD) per same-name remote, so a later fetch doesn't undo it;
  - D65: the feature's added lines and mode lines are compared exactly (pinned diff options, no patch-id);
  - D62 diffs are batched per side and the HEAD side is cached (23.5 s to 0.41 s);
  - lookups are cached per tree-ish and path (11.3 s to 8.7 s at 200 off-history rows).

### Ship round 12 fixes, after gate round 10 (2026-11-20)
- [x] Gate round 10: code review and performance passed; security and pen test failed (3 mediums, all D65 edge cases). The user picked D67-D69.
- [x] Builder W (assemble-ship, CLI, schema):
  - D67: the D65 added-line compare is removed; a fail on a path upstream changed (content, mode, deletion or rename) stays open with its own blocker text; other feature paths keep the D58 rule;
  - D69: an override naming a gate, backed by a recorded decision, clears only that gate's D67 rows; check feeds the gate back; the ship schema allows `gate`;
  - batched per-row prep (rev-list, cat-file, diff-tree --stdin): 200 off-history rows 9.2-10.8 s to 2.5 s;
  - liveBase uses refs/remotes/*/<branch> and dedupes by SHA;
  - argvChunks counts bytes; older-git tests fail loudly instead of skipping; every diff pins its options;
  - stronger tests: the ls-tree route, check-agrees with a moving remote, quoted-name fixes.

### Ship round 13 fixes, after gate round 11 (2026-11-21)
- [x] Gate round 11: code review and performance passed; security and pen test failed (override not bound to a pick; D67 text named the wrong file). The user picked D70-D74.
- [x] Builder X (assemble-ship, oss-value, oss-notify):
  - D70: an override counts only for a ship pick answered exactly `Override <gate>`, and clears only that gate's D67 rows captured before the answer;
  - overrides.json, summary.txt and base.txt are removed by `oss-value.sh dir` and at ship start (links refused);
  - D71: the blocker says "upstream changed a file this feature changes";
  - perf: no batched diff after the first overflow, batches by distinct review state, one boundary walk for all batches (40,000-file reformat 18.9 s to about 15 s);
  - guard tests for multi-boundary merge bases and own-path D67 marking, each checked against its mutation.
- [x] Builder Y (API): found the served ship prompt never assembles the ship result; no API change (D74).
- [x] Builder Z (D74): `assemble ship` prints verdict and blockers; wrapper Step 8 asks `Fix it` / `Override <gate>` per D71 gate and writes overrides.json `{finding, decisionId, gate}` only after that pick; stale shape removed.

### Ship round 14 fixes, after gate round 12 (2026-11-22/23)
- [x] Gate round 12: code review passed; security, pen test (the same --merge medium) and performance (pruned-head regression, loose-object diff timeout) failed. The user picked D75-D77.
- [x] D75: with --merge, Step 8's assemble and override picker run before the merge; no merge while blocked; `merged` then `complete` after it.
- [x] D76: an override entry naming a gate whose decision does not count is refused (override_unrecorded, detail gate).
- [x] Pruned review head: heads filtered with one cat-file before the single walk (1,000 rows, one pruned: 16.7 s to 1.8 s).
- [x] Diff calls share a 20 s budget; a timeout says to run git gc (assemble and the check hook).
- [x] Step 8: Fix it gates first, overrides written last; only a decision answered after the picker counts, re-read up to 5 times.
- [x] Ship-start cleanup runs before the ledger step, so early exits still clear the value files.
- [x] Served-command fixture regenerated with watcher/scripts/served-command-blocks.mjs (ship.md block order).

### Later
- [ ] Ship into feat/determinism-sprint/build (SD-1)
- [ ] T21 oss-lab (after the plugin ships)

## Blockers
- None. R-266's 4 red base tests are fixed in #233 (4458bddb), and R-257 is rebased onto it.

## Last Updated: 2026-11-23 08:08 +07 by /oss:ship (round 14 fixes)
