# Implementation Plan: oss-writer-nofollow (SECURITY hotfix, v2.0.87)

## Summary
Plugin writers that put files under a PROJECT's `.oss/` directory follow symlinks and hard links. A malicious repo that commits `.oss/workflow-state.json -> ../../../.zshrc` gets the target overwritten on the first OSS event. Committed symlinks are recreated by `git clone`.
- **Reproduced** by the AgenticDevWorkflow notify-project-routing pen-test gate, 2026-10-19.
- **What an attacker can do with the state file:** a non-JSON target is truncated and overwritten. A JSON target (for example `~/.claude/settings.json`) is merged and gains keys.
- **With `.oss/workflow.log` or `.oss/logs/current-session/*.log`:** a line is appended to any file the user can write.
- **With `.oss`, `.oss/logs` or `current-session` pointing at an outside directory** (for example `~/.ssh`): files are created there.
- **Limits:** the attacker picks only the target path. The content is fixed JSON or sanitised log lines, so there is no code execution. Hard links behave the same, but git cannot deliver them.
- **Exposure today:** a single-session user whose `~/.oss/current-project` names the malicious repo. That includes the plugin wrapper's ordinary `start` event, which writes the routed workflow-state.

## Source
Boss, 2026-10-19: "make you the boss" and resolve fully. Orchestrated from the AgenticDevWorkflow-g21 session. This lands FIRST among the plugin PRs; plugin-highs takes 2.0.88 after it.

## Decision (ADR-1): one shared guard per runtime, used by every project-.oss writer
- **Bash:** a sourced helper, `hooks/oss-safe-path.sh`. HOOKS_TO_COPY must ship it next to oss-log.sh and oss-notify.sh, and every caller loads it with the `if [[ -f … ]]; then source …; fi` pattern from PR #192.
- **Node:** one module, `watcher/src/utils/safe-project-write.ts` (name to fit the repo).
- **Rule for a write to `<project>/.oss/<rel>`:**
  - `<project>` is a real directory: realpath resolves, and it lies under HOME or TMPDIR, as the existing validators already require.
  - No component from `<project>/.oss` down to the target's parent is a symlink, and each one is a directory owned by the current user.
  - The target is either absent or a regular file with link count 1 that is not a symlink.
  - realpath(target parent) stays inside realpath(`<project>/.oss`).
- **When a check fails:** do NOT write. Print one line to stderr (`oss: refusing unsafe .oss path <rel>`) and exit 0, so a hook never breaks the user's flow, matching today's best-effort writers.
- **JSON state:** write a temp file in the same directory with `O_EXCL | O_NOFOLLOW` (Node: `fs.openSync(tmp, 'wx', 0o600)` after the checks), then `fs.renameSync`. rename replaces a symlink entry without following it.
- **Appends:** open with `O_APPEND | O_NOFOLLOW` (Node: `fs.constants.O_NOFOLLOW`). Bash: check `[ -L ]` and the link count immediately before `>>`. That is TOCTOU-limited, so document it; the target dir is user-owned.
- **Creating `.oss` or subdirectories:** `mkdir` one component at a time, then re-check `! -L` and `-O`.

## Also in this PR (from plugin-highs gate MEDIUM-a + LOWs; plugin-highs agreed it is mine)
- `hooks/oss-notify.sh`: validate the workflow name (`^[a-z][a-z0-9-]{0,40}$`) before it reaches chain-trigger or any URL/path. An invalid name is refused with rc 0 and a stderr note. Example: `build/../ship` must not fire ship's chain.
- `oss-notify.sh:254`: fix the stray quotes in the default `'{}'`.
- `oss-notify.sh:307,370`: build JSON with jq, or a safe printf of validated fields, never by pasting strings.

## Out of scope (separate plugin PR "routing fallback", after this one)
- Prefer the cwd's nearest `.oss` ancestor over `~/.oss/current-project`.
- The HOME/TMPDIR validator gap for repos outside HOME.
- A `complete` state check: no chain after a failed ship. Log it in FOLLOWUPS.

