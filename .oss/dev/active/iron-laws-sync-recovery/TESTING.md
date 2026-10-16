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

Round 2 (S1-S4), RED -> GREEN:
| Test | RED | GREEN |
|---|---|---|
| iron-laws-sync-safety S1 legacy marker (refresh, install) | 2 FAIL (skipped as malformed; install rc=1) | pass |
| iron-laws-sync-safety S4 CRLF/trailing-space (5 tests) | 5 FAIL (install start=2: duplicate block) | pass |
| iron-laws-sync-safety S3 node hidden / node+python3 hidden / fail-closed | 2 FAIL ("no API key") + fail-closed already green | pass |
| iron-laws-sync-safety S2 exit 3 x4, exit 4 x3 | 7 FAIL (all rc=1) | pass |
| iron-laws-single-writer S2 login stops on exit 3/4 | FAIL | pass |
Totals: iron-laws-sync-safety 52/52, iron-laws-single-writer 5/5. Anti-vacuity: each hunk reverted (copy aside) went RED and the restore was `cmp`-identical; extra mutations (legacy START dropped from is_start, fallback accepting any escape, python3 branch removed) each went RED.
Real API (temp HOME, copied config): --install on a CRLF CLAUDE.md -> 1 canonical block, all 314 lines CRLF; forced refresh and a 2nd --install byte-identical. Legacy-marker refresh via python3 (PATH=/usr/bin:/bin) and via the pure-bash fallback (node+python3 hidden) -> 1 canonical block, 0 legacy.

Pre-existing failures on origin/main 0fc2ca4 (unchanged): ideate-template, config-change-guard, format-hook, worktree-hooks.

## Last Updated: 2026-10-16 17:33 +07 by /oss:build (ship-gate round 2, S1-S4)
