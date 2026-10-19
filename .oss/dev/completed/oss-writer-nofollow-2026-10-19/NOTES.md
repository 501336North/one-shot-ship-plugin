# Notes: oss-writer-nofollow

## N0 provenance list (IRON LAW #1b)

Swept hooks/*.sh, .claude-plugin/hooks/*.sh and watcher/src for every write, append, mkdir, rm or mv whose path is built from CLAUDE_PROJECT_DIR, ~/.oss/current-project, the git toplevel, --project-dir, CLAUDE_WORKTREE_PATH or the cwd. Reachability was checked against .claude-plugin/hooks.json, HOOKS_TO_COPY, commands/*.md and the served prompts in AgenticDevWorkflow (plan.ts calls oss-archive-check.sh).

### A. Project writers, reachable: now routed through the guard (17)
| Site | Write | Link that used to escape |
|---|---|---|
| hooks/oss-log.sh: log dir chain | mkdir -p of .oss/logs/{current-session,archive} | .oss, .oss/logs, current-session |
| hooks/oss-log.sh: session.log and `<cmd>`.log | `>>` append | file symlink or hard link |
| hooks/oss-log.sh: `workflow set-feature/complete/clear` | `cat >` .oss/health-workflow-state.json | file link |
| hooks/oss-log.sh: `health-check` | `tee` current-session/health-check.log | file link |
| hooks/oss-session-start.sh: .oss creation | mkdir | .oss link |
| hooks/oss-session-start.sh: .gitignore | `>>` or `cat >` (project root) | .gitignore link (appends `.oss/*` to e.g. ~/.zshrc) |
| hooks/oss-session-start.sh: watcher.pid | rm -f | .oss link (deletes `<outside>/watcher.pid`) |
| hooks/oss-setup-permissions.sh | .claude/settings.local.json create or merge | link to ~/.claude/settings.json (adds global allow rules) |
| hooks/oss-session-end.sh | `cat >`/`>>` .oss/session-context.md | file link, .oss link |
| hooks/oss-worktree-create.sh | cp ~/.oss/config.json, `cat >` workflow-state.json | config.json link, .oss link (the API key leaves the worktree) |
| hooks/oss-worktree-remove.sh | rm -f / rm -rf under .oss | .oss link (deletes outside config.json, logs/, ...) |
| hooks/oss-archive-check.sh (precommand before /oss:plan, plan.ts) | mkdir, then mv of dev/active/* into dev/completed | dev/completed link (moves committed docs anywhere, e.g. ~/.claude/commands) |
| watcher services/workflow-state.ts (update-workflow-state.js) | writeFileSync of workflow-state.json | file symlink, hard link, .oss link |
| watcher cli/oss-error.ts (oss-error.js) | appendFileSync of workflow.log | file symlink, hard link, .oss link |
| watcher queue/manager.ts (drain-queue.js, health-check.js) | writeFileSync of queue.json.tmp and the archive .tmp files | .tmp link (truncates the target) |
| hooks/oss-notify.sh | none directly; delegates to the two above | the workflow name reached log paths and chain-trigger (fixed by name validation) |
| hooks/oss-precommand.sh | delegates to oss-log.sh, archive-check and drain-queue | covered through those |

### B. Project writers in library code no shipped entrypoint reaches: also routed (9)
- `index.ts` Watcher: watcher.pid (written through a dangling link) and watcher.log.
- `config/webhook-config.ts`.
- `logger/workflow-logger.ts`.
- `services/status-line.ts`.
- `supervisor/watcher-supervisor.ts`.
- `agents/pr-monitor-state.ts`.
- `agents/config.ts` saveAgentConfig.
- `services/spec-metrics.ts`.
- `spec-reconciler/diff-generator.ts` logDiff.

These are routed so that wiring any of them up later cannot reopen the hole.

### C. Not a write-through sink: left as is, with the reason
- `oss-precommand.sh` `mkdir -p "$OSS_DIR"` and `cli/health-check.ts` `mkdirSync(projectOssDir)`. mkdir(2) never follows a FINAL symlink: an existing linked dir is a no-op, and a dangling link fails with EEXIST/ENOENT. Verified by experiment.
- `hooks/oss-iron-laws-sync.sh` CLAUDE.md. It already has its own guard (symlink, regular-file and parent checks, then a rename-based write). That is a second implementation of the same question. Converging it is recorded in FOLLOWUPS rather than done here, because the other session's iron-laws work is in flight.

### D. ~/.oss (user-owned, out of scope)
check-updates, context-health, ask-telegram*, session-start ~/.oss/{plugin-root,current-project,hooks}, settings, prompt-cache, metrics, events, tutorial, start-proxy, models, telegram-*, iron-law-monitor state, routing-log and model-routing.log. The guards exempt project == $HOME, so a symlinked ~/.oss (dotfiles) keeps working; there is a control test for this.

### E. Unreachable scripts (no hooks.json entry, not in HOOKS_TO_COPY, no command or served prompt references them): not routed, see FOLLOWUPS
- hooks/oss-session-start-new.sh
- hooks/oss-session-start-test.sh
- hooks/checkpoint.sh
- hooks/create-handoff.sh
- hooks/learn-extractor.sh
- hooks/oss-write-learning.sh
- cost-tracker.ts (never constructed)

### F. User-chosen output paths: out of scope
- run-comparison and benchmark `--output`.
- OSS_PROXY_LOG.
- pr-task-executor's mkdtemp commit message.

Counts: A 17, B 9, C 3, D 13+, E 7, F 3.

## Gotchas found while building
- Another session's `watcher/test/setup.ts` runs `pkill -f "oss-session-start"`, `pkill -f "health-check.js"` and `find $TMPDIR -name watcher.pid -delete`. That killed test runs, deleted sentinels, and once killed an anti-vacuity loop mid-revert; the file was restored by hand and checked with cmp.
  - The suite therefore runs session start as a copy (`s-start.sh`) and keeps its world under /tmp, not $TMPDIR.
  - The anti-vacuity script reads file names from stdin and restores the file on TERM.
- The user's XDG git ignore (~/.config/git/ignore) drops `.claude/settings.local.json`. The test repo uses `git add -A -f`.
- `oss-notify.sh`'s `'{}'` default made `jq` fail under `set -e` for every context-less `--issue` event, so those events were never logged.
- `oss-archive-check.sh` `((archived_count++))` from 0 exits under bash 5 with `set -e` after the first archive (pre-existing; FOLLOWUPS).
