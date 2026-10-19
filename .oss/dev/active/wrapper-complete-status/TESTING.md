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

## Ship round 1, Track A (F1 F2 F5 F9 F13), 2026-10-19

`commands/__tests__/wrapper-complete.test.sh` grew from 25 to 95 assertions:
- F5: Test 1 finds a notify line anywhere on the line, any indent, in the `~/.oss/hooks/` or `$HOME/.oss/hooks/` spelling. A floor asserts at least 55 wrappers send a start line. That is today's count; the plan said 54, which was one short (the old detection also found 55).
- F1 (23): each fixed completion section's first line is exactly ``On success only. If the command failed (the prompt sent `failed`), do not send `complete`.``
- F2 (23 + 23):
  - the completion heading is the next `##` heading after the "Execute the Fetched Prompt" heading;
  - its line is inside a ```bash fence;
  - `## Step N:` headings run 1, 2, 3, ... with no repeats.
- F9 (1): every wrapper with an Execute heading has a non-blank body before the next heading.

Headings are only counted outside code fences.

### RED
- 52/95 passed, 43 failed:
  - 23 guard;
  - 19 placement: a11y audit bench chaos cost deploy docs experiment feature-flag incident license monitor postmortem privacy release retro rollback stage test;
  - 1 empty Execute, naming load smoke tech-debt trace.
- The numbering and F5 assertions pass on the real files. They were shown to bite on temp copies (M5, M6, M8 below).

### GREEN
These were count-checked scripts, and each exits non-zero unless it changes exactly the expected number of files:
- F1: inserted the guard in 23 files (+46 lines).
- F2: moved the completion section in 19 files, net 0 lines per file. Each moved step was already `Step N+1` of the Execute `Step N`, and no `## Step` heading followed it, so no renumbering was needed. The script asserts both.
- F9: added "Execute the prompt returned by the API." to load, smoke, tech-debt and trace. That sentence opens the Execute body of 7 other wrappers. The most common opener, "The prompt handles:", introduces a per-command list, so it is not a one-line body.

Results:
- `wrapper-complete.test.sh`: 95/95.
- `commands/__tests__` folder, run sequentially: 9 files, 127 assertions, 126 passed, 1 failed. The failure is `ideate-template`, which was already known.

### Mutations (each on a temp copy of `commands/`, never in the repo)
| # | Mutation | Old test (25) | New test (95) | Killed by |
|---|----------|---------------|---------------|-----------|
| M1 | wrong workflow name: audit's line says `audtt` | FAIL | FAIL | Test 1, audit fixed line, audit guard, audit placement |
| M2 | audit's notify line moved out of the ```bash fence | PASS | FAIL | audit placement (not fenced) |
| M3 | audit completion section moved to the end of the file | PASS | FAIL | audit placement |
| M4 | audit guard sentence removed | PASS | FAIL | audit guard |
| M5 | review start rewritten to indented `$HOME/` form, its `complete` removed | PASS | FAIL | Test 1 (start has completion) |
| M6 | audit completion renumbered `Step 6` (duplicate) | PASS | FAIL | audit step numbering |
| M7 | trace Execute body emptied | PASS | FAIL | Execute body |
| M8 | review start and complete lines removed (54 starters) | PASS | FAIL | start floor (55) |
| M9 | audit guard moved below the "You MUST" line | PASS | FAIL | audit guard (must be first line) |

All 9 were killed. Before this round, M2 to M9 survived.

Provenance: the only other test that reads "Execute the Fetched Prompt" is `watcher/test/agents/local-model-offload.test.ts`, which covers `agents/`, not `commands/`.
