# Testing: iron-laws-sync-recovery

| Test | RED | GREEN |
|---|---|---|
| hooks/__tests__/referenced-hooks-tracked.test.sh | 19/22 (sync script missing x3); untracked branch also verified | 22/22 |
| hooks/__tests__/iron-laws-sync.test.sh | 0/7 script aside; 7/8 last-line test | 8/8 |
| hooks/__tests__/session-start-iron-laws.test.sh | 2/3 script aside (copy test made behavioural) | 3/3 |
| commands/__tests__/no-iron-laws-fetch.test.sh | 2/3 (auto.md lacked note) | 3/3 |
| hooks/__tests__/iron-laws-sync-safety.test.sh (new, R1-R6) | 30/32 against old script; +lock tests and real-laws HTML false-positive test shown RED by mutation / first | 35/35 |
| hooks/__tests__/oss-api-curl.test.sh (new, R5) | 0/6 (helper missing, 10 argv sites) | 6/6 |
| hooks/__tests__/session-start-iron-laws.test.sh (tests 1-2 behavioural, +2b) | 2/4 (sync awaited, stdout leaked, key in argv) | 4/4 |
| hooks/__tests__/iron-laws-sync.test.sh (3-5 now --install, bodies >500B) | n/a (spec change) | 8/8 |
| hooks/__tests__/referenced-hooks-tracked.test.sh (+${CLAUDE_PLUGIN_ROOT}/hooks) | planted missing ref passed old guard 22/22; new guard 40/41 | 41/41 |
| commands/__tests__/iron-laws-single-writer.test.sh (new, R7) | 1/4 | 4/4 |

Anti-vacuity (round 1): ~30 single-hunk mutations of the fixed files (sync script, helper, session start, each of 8 routed sites); every one went RED and each restore was `cmp` byte-identical. Exception found and fixed: lock removal stayed green until lock-held/stale-lock tests were added.

Real API (temp HOME, copied config): `--install` created 1 START/1 END block (11.4KB laws, mode 644, user `-n` line kept, key in no output); fresh refresh and forced-stale refresh both byte-identical. First run found the HTML heuristic rejected the real laws (`<body explaining WHY and impact>`); fixed RED-first.

T3 (real API, temp HOME): CLAUDE.md created with one START/END block incl. "IRON LAW #1"; second run and forced-stale run byte-identical; existing "# OSS Dev Workflow" + user lines + unterminated last line preserved.

Pre-existing failures on origin/main 0fc2ca4 (unchanged): ideate-template, config-change-guard, format-hook, worktree-hooks.

## Last Updated: 2026-10-16 16:53 +07 by /oss:build (ship-gate round 1)
