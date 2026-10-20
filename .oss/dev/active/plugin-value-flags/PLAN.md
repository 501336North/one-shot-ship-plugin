# Ship round 1 fixes (2026-10-20) — from the 2.0.91 gates

Gates: quality PASS, performance PASS, security FAIL (1 HIGH), pen-test FAIL (1 MEDIUM). Every task below is a security finding, so all are fixed in round 1.

- [x] R1-1 (HIGH, security gate): no shell line in `commands/*.md` may contain a model-filled `{PLACEHOLDER}` (42 lines in 27 wrappers, e.g. red.md:133 `oss-log.sh test red FAIL "{TEST_FILE}: {FAILURE_MSG}"`; test output is repo-controlled, so `$(cmd)` runs). Wrapper lifecycle events stay (served-paths-fix ADR-5) but send a fixed `'{}'` payload; free-text arguments to `oss-log.sh` are dropped. Widen `commands/__tests__/no-model-text-in-failed.test.sh` (or a new guard) to every shell line, not only `failed`.
- [x] R1-2 (MEDIUM, pen-test F1): when the walk finds no real `.oss`, the helper must not pass an empty `CLAUDE_PROJECT_DIR` (which falls back to `~/.oss/current-project`, another project). Pass `$HOME` (the global ~/.oss) instead, for both `failed` and `error`. Test at the oss-notify / oss-error level that the victim project's logs and workflow.log stay untouched. Note for Phase B: the served #374 one-liners have the same flaw; A3/A4 move them onto this helper.
- [x] R1-3 (LOW, pen-test F2): the value-folder key must not be shareable via a `.git` gitfile pointing at another repo's git dir: derive it from the toplevel plus the git dir.
- [x] R1-4 (INFO, pen-test F5): check the git output before hashing it; a failed lookup must refuse, not hash empty input to a shared key.
- [x] R1-5 (LOW, security #2): read the value file through one open and verify the opened file is the checked one (no swap to a symlink between check and read).
- [x] R1-6 (LOW, security #3): `~/.oss/plugin-root` gets the same not-link + owner check as the value folders before `node` runs from it.
- [x] R1-7 (REPORTED, not built: error path already redacted by oss-error.js; no shell-callable redactor for failed) (LOW, pen-test F3): reasons/messages pass through the existing secret redaction if the plugin already has one; if not, report rather than build one.
- [x] R1-8 (REPORTED, not fixed: oss-log and oss-notify both return 0 on refusal by contract; fix is beyond a few lines) (LOW, pen-test F4): the helper must not delete the value file and report success when the notice was refused; if that needs an oss-notify exit-code change beyond a few lines, report rather than grow it.

# Ship round 2 fixes (2026-10-20) — from the round-1 narrow re-check

Re-check: security FAIL, pen-test FAIL (proved `src/$(touch PWNED).test.ts` runs via build.md:88), code review FAIL. R1-1 was incomplete: lowercase/angle-bracket placeholders survived and the guard only matched UPPER_CASE.

- [x] R2-1 (HIGH): remove every remaining model-filled value from wrapper shell lines: build.md:88,102,122,125 (`{test_file}`, `{failure_message}`, `{agent_type}`, `{task_description}`, `{result_summary}`), ui-review.md:125 (`{count}`) → `'{}'`, the 7 `[CHAIN] skipped /oss:<command>: <reason>` lines (drop the free-text reason; `<command>` comes from validated chain-trigger output — keep only if the guard can tell it apart, else drop), and the LOW lines trust.md:175,199, ship.md:337-338, deploy.md:147-148 (reword as prose for the user, or use fixed text).
- [x] R2-2 (HIGH): widen the guard: any `{word}` or `<word>` placeholder in any case (after stripping `${…}`), on every shell line — every fenced block except json/yaml/yml/markdown/md/typescript/ts/javascript/js/text/diff (case-insensitive, info strings allowed, `~~~` recognised, bare fences = shell), plus inline backtick spans that run `oss-*`, `~/.oss`, `$HOME/.oss`, `git`, `gh`, `node`, `kubectl`. Control fixture includes lowercase, mixed case, `<reason>`, a bare fence, a `~~~bash` fence and a ```Bash fence.
- [x] R2-3 (MEDIUM, regression from R1-1): notifications must not show raw `{placeholder}` text when a field is missing: `watcher/src/services/notification-copy.ts` interpolate/getWorkflowCopy falls back to the template's static text (rebuild watcher dist so watcher-dist-fresh passes).
- [x] R2-4 (INFO): `hooks/oss-value.sh` refuses a HOME that is not absolute.

# Ship round 3 fixes (2026-10-20) — user: "Fix (a) and (b), then merge"

Round-2 re-check: HIGH closed in all three gates; LOW/INFO left.

(a) small text fixes
- [x] R3-1: ship.md:336-343 and deploy.md:146-155 fallback: give fixed, placeholder-free commands (e.g. `git push -u origin HEAD`, `gh pr create --base main --fill`; deploy: a fixed instruction with no model-filled names) so "run the commands shown above" points at real text again.
- [x] R3-2: delete the stale oss-custom.md:83 sentence ("Replace `{COMMAND_NAME}` …").
- [x] R3-3: build.md "Expected log output" block (~:235-242): no example that shows a file name/message after `[TEST] FAIL`, and nothing that tells the model to append the failure message to `oss-log.sh test`.
- [x] R3-4: build.md:122,125 agent logging: bring back the specialist's name on the status line through a value file, not the command line: an `oss-value.sh agent <workflow> start|complete` verb that reads `agent.txt` (validated `^[a-z][a-z0-9:-]{0,60}$`) and calls oss-log.sh agent.

(b) user-argument lines and guard coverage
- [x] R3-5: model-filled user arguments in shell lines go through a value file read by the command, never typed into the line: login.md:66 (`$KEY_ARG`), login.md:516-538 (`$STYLE`/`$VOICE`/`$SOUND`), models.md:165-166 (`$1`/`$2`), workflows.md:120 (`{workflowName}`), trust.md:195 (category/name: the command reads them from a file and checks `^[a-z0-9_-]+$` in code, not by the model). Reuse `oss-value.sh dir` for the folder; each command reads its file, validates in code, deletes it. Secrets (the API key) are deleted right after use.
- [x] R3-6: widen the guard (no-model-text-in-failed.test.sh section 4): placeholders containing spaces, dots, colons or pipes (`{test file}`, `{task.file}`, `<file:line>`, `<commit message>`, `{reason|none}`); upper-case bracket placeholders `[MESSAGE]`; `${X:-{reason}}` (strip only balanced `${…}`); `%{…}` stripped only in curl `-w`; a `<<EOF` heredoc fed to a shell is shell; unbound `$NAME`/`$1` inside a shell fence that the same fence never assigns (allowlist HOME, PWD, plus variables set by the fence or by the value-file reader). Control fixture covers each.
- [x] R3-7: the 4 request-shape fences relabelled ```text in round 2 (login.md:189, status.md:63, workflows.md:75,120) get an honest label (```http) and the guard scans `http` fences; `{apiKey}` from config is allowlisted by name (the key-on-argv issue is FOLLOWUPS item 44).
- [x] R3-8: DECISIONS.md D5 correction (agents/visionos-developer.md:36 and skills/visionos-developer.md:44 also have `{user_context}`): note as out of wrapper scope and add a FOLLOWUPS security line.

Stop rule: if any task needs more than the value-file pattern already in oss-value.sh or a guard rule, stop and report instead of growing it.

# Ship round 4 fixes (2026-10-20) — user: "Fix all 21 too"

- [x] R4-1 (regression from R3-5): outside a git repo the helper uses one per-user value folder `~/.oss/run/home` (same not-link/owner/700 checks, events route to `$HOME/.oss`), so `/oss:login --key`, `/oss:models set`, `/oss:workflows <name>` and `/oss:trust` work from any folder again. Test: run each wrapper line from a non-repo cwd in a sandbox HOME.
- [x] R4-2: every KNOWN_OPEN pair in the guard is fixed and removed from the list (the list ends empty, or the helper is deleted):
  - model/user values → value files via `oss-value.sh read <name>` with a per-name rule in code: settings.md STYLE, VOICE, SOUND, VERBOSITY, TELEGRAM_LINKED; telegram.md `$1`; oss-custom.md `$1`; watcher.md PID (read from the repo file by the command itself, validated `^[0-9]{1,10}$`, never typed by the model).
  - values the command can compute itself → compute in the same fence (API_KEY / API_URL from ~/.oss/config.json with jq; PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT from `~/.oss/plugin-root` through the same checks oss-value uses; PLIST_PATH, STATUSLINE_SCRIPT, OSS_CONFIG_DIR from fixed paths; oss-audio's sourced variables made explicit in the fence).
  - this also fixes `/oss:models set` (PLUGIN_ROOT never set).
- [x] R4-3: the oss-log.sh `agent` exit-code bug under `set -euo pipefail` when the plugin cache folder is missing (found by R3-4's sandbox): `oss-value.sh agent` must return 0 when the log line was written. Smallest fix in oss-log.sh, with a test.

Stop rule: same as round 3.

Round 4 done 2026-10-20: R4-1 b351de9, R4-2 1064220, R4-3 21b1c85 (see PROGRESS.md, TESTING.md, D9/D10).
