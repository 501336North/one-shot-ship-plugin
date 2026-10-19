# Decisions: oss-writer-nofollow

## ADR-1 (as implemented): one guard per runtime for every project write

**Bash: `hooks/oss-safe-path.sh`.** The file is sourced, never run, and is shipped in HOOKS_TO_COPY.
- `oss_safe_mkdir <project> <rel-dir>` creates the directory one component at a time.
- `oss_safe_target <project> <rel-file>` checks the parent chain the same way, then requires the target to be absent, or a regular file that is not a symlink and has link count 1 (`find -prune -type f -links 1`, which behaves the same on BSD and GNU).
- `oss_refuse_unsafe <rel>` prints the refusal line.
- `oss_valid_workflow_name <name>` checks `^[a-z][a-z0-9-]{0,40}$`. This name was agreed with the plugin-highs session; its TS twin is `isValidWorkflowName` in watcher/src/utils/workflow-name.ts, which that session owns.

**Node: `watcher/src/utils/safe-project-write.ts`.**
- `safeMkdirOss`.
- `safeWriteFileAtomic`: a temp file opened with `wx` (O_CREAT|O_EXCL, mode 0600) in the same directory, then `renameSync`.
- `safeAppendFile`: `O_APPEND|O_NOFOLLOW|O_CREAT`, then `fstat` on the open fd to re-check that it is a regular file with nlink 1.
- `{ createDirs:false }` keeps the old ENOENT behaviour for callers that never created `.oss` (oss-error, the queue, workflow-logger).

**Rules, the same in both runtimes:**
- The project is resolved physically, so a symlink ABOVE it, such as /tmp -> /private/tmp, is fine.
- Each component from `.oss` (or `.claude`, `.gitignore`'s parent) down to the target's parent must not be a symlink, must be a directory, and must be owned by the current user.
- `.` and `..` components are rejected.
- The physical parent must still lie inside the physical project.
- On refusal: nothing is written, one line goes to stderr (`oss: refusing unsafe .oss path <rel>`), and the exit code is 0.

**Deviations from the PLAN wording:**
1. **No HOME/TMPDIR location rule inside the guards.** Adding one would newly break writers that work today for repos outside HOME, such as the queue in /srv/repo. That gap is the PLAN's out-of-scope "routing fallback" item, so the location rule stays in the routing validators (validate_project_path, validateProjectPath).
2. **project == $HOME is exempt.** That target is the user's own ~/.oss, and dotfile users symlink it. Exempting it matches the PLAN's "~/.oss out of scope" classification.
3. **The guard also covers project-ROOT writes found by N0:** .gitignore, .claude/settings.local.json, and .oss/dev/completed moves. They are the same class of bug and are reached automatically at session start or before /oss:plan.
4. **Fail closed when the helper is absent.** oss-log.sh defines stubs that refuse project writes; global ~/.oss/logs still works. oss-notify refuses every `--workflow` event. HOOKS_TO_COPY always ships the helper beside them, and session-start-copy F12 guards that.
5. **Analytics `-d` JSON at oss-notify.sh:307 was not rewritten.** It now contains only a validated name, which is the PLAN's "safe printf of validated fields". setProgress (line 370) does use `jq -n --arg`.

## TOCTOU limits
- Bash cannot open with O_NOFOLLOW. Between `oss_safe_target` and `>>`/`cat >`/`cp`, an attacker could swap the target for a link. Every directory in the chain has been checked to be user-owned and not a link, so only a process running as the user can do that. A cloned repo's static links, which are the threat here, cannot.
- Node appends use O_NOFOLLOW plus a post-open fstat. JSON writes go to a fresh O_EXCL temp file and a rename, and rename never follows the destination. A directory component swapped between `lstat` and `open` has the same user-only limitation.
- Reads still follow links: for example, workflow-state reads a linked JSON before refusing to write. Reads are out of scope for this PR.
