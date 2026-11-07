# Decisions: Radical Observability G2, Phase B2

Earlier decisions: P-1 to P-19 in `.oss/dev/completed/radical-observability-g2-2026-11-07/DECISIONS.md`. Feature-level: API repo ADR-017 ("Plugin resolves completed/", user, 2026-11-07).

## B2-1: The archived-folder lookup lives in oss-timeline.sh, not oss-safe-path.sh (plan, 2026-11-07)
The design keeps `oss_resolve_feature` unchanged, and only the timeline's merge path needs the lookup, so `_oss_tl_archived` sits next to its only caller. G1's decision recorder and every other sourcer of `oss-safe-path.sh` see no difference.

## B2-2: The newest match is checked, and is never replaced by an older one (plan, 2026-11-07)
Take the newest `<feature>-YYYY-MM-DD` by name, then check it. If it fails (a link, a foreign owner, a linked or hard-linked timeline file), the line goes unfiled. Falling back to an older folder would let a planted bad newest folder steer the line into a stale archive, and a silent fallback hides the problem.

## B2-3: merge-unknown follows the merge verb into the archived folder (plan, 2026-11-07)
The design says "in `oss-timeline.sh merge` only", and that verb writes either `merge` or `merge-unknown`. Both kinds use the archived folder, so a merge always leaves its trace with the feature. merge-unknown stays local (P-2: never in the outbox), so this changes no push.

## B2-4: A refused archived folder means unfiled, not a write error (plan, 2026-11-07)
This matches the design ("refused, staying unfiled and never pushed"). The lookup checks before the writer's `oss_safe_target`, so an unsafe folder gives a normal unfiled line (rc 0) rather than a refused write. `oss_safe_target` still guards the write against a swap after the check.

## B2-5: A read-only folder walk for the decision record (FOLLOWUPS #197, plan, 2026-11-07)
`oss_safe_target` creates missing folders, which is wrong for a read. `_oss_tl_real_dirs` walks the same components and only checks: a real directory, not a link. It runs before reading `decisions.ndjson` from the active or the archived folder.

## B2-6: Follow-ups #186 and #197 pulled in (user picker, 2026-11-07)
#197 is Task 6. #186 is Task 7, likely a guard test only, because the current merge verb already maps facts outside the schema to merge-unknown. The other open follow-ups stay open (small releases, one theme).

## B2-7: Ship round 1 security fixes, including one change to oss_resolve_feature (ship gate, 2026-11-07)
- S1: both branch readers (`_oss_tl_archived` and `oss_resolve_feature`) use the full ref `refs/heads/...`, never `--short`. A tag of the same name made `--short` print `heads/<branch>`, so the type was read as the feature and a planted folder could take the line. This is a deliberate security exception to "oss_resolve_feature unchanged" (DESIGN, B2-1): it only changes the tag-shadow case, and G1 shares the fix.
- S2-S4: the archived folder is picked from `find` output, never a glob, so no glob option of the caller (nullglob, failglob, BASHOPTS) changes it. Only `<f>-YYYY-MM-DD` with a calendar month and day, no later than today (local clock, as the archive step), counts. B2-2 still holds.
- S5: the decision record must be the person's own (`test -O`), in the active or the archived folder.
- Kept, not fixed here, by earlier user decisions: a repo can plant a decision id in its committed record (P-17, API read-time flag), and the check-then-open gaps on `>>` and on the record read (P-19 class, same-user race).

## B2-8: Ship round 2, a planted later-dated archive stays under P-17 (user picker, 2026-11-07)
- Kept under P-17 and logged in FOLLOWUPS (user's choice): a repo can commit `completed/<f>-<later or today's date>/`, and the merge line and the decision check then use that folder and its committed `decisions.ndjson`. Also kept: the "no later than today" cut-off follows the local clock and time zone. The API's read-time flag still covers the planted decision.
- Fixed in round 2: the archived-folder `find` is name-filtered (`-name "<f>-*"`) so a crowded `completed/` can't stall the merge (pen-test DoS, Low). The `oss_resolve_feature` fallback no longer aborts a shell that has failglob on. Tests no longer depend on today's date. Added tests for a detached HEAD and for a non-heads HEAD ref.
- Behaviour change from S1, pinned in feature-resolve: a HEAD that points at a tag or a remote ref is treated like a detached HEAD (the single-active-folder fallback), never read as a convention branch.
- Discarded: an old archive is picked by a later phase branch of the same feature (the timeline is per feature, as DESIGN B7 says); impossible dates such as 02-31 (the rule is date-shaped on purpose).

## B2-9: B10, the penetration-tester agent wrapper, joins 2.0.99 (user picker, 2026-11-07)
API ADR-018 (user picker "Separate pen-test agent") plans `agents/penetration-tester.md` for 2.0.99, so that Phase C's ship Step 1.4 can spawn it and G3 can back pen-test gate lines with a real penetration-tester run. It was added to the API plan during the Phase C build, after this plan. The user chose to add it here (Task 9) rather than in 2.0.100: one wrapper file with the same shape as `security-auditor.md`, plus a test.
