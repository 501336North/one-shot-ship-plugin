# Notes: tool-gates (R-253)

## From /oss:plan (2026-11-09)
- **Base branch:** every R-253 PR targets `feat/determinism-sprint/build`, never `main` (Sprint D rule, confirmed by the OSS DETERMINISTIC session). Wherever `/oss:ship` says main, use the sprint branch.
- **Never emit `permissionDecision: "allow"`.** It skips the user's permission prompt. Allow = exit 0 with no stdout.
- **Verify before Task 17 GREEN:** the PreToolUse field that shows text to the agent without deciding (planned: `hookSpecificOutput.additionalContext`). Ask `claude-code-guide`, and record the answer here.
- **Verify in R-267:** `PostToolUseFailure` payload shape (`error: "Exit code N…"`, `is_interrupt`) was seen on Claude Code 2.1.319; a later version could change it.
- **Not covered by the RED rule:** Bash writes onto source files (`sed -i`, `>`, `cat <<EOF > src/x.ts`). The design limits the RED rule to the edit tools. If R-267 shows agents routing around it this way, raise it as a follow-up.
- **Push without a refspec** checks the current branch only. An upstream that points at `origin/main` from a feature branch is allowed (requirements edge case).
- **`watcher/` test config runs single-fork and sequential.** Temp repos must be unique per test (`mkdtemp`), never shared paths.
- **Ship gates for `hooks/*.sh`:** run all of `watcher/test/hooks` with `CLAUDE_PROJECT_DIR` unset (FOLLOWUPS #64 lesson).

## From /oss:build (2026-11-09)
- **Baseline before T2** (`feat/tool-gates/build` at 199a078): 4049 tests, 17 failed.
  - 14 are our RED acceptance tests.
  - 3 already fail on the sprint base, not from this branch:
    - `test/agents/model-frontmatter.test.ts` and `test/agents/offload-step-safety.test.ts` fail on agent counts, apparently since `penetration-tester` was added in 2.0.99.
    - `test/commands/chain-step-contract.test.ts` has 1 failure.
  - Left alone per the small-releases rule; they need their own follow-up.
  - **Fixed separately** (user pick): PR #221 (`fix/main-test-drift/build`, 297a5af, tests only, no release). All 3 were stale tests. Not merged.
    - **Before the tool-gates ship:** merge #221 to main, then merge main into `feat/determinism-sprint/build`.
- **Hook output contract checked** against https://code.claude.com/docs/en/hooks (2026-11-09, via `claude-code-guide`):
  - `hookSpecificOutput.additionalContext` is supported on PreToolUse. Claude sees it as a system reminder.
    - Write it as a factual statement ("tool-gate failed, rules not checked."), not an imperative, or Claude's injection defences may surface it to the user instead.
    - Combining it with no `permissionDecision` isn't stated explicitly. R-267 confirms it in a real session.
  - Exit 0 with no output means no decision; the normal permission flow continues. Exit 2 blocks the call, and the stderr is the reason.
  - Any other non-zero exit is non-blocking: the user sees a notice, and the docs don't say Claude does. The wrapper therefore maps it to exit 0 plus additionalContext.
  - `permissionDecision: "allow"` skips the prompt. Never use it.
  - Timeouts:
    - The hook `timeout` is in seconds; the default is 600.
    - A timed-out PreToolUse hook doesn't block the call, which matches ADR-005.
    - hooks.json sets `timeout: 5`, so a hung gate costs 5 s, not 10 min.
  - PostToolUseFailure carries `error`, an optional `is_interrupt` and `duration_ms`.
  - Subagent calls carry `agent_id` / `agent_type`. Whether they share the parent's `session_id` isn't documented, which supports ADR-008's build-stamp choice.
- **T2 tokenizer notes from the agent:**
  - `eval` and `-c` count as unreadable only in command position.
  - `&`, `(`, `)`, `;;` and `|&` are operators. A `cd` inside `( … )` must not carry over past the `)` (T3).
  - Heredoc bodies are never scanned. An unquoted delimiter can hide `$(…)` in the body, but that would be "unreadable → allowed" anyway.
  - `<<`, `<<-`, `<<<` and `<` are inputs, not writes.
  - A redirect target starting with `&` duplicates a file descriptor; it is not a file.
- **T2b:** a NUL ends a `$'…'` part, as in bash 5.3. An out-of-range `\U` makes the command unreadable. Unknown escapes stay as written.
  - **Test-writing gotcha:** an agent's written `\u006d` can arrive in the file as the letter `m`. Build such backslashes at runtime in tests, and check the file's bytes.
- **T3b decisions:**
  - The outer `bash` / `eval` part is kept, and the nested parts follow it.
  - Nesting is read 5 levels deep.
  - Nested parts take on the outer part's `pipedOut` / `orTrue`.
  - `env -C` / `sudo -D` change the part's directory.
  - The wrapper and shell-option tables are code constants. They describe what the shell does; they aren't rule values.
  - `>& file` with a space is read as a write to `file`.
- **T7b:** git itself calls `--forc` ambiguous. We expand it to `--force` because `--force` is a prefix of the other matches. This can only add refusals, for commands git would reject anyway. Gap: `--recurse-submodules <value>` isn't in the value-skip set. It doesn't weaken any rule today.
- **Flake outside this branch:** `test/agents/registry.test.ts` "should emit event when agent exceeds error threshold" failed once in a full run under load. It uses a fixed 100 ms wait with 10 ms polls, and passes alone. Not ours: it goes to FOLLOWUPS and its own fix branch, and is raised with the user at ship.
- **Ship todo:** add a FOLLOWUPS entry for the shell-reading limits in DESIGN.md Known Limits.
- `feat/tool-gates/build` is stacked on `feat/tool-gates/plan`, because the plan isn't merged into the sprint branch yet. The PR still targets `feat/determinism-sprint/build`.

- **T11b (5cb82a7/f6d628f):**
  - Write targets and `EditCall.filePath` keep `..` as written (`raw-path.ts` `joinRaw`). `realPathResolver` walks one name at a time, following each link before it climbs `..`.
  - Refusals name the path as the agent wrote it.
  - BSD `sed -i ''`: the empty word is the backup suffix, not a file.
  - **Stricter than before:** `git checkout -- .`, `git restore .`, `chmod -R … .` and `touch .` at the repo root are refused ("holds protected files"), the same as `rm -rf .`. The agent should name the files instead.
  - **Known gaps (FOLLOWUPS at ship):**
    - `git -C link/..` and `env -C` still collapse `..` as text.
    - `chmod --reference=` and `chmod -w` list nothing.
    - `ln`/`install --target-directory=` isn't read.
    - `python -c` / `node -e` writes aren't read.
    - A symlink swapped in after the check (time-of-check race).
- **T12 (9af1738/0689a31):**
  - The stamp is `$.currentCommandStartedAt` in `<project>/.oss/workflow-state.json`. It is set in `WorkflowStateService.setCurrentCommand` (`watcher/src/services/workflow-state.ts`), only when the command changes.
  - `oss-notify.sh` clears `currentCommand` on complete, so a re-run of `/oss:build` gets a fresh stamp. `clearCurrentCommand` leaves the old stamp in place.
  - `watcher/dist` is committed. The agent rebuilt it and committed only `dist/services/workflow-state.*`.
- **T13 (state-store.ts):**
  - `fileStateStore(repoRoot)` gives `readCycle`/`writeCycle`/`appendEvent`.
  - `CycleRecord {startedAt, lastResult, files, adoptedCommand}`.
  - `EventKind` is one of `refusal | test-run | runner-adopted | unreadable | gate-error | rule-file-rejected`. The `result` union is `red | green | unknown | refused | allowed`. The caller sets `ts`.
  - A second cycle (b18b57a/1cb96ec) added `O_NOFOLLOW` on `events.ndjson`, `cycle.json` reads and the temp file (`O_EXCL`). Reads through a linked `.oss/tool-gates` return null. A refused write throws, and Task 17 turns that into `gate-error`.
  - **Known gap (FOLLOWUPS at ship):** the temp name is `cycle.json.<pid>.tmp` with `O_EXCL`. If a crash leaves it behind and a later process reuses the pid, `writeCycle` throws (a `gate-error`, so the call is allowed) until the file is removed. A random temp name fixes this.
- **T14 (recorder.ts):**
  - Signature: `recordTestRun(call: PostCall, ctx: RecordContext)`. `ctx` carries `settings`, `store`, `home`, `ts` and `buildStartedAt`, all passed in by Task 17.
  - **Red:** only a PostToolUseFailure with `Exit code N`, and only when the test is the last part that runs. `npm test; false`, `npm test && lint` and `bash -c 'npm test; false'` are recorded unknown. This was closed in a second cycle (1e552dd/6e5a1b3).
  - **Unknown:** piped, `|| true`, an interrupt, or failure text other than `Exit code N`. The event is logged and the cycle is left unchanged.
  - **What a red resets:** only `files`. `adoptedCommand` is kept within the same build. A cycle from another build stamp is replaced.
  - **For Task 16:** `cycle.adoptedCommand` isn't yet treated as a test command, and adoption needs `currentCommand` plus the non-zero exit of an unlisted command.
- **T15 (rules/red-cycle.ts):**
  - Signature: `checkRedCycle(call, settings, root, home, workflow: WorkflowState, store)`.
  - `workflow-state.ts` holds only types: `WorkflowState { read(): WorkflowSnapshot | null }` and `WorkflowSnapshot { currentCommand, currentCommandStartedAt }`. Task 17 adds the real reader.
  - **Which files it covers:** those with an extension in `sourceExtensions` that are not test files and not under `.oss/dev/**`. `.oss/dev/**` is a code constant, `DEV_DOCS`, because it is the fixed OSS location and a repo file must not be able to change it.
  - **Refusal texts:**
    - No run yet: `Refused: ` followed by the design text, word for word.
    - After green, a new file: "Refused: `<rel>` is not in this cycle and the last test run was green. Write a failing test and run it before editing a new source file."
  - **What it records:** the cycle stores `filePath` as given, raw `..` included. That is stricter, never a bypass.
  - **Refusal events:** the rule doesn't log them; Task 17 logs them centrally.
- **T16 (recorder.ts):**
  - `RecordContext` gains `currentCommand`. `BUILD_COMMAND` is exported from `workflow-state.ts`.
  - **Adoption:** the command must be the last part that ran, failing with `Exit code N` in build. No part may be piped or followed by `|| true`.
    - It must contain a test word (the `TEST_WORDS` code constant) or name a test file (from settings).
    - Its program must not be in `NEVER_ADOPTED`: `test`, `[`, `[[`, `grep`, `egrep`, `fgrep`, `rg`, `git`, `find`, `echo`, `printf`, `ls`, `cat`. This list is a code constant and can only narrow adoption. It closes fake reds from `test -f x`, `grep check` and `git check-ignore`.
    - One adopted runner per build. `adoptedCommand` stores the last part's words, matched later with `matchCommand`.
  - The recorder uses `call.cwd` as the root for test-file globs. Task 17 may pass the real root.

- **T17 (gate.ts, cli/tool-gate.ts; 775da0b/cac6292):**
  - Hook output contract: re-used the 2026-11-09 check above ("Hook output contract checked"); `claude-code-guide` was not asked again.
  - **Root / project dir** (second cycle, 6a98847/234cd1a): Claude Code's `CLAUDE_PROJECT_DIR` when it is an existing absolute folder, whatever the `cwd`. Otherwise the nearest folder at or above the hook's `cwd` holding `.git` (a folder, or a worktree's file), or `cwd` outside a repo. The first version used only the `.git` walk, so `mkdir -p sub/.git && cd sub` moved the rule files, protected paths and workflow state to `sub/`. Rule file, `.oss/tool-gates/`, `.oss/workflow-state.json`, protected-path and RED-rule roots all use this root. Git branch reads still use each part's own dir. The test setup unsets `CLAUDE_PROJECT_DIR` for hygiene only; the 14 acceptance tests exercise the fallback.
  - **Interface change:** `GitReader.currentBranch(dir)` returns `Promise<string | null>` (`execFile`, 1.5 s timeout); `checkProtectedBranch` is async. Its tests and the git-reader tests now await.
  - **2 s timer** lives in `runToolGate` (`Promise.race`), so a hung async git read is cut off. A synchronous hang can't be; the hooks.json `timeout: 5` covers that. After a timeout the decision may still finish in-process and log; the CLI exits first.
  - `GateDeps = { gitReader?: GitReader }`: git is the only collaborator that starts a process, and post mode never touches it (AC-005.5 test). State, workflow state and rule files use the real fs under the repo root.
  - Events: `refusal` (with `command` for Bash only), `unreadable` (pre mode only), `rule-file-rejected` once per call with the call's result, `gate-error` (best effort). A corrupt `workflow-state.json` throws, which is a `gate-error`; a missing one is null.
  - Rejected repo file: on allow, stdout `additionalContext` carries its one line; on refuse, it follows the reason on stderr.
  - Tell JSON uses the input's `hook_event_name` (PreToolUse / PostToolUse / PostToolUseFailure), or falls back to the mode's event.
  - **CLI:** `node tool-gate.cjs pre|post < hook.json`; `CLAUDE_PLUGIN_ROOT`, `HOME` and (optional) `CLAUDE_PROJECT_DIR` come from the environment. Any other argument exits 1 with a usage line, which the T19 wrapper maps to allow + tell + log. Logic is in the exported `runCli(argv, input, env)`, tested directly; the direct-run block only reads stdin and exits after the streams flush.
  - The recorder anchors test-file globs at the root: `RecordContext.root?` (the command's `cwd` when absent). This matters for repo-anchored patterns such as `e2e/*.js` run from `e2e/`.

## From /oss:build (T19, 2026-11-09)
- **Commits:** d72642c (RED: `hooks-json-tool-gate.test.ts`, `oss-tool-gate.test.ts`, 7 tests), 5d81560 (GREEN: `hooks/oss-tool-gate.sh`, `hooks.json`).
- **Gate-error log:** the wrapper appends one fixed line to `<project>/.oss/tool-gates/events.ndjson`. It finds the project folder the same way the gate does: `CLAUDE_PROJECT_DIR` when it is an existing absolute folder, else the nearest folder at or above `$PWD` holding `.git`, else `$PWD`.
- **Symlink skip:** the log is skipped when `.oss`, `.oss/tool-gates` or `events.ndjson` is a symlink, or when the state folder resolves outside the project. Bash has no O_NOFOLLOW, so a check-then-append race remains. At worst one fixed line lands in a file swapped in after the check (ADR-005, as cited in the wrapper).
- **No plugin-cache fallback:** the CLI is found at `${CLAUDE_PLUGIN_ROOT:-<script dir>/..}/watcher/dist/cli/tool-gate.cjs`. The wrapper never looks under `~/.claude/plugins/cache`.
- **`ts` precision:** the gate-error line's `ts` has whole-second precision (`date -u +%Y-%m-%dT%H:%M:%SZ`). The line carries no command text and no tool input, only `"tool":"unknown"`.
- **Exit mapping:** CLI exit 0 returns its stdout; exit 2 returns exit 2 with its stderr; any other outcome (other exit, killed, missing CLI, no node) allows the call, prints `additionalContext` "tool-gate failed, rules not checked.", and logs gate-error. The wrapper never prints `permissionDecision`.
- **Timeout:** each hooks.json entry has `timeout: 5`. The gate's own 2 s limit sits inside it.

## Ship todo
- File each of these as a FOLLOWUPS entry at ship (none is fixed on this branch): the T11b gaps (`git -C link/..` and `env -C` collapse `..` as text; `chmod --reference=` and `chmod -w` list nothing; `ln`/`install --target-directory=` not read; `python -c` / `node -e` writes not read; a symlink swapped in after the check); the T13 gap (`cycle.json.<pid>.tmp` with O_EXCL can block writes after a crash until removed, so a random temp name); the T19 gaps (the wrapper's check-then-append race, whole-second `ts`, no plugin-cache fallback); the shell-reading limits in DESIGN.md Known Limits (variables as program or git argument, stdin- or file-fed shells, long-tail wrappers, git aliases, `xargs` stdin, `coproc`, hidden test results, `for ((…))` and `;&` fall-through); and the registry flake (`test/agents/registry.test.ts` "should emit event when agent exceeds error threshold", fixed 100 ms wait under load, not ours).

## Last Updated: 2026-11-09 18:17 CST by /oss:build (T19, T20)
