# Notes: phase-results (R-257)

## Shared contracts for build (2026-11-13)

Every task that reads or writes these must use exactly this shape. Change it here first.

### Ledger (D14, T3b)
- Root: `$HOME/.oss/ledger/<key>/`. Key: the first 16 hex of the git blob id of
  `"<toplevel>\n<absolute-git-dir>\n"` (what `printf '%s\n%s\n' "$top" "$gitdir" | git hash-object --stdin | cut -c1-16`
  prints). The same derivation as `_ov_key` in `hooks/oss-value.sh`, so a worktree gets its own key. `toplevel` is the
  **physical cwd's** `git rev-parse --show-toplevel`, never `CLAUDE_PROJECT_DIR`.
- `$HOME/.oss/ledger` and every dir below it: mode 700, owned by the current uid, not a link. Files: mode 600, same checks.
  Created with `mkdir -m 700` (bash) / `mkdirSync({mode: 0o700})` (TS), then checked.
- Row files are ndjson, one JSON object per line, each row written with one `O_APPEND` write of under 512 bytes.
  For "current value" files the **last valid row wins**. Unknown row shapes are ignored.
- Read caps: `results/**` and `decisions/**` at 1 MB, everything else at 4 MB. Over a cap: `ledger_too_large`.
- Files:
  | Path (under the key dir) | Row | Writer |
  |---|---|---|
  | `run/<phase>` | `{"startedAt","session","headSha"}` | `oss-notify start` (T10b) |
  | `results/<feature>/<phase>` | `{"sha256","feature","phase","startedAt","headSha","session"}`; `sha256` = hex sha256 of the result file bytes | assembler (T9) |
  | `pending/<feature>/<phase>` | marker file, content `{"check","at"}` | Stop dispatcher (T11); cleared by a successful assemble |
  | `unverified/<feature>/<phase>` | marker file, content `{"check","errorClass","at","session"}` (`session` drives "a second fail-open in one session blocks") | Stop dispatcher (T11) |
  | `decisions/<feature>` | `{"id","feature","sha256"}`; `sha256` = hex sha256 of the exact record line written to `decisions.ndjson`, without its trailing newline | decision hook (T6) |
  | `gates/<feature>` | `{"sha256"}` of the exact timeline gate line, without its newline | `oss-timeline.sh` (T8a) |

### Results (T2, T3)
- `<repo>/.oss/dev/active/<feature>/results/<phase>.json`, phase in ideate|plan|build|ship.
- Feature name: `^[A-Za-z0-9._-]+$`, not starting with `.`.
- Repo marker for the fail-open path: `results/<phase>.unverified.json`.

### Error ids (stable strings, tests match them)
`unsupported_keyword`, `unsafe_path`, `bad_feature`, `too_large`, `ledger_too_large`, `unbound_result`, `stale_result`,
`evidence_mismatch`, `repo_mismatch`, `no_red`, `no_test_runs`, `not_green`, `events_truncated`, `no_tasks`,
`duplicate_task`, `task_without_test`, `design_not_committed`, `empty_diff`, `diff_unavailable`, `gate_missing`,
`override_unrecorded`, `no_feature`, `timeout`.
Added by T9 (CLI): `no_run_started` (no ledger `run/<phase>` row: assemble and check both refuse), `missing`,
`invalid_json`, `invalid_result (<rule>)` (schema; field = JSON path), `unverified` (repo marker, ledger
pending/unverified marker, or `verification` not verified), `no_repo`, `cli_missing` (shell entry, exit 127).
CLI stderr shape: `phase-result: <verb> <phase>: <id> (field <f>); rebuild: oss-phase-result.sh assemble <phase>`.

## Rebase on R-266 (coordinator, 2026-11-13)
- `watcher/scripts/bundle-cli.js` will conflict: R-266 adds tool-gate and gate-run entries. Keep both theirs and ours.
- After the rebase, run the watcher-dist-fresh and bundle tests (targeted) and keep them green.
- Commits stay local; no PR until reported to the coordinator.
- R-266 moves hooks onto a fixed node (`oss_node` in `hooks/oss-node.sh`, recorded in `~/.oss/node-path`). Until then,
  use plain `node`. After the rebase, switch `oss-notify.sh` and `oss-phase-result.sh` to `oss_node` wherever they run the CLI.
- Review agents (code-reviewer, security-auditor, penetration-tester, performance-auditor) run only from R-266's
  Bash allowlist and must never be told to run `oss-phase-result.sh`; a guard row in
  `commands/__tests__/phase-result-step.test.sh` enforces this. The main agent and builders run it freely.
