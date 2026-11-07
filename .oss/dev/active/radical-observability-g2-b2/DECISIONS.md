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
