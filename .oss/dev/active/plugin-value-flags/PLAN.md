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

- [ ] R2-1 (HIGH): remove every remaining model-filled value from wrapper shell lines: build.md:88,102,122,125 (`{test_file}`, `{failure_message}`, `{agent_type}`, `{task_description}`, `{result_summary}`), ui-review.md:125 (`{count}`) → `'{}'`, the 7 `[CHAIN] skipped /oss:<command>: <reason>` lines (drop the free-text reason; `<command>` comes from validated chain-trigger output — keep only if the guard can tell it apart, else drop), and the LOW lines trust.md:175,199, ship.md:337-338, deploy.md:147-148 (reword as prose for the user, or use fixed text).
- [ ] R2-2 (HIGH): widen the guard: any `{word}` or `<word>` placeholder in any case (after stripping `${…}`), on every shell line — every fenced block except json/yaml/yml/markdown/md/typescript/ts/javascript/js/text/diff (case-insensitive, info strings allowed, `~~~` recognised, bare fences = shell), plus inline backtick spans that run `oss-*`, `~/.oss`, `$HOME/.oss`, `git`, `gh`, `node`, `kubectl`. Control fixture includes lowercase, mixed case, `<reason>`, a bare fence, a `~~~bash` fence and a ```Bash fence.
- [ ] R2-3 (MEDIUM, regression from R1-1): notifications must not show raw `{placeholder}` text when a field is missing: `watcher/src/services/notification-copy.ts` interpolate/getWorkflowCopy falls back to the template's static text (rebuild watcher dist so watcher-dist-fresh passes).
- [ ] R2-4 (INFO): `hooks/oss-value.sh` refuses a HOME that is not absolute.