- T10c (oss-notify.sh resolve_cli) needs no pre-commit diff for the coordinator (R-266 doesn't touch oss-notify.sh); it
  goes in the report.

## R-267 headless findings (2026-11-13), what R-257 owes
- CLI resolution in arms loaded via `--plugin-dir`: `oss-phase-result.sh` (T9) and `oss-notify.sh resolve_cli` (T10) look
  in `CLAUDE_PLUGIN_ROOT`, then `~/.oss/plugin-root`, then the plugin cache. Today's order falls back to the cache, which
  arms don't have, so setCurrentCommand never runs and the gate would see `cli_missing`.
- A failed assemble writes nothing, and it does not create `results/`, so the D17 legacy pass still applies (T9 test row).
- Ideate is never run by the R-267 seam; `start plan` with no `results/` takes the legacy pass.

## Implementation notes
- Ship base: repo-local git config `oss.shipBase` (`git config --local --get`, hardened env, 10 s timeout), else `main` when
  unset; assemble and check both use it, and a bad value is refused by assemble-ship's ref checks as `diff_unavailable`.
- The ledger tests import `.ts` from `node -e` child processes, which relies on Node's type stripping (Node 22.6+; Node 26
  here).
- `readResult`/`writeResult` throw `bad_feature`; an unknown phase throws `unsafe_path`.
- The validator's `$ref` forms: `common.schema.json#/$defs/<name>` (through the refs map) or `#/$defs/<name>`. Patterns use
  the `u` flag.

## T9 notes (2026-11-13)
- check order: markers -> file read -> feature/phase fields (`stale_result`) -> ledger sha (`unbound_result`) ->
  schema -> run startedAt (`stale_result`) -> ship HEAD (`stale_result`) -> verification -> evidence re-run.
  Binding is checked before the schema so a hand-written result reads `unbound_result` (acceptance row 3).
- Ship diffs against the local branch `main` (constant `SHIP_BASE` in src/cli/phase-result.ts). No config yet.
- The ship evidence re-run feeds the stored overrides back (temp value dir), since overrides.json ages out after 10 min.
- `check <phase> --all` runs the full check per active feature against the repo's single `run/<phase>` row and the
  current HEAD, so only the feature shipped in this run can read `ok` (T13 must decide what archive needs).

## T11 notes (2026-11-13)
- The dispatcher spawns the phase-result bundle for `check` (bounded spawnSync, plan amendment P5); importing
  src/cli/phase-result.ts would run its main(). Feature resolution moved to src/phase-results/feature.ts (shared).
- Pending is written only when the started phase has no bound result: writing it before a CLI `check` of a bound
  result would make that check refuse. The bash fast path never starts node for a bound result.
- The stop-check-error event is the workflow logger's `STOP_CHECK_ERROR` in `<repo>/.oss/workflow.log`.
- Shell bound test seam: `OSS_STOP_DISPATCH_TEST_BOUND` (seconds, default 5).

## T13/T14 notes (2026-11-13)
- One archive rule, `watcher/src/phase-results/archivable.ts` (`shipArchivable`): repo marker, readResult, ledger
  pending/unverified markers, sha bound (last row, any session), schema, verified, verdict `ready_to_merge`. No
  startedAt or HEAD check. Reasons: `unverified`, `missing`/`unsafe_path`/..., `unbound_result`, `invalid_result`,
  `not_ready_to_merge`.
