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

## TOCTOU limits (matches the 2.0.87 pen test)
- **Bash appends are racy.** Bash `>>`, `cat >`, `cp` and `tee` after `oss_safe_target` cannot use O_NOFOLLOW. In the pen test, a concurrent same-user process swapping `build.log` for a symlink leaked 31 of 300 lines.
  - Committed repo content cannot exploit this: it needs a live local process running as the user.
  - The directories in the chain are checked (not links; owned by the user, or root-owned and not group/other-writable under a uid-0 project root), so another uid cannot race them unless it is root.
  - Not fixed in this round, on the orchestrator's decision. Tracked as FOLLOWUPS G17.
- **Node appends held.** They use O_APPEND|O_NOFOLLOW and then fstat the open fd for nlink 1; the pen test's 6000-swap race did not break them.
- **Node JSON writes** go to a fresh O_EXCL temp file plus a rename, and rename never follows the destination. A directory component swapped between `lstat` and `open` has the same same-user limitation as bash.
- **Reads still follow links.** Out of scope.

## Ship round 1 amendments
- **G2:** no control characters in a rel. The bash target is built from the directory the checks walked (`_OSS_SAFE_DIR`). oss-log.sh builds `<name>.log` only for writing actions, and only from a name that passes `oss_valid_workflow_name`.
- **N2-2 (narrows G3 below):** a component the current user does not own is accepted ONLY when the physical project root is owned by uid 0 (root-in-container / root-owned bind mount) AND the component is neither group- nor other-writable. A non-root foreign owner is refused, and so is a world-writable dir such as the system tmp. Same rule in both twins.
- **N2-3:** the kept mode comes from the guard's own lstat, masked to 0o777.
- **N2-4:** a new webhook config.json (it holds the secret) is created 0600; an existing one keeps its mode.
- **G3 / G12 (superseded by N2-2):** a component is accepted when it is owned by the current user OR by the uid that owns the physical project root. The same rule is in both twins. The project root is the reference owner, which settles G12 by construction.
  - Tested without root. Bash uses project `/` with the root-owned system tmp directory as components. Node spies `process.getuid` to a different uid.
  - Links and non-directories are still refused.
- **G4:** the bash guard returns 1 unless it is running under bash.
- **G5:** bash `oss_safe_target` accepts any target when project == $HOME, matching Node.
- **G6:** atomic writes keep an existing file's mode; new files get 0666 masked by the umask. The temp file is removed on any failure.
- **G7:** worktree-create never copies the API key over a git-tracked `.oss/config.json`.
- **G8:** read-only oss-log.sh actions create nothing.
- **G13:** every sourcer defines the same fail-closed stubs.
- **G14:** the archive sweep removes one whole name per line.
- **G9 / G10 / G15:** memoisation and fewer forks; no behaviour change.
- **Deferred to FOLLOWUPS:** G11 (it would break the setup of about 10 existing tests), G16 (another suite's setup, not part of this hotfix), G17 (the bash TOCTOU above).
