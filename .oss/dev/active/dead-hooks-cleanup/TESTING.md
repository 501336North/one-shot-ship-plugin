# Testing: dead-hooks-cleanup

## T2: hooks/__tests__/hooks-registration.test.sh (new)
- RED (commit 1): 13/23. (a) `.claude-plugin/hooks.json` exists; (d) all 9 unreachable scripts present.
  (b) and (c) already pass on root hooks.json (it has no matchers; all 11 commands resolve).
- Anti-vacuity: dead file copied over root hooks.json + one missing command -> (b) fails 1x, (c) fails 5x.
  Root restored, no diff.
- GREEN: 23/23 after deleting the dead file and the 9 scripts.

## T3: stale tests (before -> after)
| File | Before | After | Note |
|---|---|---|---|
| hooks/__tests__/config-change-guard.test.sh | 3/4 (1 fail) | 4/4 | HOOKS_JSON -> root hooks.json |
| hooks/__tests__/worktree-hooks.test.sh | 5/7 (2 fail) | 7/7 | HOOKS_JSON -> root hooks.json |
| hooks/__tests__/format-hook.test.sh | 5/6 (1 fail) | deleted (0) | all 6 cases tested oss-detect-formatter / oss-auto-format, both removed |
| hooks/__tests__/referenced-hooks-tracked.test.sh | 42/42 | 35/35 | -7 = the 7 scripts only the dead file named |
| watcher/test/hooks/post-tool-use-hooks.test.ts | 11/11 | deleted (0) | all 11 cases asserted the dead file / removed scripts |
| watcher/test/hooks/context-gate-removed.test.ts | 4/4 (on dead file) | 4/4 (root) | RED after deletion: 2 ENOENT. Also fixed vacuous nesting in "no context-gate"; mutation control (inject a context-gate command) -> 1 fail |

## T4: suites
- hooks/__tests__: 29/29 files green.
- commands/__tests__: 8/9 files; ideate-template 3/4 (pre-existing, unrelated).
- watcher/test/hooks (no-setup config): 30 files, 181/181 (was 31 files; -11 from post-tool-use-hooks).

## Last Updated: 2026-10-19 23:28 +07 by refactoring-specialist
