# Decisions: timeline-archived-ship-lines

## TA-1: every kind written after the archive is filed in the archived folder (supersedes B7's "merge only")
- **Context:** B2's DESIGN.md:11 and :19, PLAN Task 4, and B2-1 and B2-3 kept gate, command and agent lines unfiled when only the archived folder exists. The premise was that only the merge line comes after the archive (DESIGN.md:6). ADR-017 in the served ship made that false: ship's `complete` line, and any late gate, come after the move.
- **Decision:** widen the fallback condition to every kind. Keep `_oss_tl_archived` and all of B7's safety rules unchanged.
- **Kept:** P-2 (merge-unknown is never pushed), P-3 (a line with no feature is never pushed; an archived line has a feature), B2-1 (`oss_resolve_feature` is untouched), and B2-8 (a later phase branch of the same feature filing into the old archive was already accepted for merges; it now applies to every kind, because the timeline is per feature).
- **Date:** 2026-11-07

## TA-2: the /oss:ship wrapper describes the served merge step, not auto-merge
- **Context:** API #432 (2026-11-08) replaced the served merge with a wait-and-merge step: it merges in the session once required checks pass and any approval branch protection asks for is in, with `gh pr merge --squash --match-head-commit`, never `--auto`/`--admin`. The wrapper still said `gh pr merge --squash --auto` "may only queue the merge" and advertised "Auto-merge PR when CI passes".
- **Decision:** reword the wrapper's --merge help, the Optional: Merge section and Step 8. When the merge step stops (checks still running, approval missing), send `complete` once after `pr_created`, do not send `merged`, and tell the user which merge step to re-run. That keeps the status line from staying "running", as the queued case did before.
- **Test:** commands/__tests__/ship-merge-wording.test.sh.
- **Date:** 2026-11-08

## TA-3: command, agent and gate lines follow only an archive made today (owner decision, ship round 1)
- **Context:** the round-1 security audit (LOW) and pen test (MEDIUM, reproduced) found that TA-1 let a branch kept after its PR merged, or a new branch reusing an old feature name, file its command, agent and gate lines into that old archive and queue them for push under the wrong feature.
- **Decision (owner):** merge and merge-unknown keep 2.0.99's rule (newest archive dated no later than today), so a merge step re-run on a later day still files its merge line. Command, agent and gate lines go into the archive only when it is dated today. Otherwise they stay unfiled and local (P-3), which covers ship's own `complete` line and late gates.
- **Accepted residual:** a same-day reuse of the same feature name.
- **Rejected:** "archive made by this branch" via merge-base with origin (about 2 more git calls per line, and repos without an origin need a fallback); back to merge-only (ship's complete line and late gates never reach the team timeline).
- **Tests:** timeline-archived.test.sh, TA-3 block (a fake `date` fixes today, so midnight never flakes it).
- **Date:** 2026-11-08

## TA-2 amendment: a stopped merge sends neither `merged` nor `complete` (user heads-up, code review LOW)
- `complete` runs the team's chain (a deploy, for example), so after a stopped or failed merge (checks running, approval missing, conflict, head moved) neither `merged` nor `complete` is sent. Both are sent once the re-run merges.
- **Date:** 2026-11-08
