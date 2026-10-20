# Testing: notify-routing-unify

## Strategy
Outside-in: the REAL hooks and the REAL built watcher CLIs run in a sandbox HOME with two real git
projects A and B (both with a real `.oss`), `~/.oss/current-project` = B, `CLAUDE_PROJECT_DIR` unset,
cwd in `A/sub/deep`. Plus C (repo, no `.oss`) and D (repo whose `.oss` is a link). Each event must land
in A (or `~/.oss` from C/D), never in B, never through the link.

- `hooks/__tests__/project-routing.test.sh` (new, 43 assertions): T1 notify state, T2 notify + oss-log
  write/test/phase/agent logs, phase/agent state, workflow set-feature, health-check; T3 oss-error and
  update-workflow-state CLIs + end-to-end "B untouched"; T4 TMPDIR unset; T5 oss-value failed + "the walk
  exists once"; T6 archive-check.
- `watcher/test/utils/project-dir.test.ts` (new, 6): the TS twin.
- Retargeted (they pinned the old current-project rule): watcher `test/hooks/oss-log-{error-recovery,
  milestone-skill,hook-action,project,project-local,health-check}.test.ts`, `oss-notify-project.test.ts`,
  `test/cli/update-workflow-state.test.ts` - now run inside a git-initialised project (cwd) or outside any
  project (`cwd: os.tmpdir()`), with current-project pointing elsewhere to prove it is ignored.

## T6: remaining `~/.oss/current-project` readers (provenance)

