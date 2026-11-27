# Testing: ship-md-base-tests

All runs use a temp HOME. Shell tests run singly, each with a notifier tripwire (never hit).

RED, before the fix: the three tests below each fail one row at a88f7d91.

GREEN:
- watcher/test/commands/chain-step-contract.test.ts: 33/33.
- commands/__tests__/bash-blocks-allowlisted.test.sh: 8/8.
- commands/__tests__/no-model-text-in-failed.test.sh: 34/34.
- Regression (ship-wrapper-chain, which pins the Step 5a wording; served-commands acceptance, which checks the command-blocks fixture; all of watcher/test/commands): 18 files, 201 tests.

## Last Updated: 2026-11-27 10:47 +0700 by /oss:build