- `check ship --all` now applies that rule (other phases' `--all` keep the full check).
- `oss-archive-check.sh`: no prose; one CLI call only when some feature has results/ship.json and the dev docs are the
  project's `.oss/dev`. `--list` shows the result verdict instead of the "Current Phase" line.
- `healthchecks/archive.ts` imports `phase-results/archivable.js`, so dist/phase-results/{archivable,ledger,schemas,
  store,validate}.js must be committed (watcher-dist-fresh only checks cli/services/queue imports, so it misses this).
- Test fixture: `hooks/__tests__/lib/archive-ship-fixture.sh` (`archivable_ship <repo> <feature>`, HOME = sandbox).

## Rebase notes from the coordinator (2026-11-14)
- R-266 adds oss-node.sh and oss-node-path.sh to HOOKS_TO_COPY. Keep all entries; ours is oss-phase-result.sh.
- After R-266, the tool gate REFUSES builders and main on a gate timeout. It also refuses a relative write after a `cd` to a folder it can't know.
  - Audit every hook-run step and command block for `cd "$VAR" && <write>`, and use full paths.
  - Known site: plan Phase 0's archive block, `cd "$top"` then `mv -n`. Fixed in API 0af2d521: the moves use `"$top/..."`.
  - **After-rebase check (coordinator, 2026-11-14):** `top=$(git rev-parse --show-toplevel)` is a command substitution, so the gate may not know `$top` either.
    - Run plan Phase 0's archive block through R-266's real tool-gate CLI as the main agent.
    - Confirm the `"$top/..."` mkdir and mv are allowed.
    - If they are refused, report to the coordinator to choose a form the gate can follow. Do not loosen the gate.

## After the R-266 rebase (2026-11-18)
- R-266's gate (oss-hook-env `arithmeticReadsVariable`) reads `((` followed by `$` inside double quotes as arithmetic, and refuses any command that also calls `~/.oss/hooks/…`. Keep regexes like that in single quotes in served prompts (T22). The over-refusal is on R-266's OS write-sandbox card.
- served-commands.acceptance: run it with `OSS_API_REPO=/Users/ysl/dev/AgenticDevWorkflow-r257` to also check the fixture against the API. Without it, it uses the committed fixture (R-266 #233 removed DEFAULT_API_REPO).
- Running the real gate by hand (`hooks/oss-tool-gate.sh pre` with hook JSON on stdin) writes `.oss/tool-gates/events.ndjson` in the project. It is untracked, so never commit it.
- Follow-up (T26 report, not in R-257 scope): oss-notify.sh still runs the workflow-state CLI (`wf_state`) and the copy and chain-trigger CLIs on PATH's node. Only the phase-result CLI moved to the recorded node (D21).

## Last Updated: 2026-11-18 09:00 CST by /oss:build (T26, D21)

### T31 real-transcript note (2026-11-18)
- Where a harness ends subagents with a handback tool (this machine: SubagentHandback), the review agent's final message has no text, so its oss-verdict block is never captured and its gate stays `source: model`, as before T19. That's fail-safe: no gate gets stricter or looser. Plain Claude Code subagents end with a text message, so the capture works there. The served agent prompts already say to write the block as plain text in the reply.
- Unchecked: what `last_assistant_message` holds when the final message is a tool_use.

## Ship round 1: session ID match is unverified (2026-11-18)
- The Stop subject (round 1, finding 1, and D30) blocks only when the run row's `session` equals the Stop hook's stdin `session_id`.
- The row is written from `$CLAUDE_CODE_SESSION_ID`, which equals the transcript UUID here. Claude Code documents the hook's `session_id` as the same transcript ID.
- No local log has captured a real Stop stdin, so this is not proven. Verify it in round 2 integration against a real stop.
- If they differ, Stop never blocks (fail-open). The complete and start gates still refuse a missing result.

## Ship round 3 notes (2026-11-18)
- **Off-branch Stop check:** when the run's feature differs from the branch's feature, Stop checks the result's hash and markers in-process but not its schema. Follow-up: `check --feature F` in the phase-result CLI.
- **D24 rarely applies to captured rows:** D32 keeps a captured fail open until a pass on a changed tree, so D24's "fixed in the final round" rule only applies to model timeline lines (code review, info 6).
- **The deadlineMs 0 seam:** with no time left, a capture records no headSha, so a no-snapshot pass from it can't clear a fail (D36).
- **Fresh executables on macOS:** the first run of a newly written script can take 1.5-4 s (system scan). Tests that write shims and then check for leftover processes must run each shim once first.
- **Unchanged:** the SessionStart pointer helpers in oss-safe-path.sh still use PATH's find, which is off the gate path. session-routing R2-6 counts those calls through a PATH shim.

## Ship round 4 notes (2026-11-18, after the Sprint D merge)
- **Merge clash (D37):** R-266 #236 pins HOOK_CALL_VARIABLES to the served fixture. R-257's new plan archive block runs a hook and sets 11 variables, so the list gained those names. No hook reads any of them before setting it.
- **Hook tests leaked real notifications:** `rm -rf $T` ran while the detached notifier was still alive, and PATH fell through to /opt/homebrew/bin/terminal-notifier. Four R-257 tests now:
  - run hooks with $T/bin plus system dirs only;
  - write style "none" unless the case checks a stub;
  - drain fd 9 before cleanup.
  Check any run of these tests through a tripwire PATH. Pre-existing non-R-257 tests with the inherited PATH were left as they are and raised with the user.
- **Sprint D re-scope (R-266 coordinator, 2026-11-18):** later bundles plug into phase results (claims[], chain[]) and the Stop dispatcher: R-271/R-275 gate discipline, the R-254 workflow guard (`requires`, a pending-chain Stop check) and R-264 code checks. Keep watcher/src/stop/dispatch.ts and the result schemas easy to extend. Build none of it in R-257.

## Ship round 5 notes, builder B (2026-11-19 05:54 CST)
- **D42 evidence cutoff:** build and ideate results carry an optional `evidenceCutoff` (schema: common timestamp), set to the assemble time. Build counts test-run events with ts <= cutoff; ideate counts a pick only when its whole `answeredAt` second ends by the cutoff (the hook stamps seconds). The assemblers take `evidenceCutoff` in their context: undefined = assemble now, a string = re-check with it, null = an older result with no cutoff (old rule, no field).
- **Needs builder C's file:** `reassemble` in watcher/src/cli/phase-result.ts must pass `evidenceCutoff: typeof stored.evidenceCutoff === 'string' ? stored.evidenceCutoff : null` for build and ideate. Until then, check re-derives with cutoff = now and the three D42 tests fail.
- **Stop fast path (pen F3):** the workflow-state.json gate is gone. A folder with no .oss is still checked when this session has a run row anywhere in ~/.oss/ledger/*/run/* (one fixed-path grep, -D skip, only when no .oss was found and run files exist).

## Ship round 5 notes (2026-11-19)
- **D40 needs an `origin` remote.** Ship start snapshots refs/remotes/origin/*. A repo with no origin, or with its remote under another name, gets an empty snapshot, and every base is refused (unsafe_base or no_base_snapshot). Without a remote no PR can be opened anyway, but a differently named remote is a stricter rule than before. Raise it with the user if it matters.
- **Capture timeouts:** resolveRepo, resolveFeature and ledgerKey keep their own 2 s git timeouts. The 3.5 s deadline is created before them, but they cannot be capped inside it. The 7 s shell bound still covers the worst case.
- **F1 limit:** results rows hold no verdict, so only the latest stored ship result can set the cutoff. If ready_to_merge is followed by a blocked ship, every row counts, which is stricter.
- **Staging:** the D41/D44 gate rule refuses any Bash call naming verdict-capture.cjs or verdict-capture.js, so stage watcher/dist by folder (`git add -u watcher/dist`).

## Ship round 6 notes (2026-11-19)
- Verdicts are fails only (D45). A tracked code change clears a captured fail with no second review (D49). Follow-up card: bind reviewer rows to R-266's SubagentStart record, then require a fresh bound review.
- CLAUDE_CONFIG_DIR: capture only reads transcripts under os.homedir()/.claude/projects. With CLAUDE_CONFIG_DIR set, nothing is captured and every gate keeps its model line (D26). Under D45 that only loses fails, never adds passes.
- D46 phase-branch rule: it refuses a base named exactly `<feature>` or one containing `/<feature>/`. A feature called `main` would therefore refuse main.
- oss-timeline.sh: the detached push section, the merge verb and hook mode still find some tools through PATH (outside the gate lines' path).
- Ideate: a pick written in the assemble's own second, but after assemble finished, counts at check and not at assemble.
- D50: the base may be on any remote with the same name. A remote whose name contains a slash never matches, so such a repo fails closed.

## Ship round 7 notes (2026-11-19)
- Threat model (D51): R-257 catches an honest model's mistakes and makes tampering visible.
  - Accepted limits: a decoy branch pushed to the remote, switching branch during a review, a tracked scratch edit reverted before the commit, and hiding a file through the global ignore file.
  - R-266 gate-gaps Tasks 7 and 11 will refuse remote set-url to local paths, git replace, grafts and symrefs under refs/remotes.
- D52: a capture with no reviewed tree writes no row. In repos over 20,000 untracked paths or with a file over 50 MB, fails fall back to the model line.
- An unreadable global ignore file makes ls-files fail, so no row is written (D52).
- verdictsFrom is no longer written; the schema keeps it optional for results stored in rounds 6-7.

## Ship round 8 notes (2026-11-19)
- D55: a fail row whose reviewed trees were pruned by gc is compared using its headSha tree. If that is gone too, the row is ignored and the gate keeps its model line. Only a missing object (cat-file -e exit 1) counts; any other git error keeps the fail open.
- D56: capture's git PATH is fixed at /usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin, so LFS and other clean filters run. A filter planted there is accepted under D51.
- D57 limit: deleting a flagged untracked file is not a change, so its fail clears only with a tracked edit (D49). The blocker text says so.
- Only the global core.excludesFile (with includes) is honoured; repo-local excludes and info/exclude never hide files from the reviewed tree.
- A stale local base: the diff starts from merge-base(snapshot remote SHA, HEAD) when that remote is ahead of the local tip and contains it. Blockers and verdicts are unchanged.

## Ship round 9 notes (2026-11-19)
- D58: a captured fail clears only when one of the feature's own paths differs between the reviewed tree and HEAD. These are the paths in its diff from the merge base, plus what the reviewed tree changed from the review-time merge base. Upstream-only changes from a rebase or merge never clear it.
- D55 limit: if a fail is captured, the feature is rebased, and gc then prunes the row's trees and its headSha (gc --prune=now, or routine gc about two weeks later), nothing is left to compare and the row is ignored. Keeping such rows open would change D55.
- D52 limit: with a sparse checkout, an untracked file hidden only via .git/info/exclude (ignored under D53) that shares its name with an off-disk folder can't be staged by git, so no row is written.
- D60 limit: clean filters outside the fixed capture PATH mean no captured fail.
- The CLI prints refusals as `<id>[: <detail>][ (field <f>)]`; only diff_unavailable details are hints.

## Ship round 10 notes (2026-11-20)
- D61 reads live refs/remotes/<one-segment>/<base>; check reads them again, so a ref that moves between assemble and check gives a mismatch (fails closed).
- D61 needs a ref naming the upstream commit: a rebase onto a bare SHA no ref names (code-review probe P3) still clears. A normal fetch names it.
- D62 limit cost: a row whose review head is off the feature's history costs a merge-base plus a batched state lookup. 200 such rows on a 100,000-file repo took 15.2 s (was 8.9 s), with peak RSS down from 304 MB to 134 MB.
- Known limits, not fixed: `git merge --squash main` into the feature makes upstream changes the feature's own and clears a fail (D58); the 64 MB `--raw` buffer holds roughly 420,000-550,000 paths, beyond which the row is unknown and stays open.
- Above 64 deleted paths the tracked-at-review check uses cached diff lists, since `tree:path` lookups scan a flat folder per name.

## Ship round 11 notes (2026-11-20)
- D65 replaces D62's patch-id: only the ordered + lines and mode lines count, so a resolution that keeps the flagged code stays open, and an indentation-only fix clears.
- Older git (Apple CLT 2.50.1, Debian 2.39) refuses cat-file %(objectmode); lookups use ls-tree, and any lookup error falls back to the diff lists.
- The phase-result bundle must sit at <root>/watcher/dist/cli with <root>/schemas beside it, or it fails with internal_error (field store).

## Ship round 12 notes (2026-11-20)
- D67 trade (owner pick): an honest fix confined to a file upstream also changed stays blocked; it clears through a D69 override naming the gate, or a change to another feature path upstream did not touch.
- ~~FOLLOW-UP (API)~~: resolved in round 13 by D74 — the plugin wrapper (commands/ship.md Step 8), not the served prompt, assembles the ship result and now asks the override picker.
- Batched per-row prep peaks higher in memory (245 MB at 200 off-history rows, was 145 MB) in exchange for 47 git calls instead of 609.

## Ship round 13 notes (2026-11-21)
- D70: the hook writes answeredAt to the whole second, so a row captured in the same second as the override pick stays open (fails closed).
- Known limits, not fixed (D72): remote-ref cost grows per diverged same-name remote; 1,000 off-history rows take about 21 s.
- Gate names: gate rounds 3-11 timeline lines used agent names (`code-reviewer`, `performance-auditor`, `security-auditor`, `penetration-tester`) instead of gate names (`code-review`, `performance`, `security`, `pen-test`); rounds 1-2 and round 12 on use gate names. Hook-written lines were left as they are.

## Ship round 14 notes (2026-11-23)
- The check hook keeps its 10 s limit (raising it would also raise oss-notify's 15 s bound); a timeout now says to run git gc. assemble gives the diff calls 20 s.
- Hook tests with real sleeps (timeline-push, ship-wrapper-chain) time out when the Mac is in maintenance sleep on battery; run the full check on AC power.
