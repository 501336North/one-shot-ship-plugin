# Testing: iron-laws-sync-recovery

| Test | RED | GREEN |
|---|---|---|
| hooks/__tests__/referenced-hooks-tracked.test.sh | 19/22 (sync script missing x3); untracked branch also verified | 22/22 |
| hooks/__tests__/iron-laws-sync.test.sh | 0/7 script aside; 7/8 last-line test | 8/8 |
| hooks/__tests__/session-start-iron-laws.test.sh | 2/3 script aside (copy test made behavioural) | 3/3 |
| commands/__tests__/no-iron-laws-fetch.test.sh | 2/3 (auto.md lacked note) | 3/3 |

T3 (real API, temp HOME): CLAUDE.md created with one START/END block incl. "IRON LAW #1"; second run and forced-stale run byte-identical; existing "# OSS Dev Workflow" + user lines + unterminated last line preserved.

Pre-existing failures on origin/main 0fc2ca4 (unchanged): ideate-template, config-change-guard, format-hook, worktree-hooks.

## Last Updated: 2026-10-16 15:38 +07 by build agent
