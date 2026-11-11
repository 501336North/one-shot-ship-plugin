# Progress: plugin-main-fixes

## Current Phase: ship (gate rounds 1-6 done; D7, D8 accepted as known limits)

## Tasks
- [x] Task 1: Fix ideate-template test (completed 2026-11-11, 8154de7 + f15451d): option (a), the template left commands/ideate.md on purpose in #161; test 2 now asserts the hook call and no inline template
- [x] Task 2: Fix no-telegram-command test (completed 2026-11-11, 6382204): fails any Telegram offer, allows only the exact retired-key cleanup
- [x] Task 3: Delete the metrics push (completed 2026-11-11, 10f7360; D2) and the orphaned log analyzer (cee1750; D4)
- [x] Task 4: Bump to 2.1.3 (completed 2026-11-11, f13b545; D1)
- [x] D5: pre-approve the merge test (cc49e7f) then WITHDRAWN by the owner (reverted in 5cb799e): an allow entry is not tied to --merge
- [x] D6: root package.json; `npm test` = watcher `npm ci` + scripts/run-shell-tests.sh over every __tests__/*.test.sh (completed 2026-11-11, df06f23)
- [x] Ship gate rounds 1-6: runner and run_capped hardening from code review, security, pen test and performance findings (2026-11-11; see TESTING.md)

## Blockers
- None (D6 lets /oss:ship --merge run the merge test on plugin PRs)

## Last Updated: 2026-11-11 by /oss:ship (gate round 6)
