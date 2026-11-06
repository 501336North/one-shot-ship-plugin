# Progress: Radical Observability G2, Phase B (plugin)

## Current Phase: ship (fix round 2: Tasks 14-18 via /oss:build)

## Tasks
- [x] Task 1: Acceptance test at the boundary (written 2026-11-06; 8 checks RED as expected until Task 8)
- [x] Task 2: One copy of the feature resolution (completed 2026-11-06)
- [x] Task 3: B1, the timeline writer (completed 2026-11-06)
- [x] Task 4: B2, command lines from oss-notify, plus FOLLOWUPS #130 (completed 2026-11-06)
- [x] Task 5: B3, agent lines from a PostToolUse hook (completed 2026-11-06)
- [x] Task 6: B4a, the gate verb (completed 2026-11-06)
- [x] Task 7: B4b, the merge verb (completed 2026-11-06; gh bounded by a third inline supervisor, DECISIONS.md P-9)
  - For Task 8: never queue a `merge-unknown` line (P-2); timeline-merge.test.sh already checks `~/.oss/timeline-outbox/*.ndjson` holds none.
- [x] Task 8: B5, background push (completed 2026-11-06; `timeline.acceptance` GREEN 8/8; two copies of the outbox code, P-10; push starts and overlap, P-11)
  - The push starts detached, in its own process group, from oss-notify (after its command line, `oss-timeline.sh push --detach`), the gate and merge verbs and the Agent|Task hook. The "API hangs" check sits in notify-timeline.test.sh.
  - For Task 9: `~/.oss/timeline-outbox/` is outside the repo; nothing there is a timeline file.
- [x] Task 9: B6, timeline files are never removed, plus release 2.0.98 (completed 2026-11-06; no product change needed; plugin.json 2.0.98)
  - Found, not fixed (outside this task): `oss-log.sh purge --force` only prints the warning, because purge reads `--force` as its third word (`purge <anything> --force` purges). The usage line documents the two-word form.
  - `oss-archive-check.sh` moves a whole feature folder to `.oss/dev/completed/` on ship; its timeline goes with it, so the file is kept, and the guard does not flag it.

- [x] REFACTOR (code-simplifier): one sha-256 helper in oss-timeline.sh, no behavior change (completed 2026-11-06)

- [x] Task 10: delivery never stalls or strands a line (ship round 1) (completed 2026-11-06)
- [x] Task 11: a merge line says only what is true (ship round 1) (completed 2026-11-06)
- [x] Task 12: nothing unsafe or unbounded is written or read (ship round 1) (completed 2026-11-06)
- [x] Task 13: gate lines are consistent, and the gate map test can fail (ship round 1) (completed 2026-11-06)
- [x] Task 14: the push sends only lines the writer's rules accept (ship round 2) (completed 2026-11-06)
- [ ] Task 15: compaction never follows a link and never loses a line (ship round 2)
- [ ] Task 16: gh reports this repo's PR only (ship round 2)
- [ ] Task 17: value files are bounded in size and age (ship round 2)
- [ ] Task 18: a line goes out only under the key it was written with (ship round 2)

## Blockers
- None. Plugin 2.0.97 is on main (#216, c80e004). Phase A API is live (AgenticDevWorkflow #418).

## Last Updated: 2026-11-06 by /oss:build
