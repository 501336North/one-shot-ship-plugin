# Testing: plugin-value-flags (plugin Phase A)

## Strategy
- `hooks/__tests__/oss-value.test.sh`: behaviour of `oss-value.sh dir|failed|error` in a sandbox HOME,
  against the REAL sibling oss-notify.sh and the REAL watcher/dist/cli/oss-error.js. Run under
  /bin/bash 3.2.57 and /opt/local/bin/bash 5.2.26. Refusals must not be rc 0, 2 (usage), 126 or 127,
  so a script that lacks a verb cannot pass them. A recording `node` on PATH makes "nothing emitted"
  mean the emitter never ran (oss-error.js validates too, which would otherwise mask the helper).
- `hooks/__tests__/session-start-copy.test.sh`: session start installs oss-value.sh and its `dir`
  works from ~/.oss/hooks.
- `commands/__tests__/no-model-text-in-failed.test.sh`: scan of commands/*.md, with a detection floor.

## Results (2026-10-20)
| Task | RED | GREEN | Anti-vacuity |
|---|---|---|---|
| P2 failed | 18/42 fail (rc=2 usage) | 42/42 both bashes | 6 mutations: no cleaning 2, link count 1, symlink 1, walk 8, name rule 5, delete 1 |
| P3 error | 34/76 fail (rc=2 usage) | 69/69 both bashes | 16 mutations each 1-4 fail; first run found the absolute and one-line plugin-root rules survived (test -d refused the inputs), tests sharpened |
| P4 copy | 1/9 fail (exists=n) | 9/9 both bashes | RED commit is the revert |
| P5 wrappers | 30/31 fail | 31/31 both bashes | ship.md restored 2 fail; oss-custom.md restored 4 fail |
| R1-1 wrappers | 42 placeholder lines in 27 files | 33/33 | revert of commands/*.md: 42 again |
| R1-2..R1-6 helper | 17/76 fail (incl. 4 from the deliberate key-formula pin change) | 76/76 both bashes | revert of oss-value.sh: 17 fail again |

R1-5 uses a `stat` on PATH that swaps reason.txt for a symlink to a secret on first lookup; R1-4 a
`git` on PATH that fails `--absolute-git-dir`. R1-2 runs the real oss-notify.sh and oss-error.js
with ~/.oss/current-project naming a victim repo that has a .oss.

## Ship round 1 suites (2026-10-20 06:05 +07, CLAUDE_PROJECT_DIR unset, sequential)
- hooks/__tests__ + commands/__tests__: 40 files, all rc 0 except ideate-template 3/4 (pre-existing).
- watcher test/hooks + cc-v2150-adoption + model-frontmatter + prompt-cache: 33 files, 275/275.

## Final suites (2026-10-20, CLAUDE_PROJECT_DIR unset, sequential)
- hooks/__tests__: 30/30 files rc 0 (oss-value 69/69, session-start-copy 9/9).
- commands/__tests__: 9/10 files green; ideate-template 3/4 fails identically on the parent commit
  (pre-existing, unrelated).
- watcher/test/hooks (no-setup config, no setupFiles): 30 files, 181/181.
- vitest ship-wrapper-chain + chain-step-contract (read ship.md): 36/36.

## Ship round 2 (2026-10-20 06:35 +07, CLAUDE_PROJECT_DIR unset, sequential)
- RED d021aa3: no-model-text-in-failed section 4 flagged 51 lines in 27 wrappers (control fixture
  11/11: lowercase, Mixed, hyphenated, `<reason>`, bare fence, ~~~bash, ```Bash, ```bash title="x",
  inline span, inline hook line, `{x}` in a heredoc; not flagged: `${HOME}`, `%{http_code}`, a json
  fence, prose `<b>`, heredoc `<dict>`, prose spans that run nothing). notification-copy 2 red,
  oss-value 7d 2 red.
- Anti-vacuity: GREEN files reverted -> the same 51 lines / 2 / 2 red; restored -> green.
- Mutation on a copy of commands/: `"{test_file}: {failure_message}"` back on red.md:133 -> guard red
  (1 line); `<reason>` back on xray.md:134 -> guard red (1 line).
- hooks/__tests__ + commands/__tests__: 40 files, 548/549 assertions; only ideate-template 3/4
  (pre-existing, same failure on the RED commit). oss-value 78/78 and the guard 33/33 under bash 3.2
  and 5.2.
- watcher vitest (no-setup config): test/hooks, test/commands, test/skills, notification-copy and
  every other file that reads commands/*.md: 59 files, 1128/1128. tsc --noEmit clean.
  watcher-dist-fresh: 121 tracked dist files match.

## Ship round 3 (2026-10-20 07:50 +07, CLAUDE_PROJECT_DIR unset, sequential)
- RED 55d92ef: value-file-wrappers.test.sh (new) 0/32; oss-value.test.sh 86/170 (84 new red: dir
  clear list, `read` 17-*, `agent` 18-*); no-model-text-in-failed section 4 flags 29 wrapper lines
  (build.md log example, login.md user args, models.md $1/$2 and display fences). Fixture 24/24
  positive lines (spaces . : |, [MESSAGE], ${X:-{reason}}, %{x} off curl, bash heredoc <reason>,
  unassigned $NAME and $1, http {workflowName}, all round-2 spellings) and negatives (curl -w
  %{http_code}, jq '{type: $k}', [ -f x ], tr '[A-Z]', <in >out, assigned/allowed variables,
  {apiKey}, a /oss: usage line, [CHAIN], text fence); KNOWN_OPEN checked both ways (listed hit hidden,
  vanished entry STALE).
- GREEN 8ebb265: all three green.
- Anti-vacuity: the 10 GREEN files reverted -> 0/32, 86/170, guard 33/34; restored -> green.
- Mutation on copies of commands/ (13 spellings inserted one at a time, incl. `NEW_KEY="$KEY_ARG"`,
  `PROMPT_NAME="$1"`, http `{workflowName}` and `{apiToken}`): guard red each time; fixing
  models.md PLUGIN_ROOT in a copy -> STALE:models.md:PLUGIN_ROOT; unchanged copy green.
- Sandbox HOME (scratchpad, never ~/.oss), wrapper lines run as written: key.txt `$(touch PWNED)`,
  `ossk_ok'$(touch PWNED)'`, two-line, backtick; style.txt with `'; touch PWNED; '`; trust category
  `build/../x`; agent.txt `$(touch PWNED)`, quote, two-line -> all refused rc 1, nothing printed, file
  deleted, PWNED never created (bash 3.2 and 5.2). Valid key printed; valid agent logged
  `[AGENT] code-reviewer: starting: delegated task` (rc 1 there from the pre-existing oss-log.sh
  find/pipefail exit when no plugin cache exists: FOLLOWUPS).
- hooks/__tests__ + commands/__tests__: 41 files, 40 rc 0; only ideate-template 3/4 (pre-existing).
  oss-value 170/170, guard 34/34, value-file-wrappers 32/32 under bash 3.2 and 5.2.
- watcher vitest (no-setup config): test/hooks + test/commands + notification-copy 49 files 414/414;
  cc-v2150-adoption, prompts/refactored, skills/workflows 29/29. tsc --noEmit clean.

## Last Updated: 2026-10-20 07:50 +07 by /oss:build (ship round 3 implementer)