## TDD tasks (RED first, minimal GREEN, anti-vacuity per task; never `git stash`; targeted tests only)
- **N0 provenance (IRON LAW #1b), first:** grep hooks/*.sh and watcher/src for every write, append or mkdir under a PROJECT `.oss` (anything built from CLAUDE_PROJECT_DIR, current-project, the git toplevel, `--project-dir` or the cwd). Classify each site as project-.oss (must use the guard), `~/.oss` (user-owned, out of scope) or read-only. Record the list in NOTES.md. Known sinks: hooks/oss-log.sh:108-109,231-232; watcher/src/services/workflow-state.ts:~362; watcher/src/cli/oss-error.ts:~165; probably workflow-logger.ts, session start's `.oss` and `.gitignore` creation, queue manager, routing-log and iron-law-monitor. Verify each.
- **N1 RED:** a test helper builds a temp HOME plus a "malicious repo" (git init, commit, clone) with committed links:
  - `.oss/workflow-state.json -> <outside file>`
  - `.oss/workflow.log -> <outside file>`
  - `.oss/logs -> <outside dir>`
  - `.oss/logs/current-session -> <outside dir>`
  - `.oss -> <outside dir>`
  - plus a hard-linked state file.

  For each sink, run the REAL hook or CLI (`oss-notify.sh --workflow build failed`, `oss-log.sh write`, `update-workflow-state.js setSupervisor`, `oss-error.js`) and assert the outside target is byte-identical and nothing was created outside. Run under /bin/bash 3.2 and bash 5. Add a control: a normal repo still gets its state and logs.
- **N2 GREEN:** the helpers, plus every N0 project-.oss site routed through them.
- **N3:** workflow-name validation in oss-notify.sh and the 2 LOWs, each with its own RED.
- **N4:** bump `.claude-plugin/plugin.json` 2.0.86 → 2.0.87, add the new helper to HOOKS_TO_COPY, and record LEARNINGS and FOLLOWUPS.

## Rules for the builder
- Work only in /Users/ysl/dev/one-shot-ship-plugin-nofollow.
- Never run `pkill -f vitest`. Run watcher vitest with a config that does NOT load watcher/test/setup.ts, because its `pkill -f watcher/dist/index.js` kills the user's live watcher. The previous agent's config is at /private/tmp/claude-501/-Users-ysl-dev-AgenticDevWorkflow-g21/f1048960-50ff-44e1-aa64-8510f7eb7f1f/scratchpad/vitest.nosetup.config.mjs.
- Pin `CLAUDE_PROJECT_DIR=/Users/ysl/dev/one-shot-ship-plugin-nofollow` on any `~/.oss/hooks/oss-log.sh` call. Never touch any other project's `.oss` or the real `~/.oss` state.

## Ship round 1 findings (2026-10-19 ~16:50) — tasks for /oss:build (round 1: fix every finding)
- [DONE] **G1 (MEDIUM, security M1):** hooks/oss-archive-check.sh:216/:192 — a committed `.oss/dev/active/<name>` symlink makes `mv "$feature_dir" …` (trailing slash) move the OUTSIDE target directory into the repo. Skip entries that are symlinks (`[[ -L "${feature_dir%/}" ]]`) and move `"${feature_dir%/}"`; RED test. Check the `--list` path at :200 too (read-only: decide).
- [DONE] **G2 (MEDIUM, security L1 + code-review M1):** hooks/oss-safe-path.sh:32 — `read -a <<< "$rel"` reads only the first line; a newline in `rel` approves an unsafe path (reproduced). Reject any `rel` with a newline or control character in oss_safe_mkdir and oss_safe_target, AND build the target from the checked components. Also validate COMMAND in oss-log.sh with `oss_valid_workflow_name` before it reaches `${2}.log` (IRON LAW #1b: second site answering the same question). RED tests.
- [DONE] **G3 (MEDIUM, code-review M2):** ownership rule (`-O` in bash, `ownedByMe` in Node) turns off all project writes for root-in-container / bind-mounted repos owned by another uid, and shared-group repos. Relax to: each component is owned by the current user OR by the owner of the (physical) project root directory; keep refusing links and non-directories. Same rule in both twins. RED: a root-owned-style simulation is hard without root — test the rule via an injectable "owner of project root" path or by making the project root's owner the reference (document how it's tested); at minimum a test that a project whose components are owned by the project-root owner passes.
- [DONE] **G4 (LOW, code-review L1):** the bash helper fails OPEN when sourced from zsh (`read -a` invalid). Add `[[ -n "${BASH_VERSION:-}" ]] || return 1` at the top of each function. RED under `zsh -f`.
- [DONE] **G5 (LOW, code-review L2):** HOME exemption differs between twins; HOME-launched sessions with a symlinked ~/.claude/settings.local.json (dotfiles) regress (0 entries merged vs 16 on main). Make bash oss_safe_target return 0 when project == $HOME (match Node). RED.
- [DONE] **G6 (LOW, code-review L3 + security I5):** safeWriteFileAtomic changes file mode to 0600 and leaves the .tmp behind if writeSync throws. Preserve the existing mode (0644 for new files per umask) and unlink the tmp on failure. RED.
- [DONE] **G7 (LOW, security L2, pre-existing):** oss-worktree-create.sh:24 copies the API key over a TRACKED .oss/config.json. Skip the copy when `git ls-files --error-unmatch .oss/config.json` succeeds. RED.
- [DONE] **G8 (MEDIUM perf #2):** oss-log.sh guards `${2}.log` for actions that never write it (hook, read, path, …). Guard it only for actions that write it; skip the guard prologue for read-only actions. RED (assert no .oss dirs created by `read`/`path`).
- [DONE] **G9 (MEDIUM perf #1):** memoise physical paths of project and HOME within one process in oss-safe-path.sh (no behaviour change; prove with a spawn-count or behaviour-equivalence test).
- [DONE] **G10 (LOW perf #4):** oss-log.sh:26 use `${BASH_SOURCE[0]%/*}` instead of `dirname`.
- [DEFERRED (FOLLOWUPS)] **G11 (INFO, security I1):** Node guard: assert basename(ossDir) === '.oss' (or take the project root). RED.
- [DONE (by G3 construction)] **G12 (INFO, security I3):** include the project root itself in the ownership check (consistent with G3's rule).
- [DONE] **G13 (INFO, code-review I2/I3):** consistent fail-closed stubs for every sourcer (no exit-127 noise); refusal text names the actual path kind. Doc/behaviour tests as appropriate.
- [DONE] **G14 (INFO, security I4 pre-existing):** oss-log.sh:199 `ls | xargs rm -f` on whitespace names → use a safe loop / find -delete. RED.
- [DONE (memo); async note in FOLLOWUPS] **G15 (INFO perf #5/#6, code-review I4):** Node: memoise realpath(HOME); StatusLineService.persist async wrapper note; random tmp names leftover → cleanup. Fix if trivial, else FOLLOWUPS.
- [DEFERRED (FOLLOWUPS)] **G16 (from plugin-highs, LOW):** watcher/test/setup.ts kills processes machine-wide by pattern — make it kill only processes the tests started (or record in FOLLOWUPS if out of scope).
- Pen-test: PASS. One LOW, G17 (bash `>>` TOCTOU against a live same-user process): [DEFERRED (FOLLOWUPS), by orchestrator decision]

## Ship round 2 narrow fixes (2026-10-19 ~17:45) — all small, then narrow re-check (code-reviewer + security-auditor)
- [DONE] **N2-1 (regression from G8, code-review MEDIUM + security L1):** hooks/oss-log.sh:130 lists `tail` as read-only but :703-704 `touch "$UNIFIED_LOG"`. Remove `tail` from the read-only list (so it goes through the session.log guard), and re-verify every other read-only entry writes nothing. RED: committed `current-session/session.log` → outside link, `oss-log.sh tail` (non-interactive: make tail exit immediately, e.g. run with a timeout or only the touch path) creates nothing outside; and `tail` on a fresh install doesn't fail.
- [DONE] **N2-2 (security M1, G3 narrowing):** accept a component NOT owned by the current user only when (a) the physical project root is owned by uid 0 (root-in-container / root-owned bind mount) AND (b) that component is not group- or other-writable. Otherwise refuse (current user ownership remains the normal path). Same rule in bash (`_oss_owned_ok`) and Node (`ownedOk`). RED: root-uid simulation as in G3 tests (bash: project `/`-style root-owned dir; Node: mocked uid) plus a group-writable foreign-owned component → refused; and a non-root foreign owner → refused.
- [DONE] **N2-3 (security L2):** safeWriteFileAtomic takes the preserved mode from the lstat already done in safeTarget (or fstat of the checked fd), not a following `statSync`, and masks with 0o777 (drop setuid/setgid/sticky). RED.
- [DONE] **N2-4 (security I1):** webhook-config.ts creates a NEW config.json with mode 0600 (existing files keep their mode). RED.
- [DONE] **N2-5 (doc):** fix the TOCTOU comment at hooks/oss-safe-path.sh:19-20 to match DECISIONS.md (and the new N2-2 rule).
- [DONE: recorded in FOLLOWUPS] Deferred (FOLLOWUPS): perf LOW (one repeated _oss_phys_dir per write; find per target), memo keyed on path string (LOW), HOME-branch `..` hardening (INFO), archive_feature `-d` follows links (INFO), oss-log read/path don't validate name (INFO).

## Ship round 2 narrow re-check finding (N2-6)

- [x] **N2-6 (MEDIUM, regression from N2-3):** `watcher/src/utils/safe-project-write.ts` `safeWriteFileAtomic`, HOME (`~/.oss`) branch. N2-3 changed `statSync` to `lstatSync`. A symlinked `~/.oss/config.json` (stow / home-manager) now keeps the *link's* mode (0755 macOS / 0777 Linux) instead of the target's 0600, so the file holding the API key becomes world-readable after rewrite.
  - RED: the test has a HOME ossDir whose `config.json` is a symlink to a 0600 file. After `safeWriteFileAtomic`, the resulting file must be 0600 (mode & 0o777), not the link's mode. It must fail on the current code: on macOS lstat of a link gives 0755.
  - GREEN: the HOME branch uses `statSync` (follows the link) again, masked to `0o777`. The project branch is unchanged.
  - Rebuild `watcher/dist`. The dist-fresh test must pass.
