# Testing: Command logs keep every round

## Strategy
Vitest exec tests in watcher/test/hooks against the real hooks/oss-log.sh, temp project via CLAUDE_PROJECT_DIR and temp HOME; never write the real ~/.oss/current-project (the existing oss-log-project-local test does: see NOTES).

Run with a config that omits setupFiles (watcher/test/setup.ts pkills machine-wide): pool forks, maxWorkers 1, fileParallelism false.

## Results (2026-10-28, round 2)
`watcher/test/hooks/oss-log-rounds.test.ts` (4), each RED before its GREEN:
- [x] should keep both banners when a command is started twice (RED: 1 vs 2)
- [x] should still start a fresh log for a command that never ran (control, passes by design)
- [x] should keep every round's banner when the log is trimmed (RED: 0 vs 3; also asserts the trim ran)
- [x] should still trim a log whose dropped part has no banner (RED: `clean` exited non-zero under set -e)

No mocks: every test execs the real script.

Full `test/hooks` dir: 172–174 tests; each full run had 1–5 failures, all 5 s timeouts or real-~/.oss interference in files that do not reach the changed code (oss-notify-project, oss-notify-telegram, oss-session-logging, hook-error-adoption), a different set each run, each passing alone. One full run after cycle 1 was 172/172. Logged in FOLLOWUPS.

## Last Updated: 2026-10-28 19:10 CST by /oss:build
