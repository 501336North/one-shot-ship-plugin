# Progress: plugin-value-flags (G21 cut 1, plugin Phase A)

Plan, design and decisions live in the API repo (branch feat/plugin-value-flags/plan,
`.oss/dev/active/plugin-value-flags/`).

## Current Phase: build

## Tasks
- [x] P1: `oss-value.sh dir` (completed 2026-10-19, aab0e11 / b6cae56)
- [x] P2: `oss-value.sh failed <workflow>`: RED 18/42 -> GREEN 42/42 (completed 2026-10-20, ca7383e / f301364)
- [x] P3: `oss-value.sh error cmd:<name>`: RED 34/76 -> GREEN 69/69 (completed 2026-10-20, a1fba27 / 06b78fe)
- [x] P4: HOOKS_TO_COPY installs oss-value.sh: RED 8/9 -> GREEN 9/9 (completed 2026-10-20, 4b9dbe5 / 95f012f)
- [x] P5: wrapper `failed` steps: 26 duplicates removed, oss-custom rewritten; RED 1/31 -> GREEN 31/31 (completed 2026-10-20, 58baa7e / 041161d)
- [x] P6: plugin.json 2.0.91 (2.0.90 was used by #201) (completed 2026-10-20, 208c17d); ship is the lead's
- [x] Ship round 1 R1-1..R1-6: RED f49006b -> GREEN cbc86b7 (completed 2026-10-20)
- [x] R1-7, R1-8: reported, not built (see DECISIONS.md)
- [x] Ship round 2 R2-1..R2-4: RED d021aa3 (guard: 51 lines in 27 wrappers; notification-copy 2 red; oss-value 7d 2 red) -> GREEN 7413730 + 3485b50 (completed 2026-10-20)
- [x] Ship round 3 R3-1..R3-7: RED 55d92ef (value-file-wrappers 0/32, oss-value 84 red, guard flags 29 lines) -> GREEN 8ebb265 (completed 2026-10-20)
- [x] R3-8: D5 corrected, visionos `{user_context}` in FOLLOWUPS (completed 2026-10-20)
- [x] Ship round 4 R4-1: value folder ~/.oss/run/home outside a repo; RED 10/12 -> GREEN b351de9 (completed 2026-10-20)
- [x] Ship round 4 R4-2: the 21 KNOWN_OPEN pairs fixed, mechanism removed, `read` names notify_style/voice/sound/verbosity/custom, verb `root`; RED (guard 51 lines, run-test 36 red, oss-value 36 red) -> GREEN 1064220 (completed 2026-10-20)
- [x] Ship round 4 R4-3: oss-log.sh find/pipefail exit; RED 2/4 -> GREEN 21b1c85 (completed 2026-10-20)

## Ship round 5 (2026-10-20)
- [x] R5-1: zero-approval value hand-offs: `Bash(~/.oss/hooks/oss-value.sh:*)` allowed; every wrapper
  spells `~/.oss/hooks/oss-value.sh`; verbs `decrypt [custom]`, `models-set`, `cli <script> <args>`;
  compound guard widened (completed 2026-10-20, 36febd1)
- [x] R5-2: default /oss:login <KEY> = --key path; verb `login`; key via oss_api_curl (stdin); _ov_take
  no longer silences stderr after a missing file (completed 2026-10-20, ba86c72, 9bc354d)
- [x] R5-3: `read model` accepts upper case (isValidModelId examples pinned), refuses `..` (completed 2026-10-20, c72ed05)
- [x] R5-4: guard false positives fixed, rule name printed (completed 2026-10-20, b4a232b)

## Deviations from the plan
- code-simplifier is NOT unserved: /oss:code-simplifier serves agents/code-simplifier, which sends
  `--workflow code-simplifier failed`. So P5 = 26 deletions + 1 rewrite (oss-custom), not 25 + 2.
- The removed blocks in green.md, red.md and refactor.md also held an `oss-log.sh error ... {REASON}`
  line (same injection class); removed with the block.
- Version 2.0.91 instead of 2.0.90.

## Blockers
- None

## Follow-ups flagged (not in scope)
- ~~`complete` notify lines with placeholders remain~~: fixed in ship round 1 R1-1 (all 42 now send '{}').
- Phase B: served prompts hash the git dir alone (~153 sites) and pass an empty CLAUDE_PROJECT_DIR when
  no .oss is found; A3/A4 must move them onto oss-value.sh (new key: toplevel + git dir) in step.
- plan.md and context-report.md keep a fixed `failed '{}'` line (no model text; possible duplicate log).
- hooks/oss-session-start-new.sh and -test.sh have their own stale HOOKS_TO_COPY (not registered).
- ~~Round 3: 21 KNOWN_OPEN pairs; value verbs need a git repo~~: fixed in ship round 4 (D9, D10).
- Round 4 provenance, not changed: login.md:110/260 read ~/.oss/plugin-root unchecked and login.md:230
  names ${CLAUDE_PLUGIN_ROOT} (fallbacks for when ~/.oss/hooks is missing, so oss-value.sh cannot be
  used there); hooks/oss-log.sh:956 and oss-iron-law-check.sh:240 read it unchecked; oss-notify.sh:123
  has the same find/pipefail shape (reached only with a wrong CLAUDE_PLUGIN_ROOT and no cache);
  login.md Steps 6.3/8.1 `cp "~/.oss/hooks/oss-statusline.sh"` quotes the ~ (pre-existing, fails).
- Round 5, not changed: the Write tool to ~/.oss/run/<key> asks for approval by default (outside the
  project and additionalDirectories; no Edit(~/.oss/run/**) allow rule is installed). Blocks that also
  run curl/jq/say (settings Step 4), brew/npm/launchctl/sips or a heredoc write (login first-run steps
  6-8, style) still prompt for those programs; they hold one `X=$(~/.oss/hooks/oss-value.sh ...) ||
  exit 1` line, no chain.

## Last Updated: 2026-10-20 11:20 +07 by /oss:build (ship round 5 implementer)
