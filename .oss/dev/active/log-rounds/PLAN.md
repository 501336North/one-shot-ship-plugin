# Plan: Command logs keep every round

## Problem
`hooks/oss-log.sh init <cmd>` writes the command-log banner with `>`, so it truncates `.oss/logs/current-session/<cmd>.log`. A second `/oss:build` in the same session erases the first round's banner and lines. The IRON LAW #1 observable (`grep -c 'OSS Command: /oss:build' .oss/logs/current-session/build.log`, pinned in the user's CLAUDE.md) can therefore never exceed 1, so a session that ran 3 build rounds is indistinguishable from one that ran 1 (measured 2026-10-28, AgenticDevWorkflow radical-observability: 3 rounds, count 1; `session.log` held all 3 `[INIT]` lines).

## Provenance check (IRON LAW #1b)
Sites that write or read the command-log banner (`git grep` on origin/main, plugin + API repos):
| Site | Use | Change |
|---|---|---|
| `hooks/oss-log.sh` `init` | writes the banner with `>` | append (`>>`) |
| `hooks/oss-log.sh` `check_command_log_size` | keeps the last 1000 lines when a command log passes the size cap; drops older banners | keep every banner line from the dropped part |
| `hooks/oss-log-analyzer.sh:91` | start time = FIRST `Started:` (`head -1`) | must be the LAST run's |
| `hooks/oss-log-analyzer.sh:155-156` | counts `[TEST] PASS/FAIL` over the whole command log | must count the last run only, or metrics pushed by `oss-push-metrics.sh` sum every round |
| `hooks/oss-log-analyzer.sh:167,173` | `tail -1` of test summaries | already the latest; unchanged |
| `learn-extractor.sh` | reads all `*.log` for error→fix patterns | more history is fine; unchanged |
| API repo `packages/api/src` | no reader of command-log banners | none |

## Tasks (London TDD, each RED first)

### Task 1: A second init keeps the first round
**Tests (RED):** `watcher/test/hooks/oss-log-rounds.test.ts` (CLAUDE_PROJECT_DIR = temp project, like `oss-log-project-local.test.ts`; never touch the real `~/.oss/current-project`)
- [ ] `should keep both banners when a command is started twice` — `init build`, `write build round-one`, `init build` → `grep -c 'OSS Command: /oss:build'` is 2 and `round-one` is still in the file.
- [ ] `should still start a fresh log for a command that never ran` (control: one init → count 1, file starts with the banner).
**GREEN:** `>` → `>>` on the banner block in `init`.

### Task 2: Rotation keeps every banner
**Tests (RED):** same file
- [ ] `should keep every round's banner when the log is trimmed` — 3 inits with enough lines between them that rotation fires (set `logs.maxCommandLogSizeKB` low through a temp HOME settings file, or call the trim path directly), then the count is still 3.
**GREEN:** in `check_command_log_size`, copy the `OSS Command:` lines from the part being dropped into the kept file (after the truncation notice) before the last 1000 lines.

### Task 3: The analyzer reports the latest round only
**Tests (RED):** `watcher/test/hooks/oss-log-analyzer-rounds.test.ts` (temp HOME; the analyzer reads `$HOME/.oss/logs/current-session`)
- [ ] `should take the start time from the latest round` — a build.log with two banners (`Started: … 10:00:00` and `… 11:00:00`) → reported start is 11:00:00.
- [ ] `should count only the latest round's test results` — round 1 has 3 `[TEST] … FAIL` lines, round 2 has 1 PASS → failed 0, passed 1.
**GREEN:** read the command log from its last `OSS Command:` banner (one `awk` that prints from the last banner) and use that for the start time and the PASS/FAIL counts.

## Ship
- Bump `.claude-plugin/plugin.json` patch version (rule: every plugin deploy bumps).
- No API change; the IRON LAW text stays as written (its grep becomes correct).
- Coordinate with the release-channels work in progress (several plugin worktrees on `feat/release-channels/*`): rebase on origin/main right before ship.

## Estimated: 3 tasks, 5 tests
