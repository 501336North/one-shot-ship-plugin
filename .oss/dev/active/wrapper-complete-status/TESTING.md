# Testing: wrapper-complete-status

## T1: `commands/__tests__/wrapper-complete.test.sh`

Matching is literal (awk `index`, `grep -xF`), because `grep` here is ugrep and `$` mid-pattern misbehaves.

- Test 1: every `commands/*.md` with a `~/.oss/hooks/oss-notify.sh --workflow <w> start` line also has a `--workflow <w> complete` or `merged` line.
- Tests 2 to 24: each fixed wrapper has exactly `~/.oss/hooks/oss-notify.sh --workflow <w> complete '{}'`, and no other completion line for `<w>` (so no `{…}` placeholder).

### RED (2026-10-19)
`0/24 passed, 24 failed`. Test 1 reported 23 missing:
a11y audit bench chaos cost deploy docs experiment feature-flag incident license load monitor postmortem privacy release retro rollback smoke stage tech-debt test trace.

That is the 22 in the plan plus **a11y**, which the plan's list missed. a11y was fixed too; otherwise the test stays red.

### GREEN (2026-10-19)
- A count-checked script changed exactly 23 files (184 insertions, nothing else).
- Placement: before `## Error Handling` in load, smoke, tech-debt and trace. The other 19 have no such heading, so the step is appended at the end.
- `wrapper-complete.test.sh`: 24/24 passed.
- `commands/__tests__` folder, run sequentially: 56 run, 55 passed, 1 failed. The failure is `ideate-template` ("commands/ideate.md should contain API template fetch instruction"), which was already known.

### Anti-vacuity
- Stashed only the wrappers (`git stash push -m wcs-av -- commands/*.md`): RED again with the same 23 named, 0/24. Then applied the stash by SHA and dropped it by message.
- Mutated trace's line to `complete '{"n": {N}}'`: `trace.md has the fixed completion line` FAILED (23/24). Restored afterwards.

## T2
- v2.0.88 -> v2.0.89
- hooks/__tests__ + commands/__tests__: 32/36 files pass; the 4 failures are pre-existing on main (stale hooks/hooks.json path in 3 tests; ideate-template)
- watcher-dist-fresh: PASS after npm ci in the new worktree
- watcher/test/hooks (no-setup, CLAUDE_PROJECT_DIR unset): 31 files, 192/192
