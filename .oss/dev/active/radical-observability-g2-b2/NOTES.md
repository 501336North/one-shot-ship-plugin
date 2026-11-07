# Notes: Radical Observability G2, Phase B2

- Phase C (API repo, `/Users/ysl/dev/AgenticDevWorkflow-g2c`, branch `feat/radical-observability-g2/build-c1-c11`) drops `--delete-branch` from ship's `gh pr merge` (Task C3), so the local branch still reads `<type>/<feature>/<phase>` when the merge line is written. B7 depends on that.
- The push is keyed only by outbox (`~/.oss/timeline-outbox/<rid>.ndjson`, rid = sha-256 of the file's physical path). An archived file gets its own rid, and the push needs no change.
- Version lives only in `.claude-plugin/plugin.json`.
- `oss_safe_target` mkdirs missing components, so never use it on a read path (B2-5).
- The merge verb already sends facts outside the schema (a bot login) to merge-unknown; see the `fields_ok("merge")` branch. FOLLOWUPS #186 may be stale.
- Step 0 of the served plan prompt (PM2, CI, ecosystem.config.js) was not re-run: settled per API #426 (memory, 2026-11-06).

## Last Updated: 2026-11-07 09:34 CST by /oss:plan

- Task 3: git refuses a branch like `feat/.demo/ship` (invalid ref), so a dot-led feature can never come from a real branch. The name-rule case uses `feat/de+mo/ship` instead (git accepts `+`, our rule does not).
