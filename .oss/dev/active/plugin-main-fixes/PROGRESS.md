# Progress: plugin-main-fixes

## Current Phase: build (complete; code-simplifier: no changes needed)

## Tasks
- [x] Task 1: Fix ideate-template test (completed 2026-11-11, 8154de7 + f15451d): option (a), the template left commands/ideate.md on purpose in #161; test 2 now asserts the hook call and no inline template
- [x] Task 2: Fix no-telegram-command test (completed 2026-11-11, 6382204): fails any Telegram offer, allows only the exact retired-key cleanup
- [x] Task 3: Delete the metrics push (completed 2026-11-11, 10f7360; D2) and the orphaned log analyzer (cee1750; D4)
- [x] Task 4: Bump to 2.1.3 (completed 2026-11-11, f13b545; D1)

## Blockers
- Ship: the plugin repo has no root package.json, so the served merge step STOPs; the owner merges the PR by hand.

## Last Updated: 2026-11-11 11:05 CST by /oss:build
