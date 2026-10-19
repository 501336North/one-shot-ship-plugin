# Plan: wrapper-complete-status

## Summary
22 plugin command wrappers send `oss-notify.sh --workflow <cmd> start` and never `complete`, so the status line never shows done for them (FOLLOWUPS 76). Each gets a fixed `complete '{}'` step at its end. The JSON is fixed, so no model value enters the shell.

The wrappers are: audit, bench, chaos, cost, deploy, docs, experiment, feature-flag, incident, license, load, monitor, postmortem, privacy, release, retro, rollback, smoke, stage, tech-debt, test, trace.

Note: FOLLOWUPS 75 (the ship wrapper never sending `complete`) was already fixed by #193 (v2.0.86); it was stale.

## Tasks
- [ ] **T1 (RED → GREEN):** `commands/__tests__/wrapper-complete.test.sh`
  - Fails if any `commands/*.md` that sends `--workflow <w> start` has no `--workflow <w> complete` (or `merged`) line for the same `<w>`.
  - Fails if any added `complete` line carries a `{…}` placeholder.
  - RED: lists the 22 above.
  - GREEN: add a "Status Line (Completion)" step with exactly `~/.oss/hooks/oss-notify.sh --workflow <w> complete '{}'` before the Error Handling section of each wrapper. Use a count-checked script that must change exactly 22 files.
- [ ] **T2:** version 2.0.89. Run all of `commands/__tests__` and `hooks/__tests__`, and the whole `watcher/test/hooks` folder (no-setup config, `CLAUDE_PROJECT_DIR` unset).

## Last Updated: 2026-10-19 by /oss:plan (boss session)