| Site | Runs as | Decision |
|------|---------|----------|
| `hooks/oss-session-start.sh` (+ `-new`, `-test` copies) | CC SessionStart hook | WRITER; kept (other CC-run hooks' legacy fallback) |
| `hooks/oss-session-end.sh` | CC SessionEnd hook | clears it; kept |
| `hooks/oss-statusline.sh` | CC statusLine (stdin `workspace.current_dir` first) | kept as legacy last resort |
| `hooks/oss-precommand.sh` | CC UserPromptSubmit hook (`CLAUDE_PROJECT_DIR` first) | kept as last resort |
| `hooks/oss-archive-check.sh` | MODEL-RUN (served `/oss:plan` runs it via Bash, no `--project-dir`) | CHANGED -> `oss_resolve_project` (RED: from A it archived B's finished feature) |
| `hooks/oss-notify.sh`, `hooks/oss-log.sh` (5 sites) | model-run | CHANGED (T1, T2) |
| `watcher/src/cli/oss-error.ts`, `update-workflow-state.ts` | model-run (and via hooks) | CHANGED (T3) |
| `hooks/oss-value.sh` | model-run | never read it; walk now shared (T5) |

`grep -rlF current-project hooks/*.sh watcher/src` after this branch: the CC-run rows above, plus comments in
`oss-safe-path.sh`, `oss-value.sh`, `oss-archive-check.sh` and `utils/project-dir.ts` that say it is never read.
Not changed: `hooks/oss-statusline.sh` also reads bare `$TMPDIR`, but it does not run under `set -u` (no crash).

## Results (2026-10-20, one sequential run)
- hooks/__tests__ + commands/__tests__ (44 suites, `env -u CLAUDE_PROJECT_DIR bash`): 43 green; only
  ideate-template 3/4 (pre-existing). project-routing 43/43 also on bash 5 (/opt/local/bin/bash);
  oss-value 328/328 on bash 3.2 and 5; watcher-dist-fresh PASS (122 files).
- watcher vitest (no-setup config, root = this worktree): test/hooks + utils/project-dir +
  cli/update-workflow-state* + cli/oss-error + acceptance/integration error-contract: 40 files, 233/233.
  Also retargeted test/hooks/oss-session-logging.test.ts (2 cases: start runs outside any project;
  session-end creates the repo's .oss, so its hook lines are that project's).
- watcher `tsc --noEmit`: clean.

## Ship round 1 (2026-10-20): per-session pointer + git-free walk

- `hooks/__tests__/session-routing.test.sh` (new, 106; ACCEPTANCE): sandbox HOME, four sessions S1..S4 ->
  four real repos P1..P4 (each with a stray `sub/stray/.oss` and a real submodule `mod`). Pointers written by
  the REAL SessionStart hook in shuffled order (S3, S1, S4, S2), aged 9/4/2/0 days. Then oss-notify,
  oss-log write/phase/agent, oss-value failed, oss-error, update-workflow-state with
  `CLAUDE_CODE_SESSION_ID=Sn` and no CLAUDE_PROJECT_DIR, from (a) the stray sub-folder, (b) outside any
  repo, (c) the submodule: 84/84 land in Pn only (no artifact in any other product, stray .oss, submodule,
  ~/.oss or the outside folder). Fallbacks (shell oss-log AND TS update-workflow-state, both -> the walk):
  no pointer, id unset, linked file, linked id folder, linked ~/.oss/sessions, relative path, two-line
  path, folder with no .oss, id with `/..`. SessionEnd removes only its own pointer; PreCompact keeps it;
  the stdin session_id gets a pointer too; an invalid stdin id writes nothing; 31-day pruned, 29-day kept;
  a linked ~/.oss/sessions is refused by the writer; modes 700/700/600.
  Anti-vacuity: 11 mutations of the guards, 10 turned it red (file link, id-folder, sessions-folder,
  absolute, one-line, id regex, real .oss, PreCompact guard, prune age, stdin-id write); the 11th (prune
  keep-ids) survived -> the code was redundant (the write runs first) and was removed.
- Foreign owner: not producible without root on macOS. Covered in `watcher/test/utils/project-dir.test.ts`
  (geteuid spied to another uid -> null; mutation dropping the uid check turns it red). The shell twin uses
  `-O` on all three paths (same rule, not exercised by a test).
- `hooks/__tests__/project-walk.test.sh` (new, 25): R1-3 repros (`core.worktree=../..`, nested repo with
  `core.worktree=<A>` and its sub-folder -> never the enclosing project; GIT_DIR/GIT_WORK_TREE env ignored)
  and R1-2 twin parity on one tree (trailing space, newline in a name, `.git` FILE, submodule, nested repo,
  stray .oss outside a repo, linked .oss): shell and TS agree on every case. RED before: 15/25.
- `hooks/__tests__/no-stray-oss.test.sh` (new, 4): precommand, session-start, session-end create no `./.oss`
  with no project known; control: with CLAUDE_PROJECT_DIR precommand still finds the queue.
  Source of `watcher/.oss`: oss-session-logging.test.ts (pre-T7) ran session-start from the watcher folder.
  Retargeted: its session-end case now asserts no `.oss` is created and the hook lines go to the global log.
- `project-routing.test.sh` +2 (R1-5): health-check outside any project -> new message, nothing run;
  CLAUDE_PROJECT_DIR=/usr -> refused by validate_project_path.

### Results (2026-10-20, one sequential run)
- hooks/__tests__ + commands/__tests__ (47 suites, `env -u CLAUDE_PROJECT_DIR bash`): 46 green;
  ideate-template 3/4 (pre-existing). New suites also green on bash 5: project-walk 25, project-routing 45,
  no-stray-oss 4, session-routing 106. oss-value 328/328; watcher-dist-fresh PASS.
- watcher vitest test/hooks + test/utils + test/cli (no-setup config): 60 files, 556/556.
- `tsc --noEmit`: clean. No `.oss` under the worktree except the root one afterwards.
- Pre-existing, not changed: several watcher hook tests (oss-session-logging, oss-userpromptsubmit-logging)
  write to the REAL ~/.oss session log (they use os.homedir()).

## Ship round 2 (2026-10-20)

RED -> GREEN per task (every new guard mutation-checked: reverted, its test went red, restored):
- R2-1 `session-routing.test.sh` +15 (S1's pointer = product 1, cwd product 2 / product 2/work: oss-notify,
  oss-log write/phase/agent, oss-value failed, oss-error, update-workflow-state, archive-check -> product 2):
  106/121 -> 121/121. `project-dir.test.ts` +2 (another repo's .oss over the pointer; stray in the
  pointer's repo keeps it). `project-walk.test.sh` +6 parity (pointer spelled through a link + stray,
  another repo, nested repo). Mutations: pointer-always-wins -> 11 shell + 1 TS red; pointer bound
  computed without the physical path -> 1 red.
- R2-2 `project-walk.test.sh` +12 parity: attacker-made .git + .oss in another user's folder -> no project
  (and the pointer keeps its product), own .oss in a foreign repo -> none, a foreign .oss is skipped,
  control. Foreign owner simulated per path: BASH_ENV `test` function (shell `test -O`) and a
  `--require` shim on fs.lstatSync uid (TS). `project-dir.test.ts` +1 (geteuid spy). 33/43 -> 43/43.
  Mutations: each twin's .oss owner check -> 2 red; each twin's .git-holder owner check -> 1 red.
  (Replaces round 1's "shell foreign owner not exercised by a test".)
- R2-3 `no-stray-oss.test.sh` +1: current-project = B (2 queued), cwd in P (1 queued) -> P's. 4/5 -> 5/5.
- R2-4 `oss-writer-nofollow.test.sh` +4: committed links at session-<now..now+15s> names (archive/*.log
  and logs/session-*) -> nothing moved outside; controls: a normal repo still rotates and archives.
  47/49 -> 49/49. Mutations: either refusal removed -> its repro red.
- R2-5 `oss-value.test.sh` +3: failed / agent / error from a project folder whose name ends in a newline
  land in that folder's .oss. 328/331 -> 331/331. Mutations: oss-value back to $(pwd -P) -> 3 red;
  _oss_phys_dir stripping the newline -> 3 red; oss-log log base through $(...) -> 2 red.
- R2-6 `session-routing.test.sh` +3: prune runs find once (PATH shim, was 14); an old non-id folder is
  kept; an old foreign-owned folder is kept (the id and owner checks had survived mutation before).
  121/122 -> 124/124. Mutations: -mtime +28 -> red; id check dropped -> red; owner check dropped -> red.

### Results (2026-10-20 17:08 +07, one sequential run)
- hooks/__tests__ + commands/__tests__ (47 suites): 46 green; ideate-template 3/4 (pre-existing).
  session-routing 124, project-walk 43, oss-value 331, oss-writer-nofollow 49, project-routing 45,
  no-stray-oss 5, oss-safe-path 25; watcher-dist-fresh rc 0.
- watcher vitest test/hooks + test/utils + test/cli (no-setup routing config): 60 files, 559/559.
- `tsc --noEmit`: clean. No `.oss` under the worktree except the root one.
