# Design: plugin-highs-gate

Fix round for the post-merge `/oss:ship` gate review of PR #193 (bac6c13, v2.0.86). No ideate phase:
the "design" is the set of gate findings the user approved on 2026-10-19 (option 2: fix this session's
share, plus ship the missing commands/visual-test.md so the suite expects 69 commands).

## Success criteria
1. No `chains_to` config value can add a `CHAIN:` line, close the block, or print text outside it;
   at most 10 `CHAIN:` lines are printed; names outside the agreed rule are skipped.
2. The workflow config is fetched only over https, from the same config file whose URL was checked;
   the workflow name is encoded/validated; the fetch gives up well before oss-notify's 30s cap.
3. Committed watcher/dist/cli/chain-trigger.cjs matches src, guarded by a test.
4. ship.md says what to send when `--merge` auto-merge is queued but not landed, and only strict
   `CHAIN:` lines are executed; oss-custom.md validates the name before using it.
5. commands/visual-test.md exists as a standard API wrapper; watcher suite fully green (69 commands).
6. Ships as 2.0.88 on top of 2.0.87, PR left unmerged (coordinating session merges per its user's approval).

## Out of scope
See PLAN.md "Out of scope" (files owned by the 2.0.87/2.0.89 work, vitest audit).

## Last Updated: 2026-10-19 by /oss:build
