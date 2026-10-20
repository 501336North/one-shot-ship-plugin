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

## Ship round 4 (2026-10-20 08:28 +07, CLAUDE_PROJECT_DIR unset, sequential)
- R4-1 RED: oss-value.test.sh 170/175 (4c home folder, 12 failed from a non-repo cwd, 17 read from a
  non-repo cwd); value-file-wrappers-run.test.sh (new) 2/12: login --key, models set, workflows,
  trust refused from a non-repo cwd, the repo-cwd control passed. GREEN b351de9: 175/175, 12/12.
- R4-2 RED: guard without KNOWN_OPEN flags 51 lines in 9 wrappers (detector fixture still 24/24);
  run-test 36 red of 59 (settings, telegram, oss-custom, watcher, webhook, login root/paths,
  oss-audio source ran PWNED, models set ran `/watcher/dist/cli/models.js`); oss-value 36 red of 242
  (5 names, root verb, dir clear list); visual-test-auth 2/3. GREEN 1064220: guard 33/33, run-test
  61/61, oss-value 242/242, visual-test-auth 3/3, oss-custom-name 5/5.
- R4-3 RED: oss-log-missing-cache.test.sh (new) 2/4 (agent and phase start rc 1 with the line
  written, no plugin cache; cache control passed); oss-value 18 rc 1. GREEN 21b1c85: 4/4, 243/243.
- Anti-vacuity / mutations: R4-1 RED was the unchanged script; R4-2: voice rule `.*` -> 6 oss-value
  + 2 run-test red; PID regex removed -> `1 1` and `1,1` read as running (2 red); linked check removed
  -> odd linked value red; oss-audio `source` -> PWNED (RED run). Restored -> green.
- Sandbox HOME (mktemp, never ~/.oss), blocks run as written with stub curl/node/say/afplay/
  terminal-notifier/sips/launchctl/sleep/npm/brew/oss-decrypt: notify_style `$(touch PWNED)` and
  `visual'; touch PWNED; '`, verbosity `$(touch PWNED)`, voice `$(touch PWNED)` and `Samantha` +
  newline + `$(touch PWNED)`, sound backtick, custom `$(touch PWNED)`/`team:review`/quote/two-line/`../x`,
  PID file `$(touch PWNED)`/`1; touch PWNED`, config apiKey `$(touch PWNED)`, plugin-root
  `/tmp/$(touch PWNED)`, audio-config with `touch "$HOME/PWNED"`: all refused or inert, settings.json
  untouched, nothing decrypted, PWNED never created. Every new read name also refused for quotes,
  case, out-of-list values, two lines, and a valid first line followed by a command.
- hooks/__tests__ + commands/__tests__: 43 files, 42 rc 0; only ideate-template 3/4 (pre-existing).
  oss-value 243/243, oss-log-missing-cache 4/4, guard 33/33, value-file-wrappers 32/32,
  value-file-wrappers-run 61/61 under bash 3.2 and 5.2.26.
- watcher vitest (no-setup config): test/hooks + test/commands + notification-copy 49 files 414/414.
  tsc --noEmit clean.

## Ship round 5 (2026-10-20)
- R5-1 RED: auto-permissions 8/10 (oss-value.sh not allowed); no-compound-commands flagged 40 wrapper
  lines (not-allowlisted-spelling, substitution-in-chain) with its detector fixture passing;
  value-file-wrappers 17/38; no-model-text dir/failed pins 32/33; run-test 50/61 (no one-call blocks);
  oss-value 50 red (decrypt/models-set/cli: usage). GREEN 36febd1: 10/10, 2/2, 38/38, 33/33, 61/61, 288/288.
- R5-2 RED: oss-value 22 (login: 9 red), value-file-wrappers 4 red, run-test 2 red. GREEN ba86c72: 297/297,
  41/41, 61/61. Final run then found oss-api-curl.test.sh guard red (Bearer header in a tracked hook):
  RED test 22 key-on-stdin-not-argv (319/320), GREEN 9bc354d (login uses oss_api_curl): 320/320, 6/6.
- R5-3 RED: 4 red (upper-case model ids refused, `..` accepted). GREEN c72ed05. The shared examples
  (incl. ollama/hf.co/org/Qwen3-GGUF:Q4_K_M, openai/GPT-4o, default, claude) pass isValidModelId run
  with node against watcher/dist/types/model-settings.js AND `read model`.
- R5-4 RED: guard fixture flagged 30 (6 false positives) and no rule names. GREEN b4a232b: 34/34, fixture
  25 positives exactly (adds `echo "$3"` after a function body).
- Anti-vacuity / mutations (each restored after): decrypt without cd back, name unchecked, cli port check
  removed, cli arg count loosened, models-set type rule changed, login without the 200 check, key
  unchecked, config overwritten, _ov_take back to `exec 3<&- 2>/dev/null`; guard: function body never
  closes, no fn positional, no single-quote strip, no env names, no [OK], wrong rule name -> each red.
  models-set's `cd` back to the caller's folder was unguarded and removed (models.js uses ~/.oss).
- Sandbox HOME (mktemp, never ~/.oss), stub node/curl/oss-decrypt: category/name/custom/prompt/model
  values `$(touch PWNED)`, quotes, `;`, backticks, `..`, `/`, upper case where not allowed, two lines,
  symlinked value files, missing files; cli `webhook-toggle off;id`, `../../x`, extra args, bad ports,
  one argument with a space; login keys `$(touch PWNED)`, quote, short, spaces, API 401. All refused
  with nothing run or saved; PWNED never created; the key never in curl argv.
- hooks/__tests__ + commands/__tests__: 43 files, 42 rc 0; only ideate-template 3/4 (pre-existing).
  oss-value 320/320, guard 34/34, run-test 61/61, compound 2/2 also under /opt/local/bin/bash 5.
- watcher vitest (no-setup config) test/hooks + test/commands: 48 files 371/371. tsc --noEmit clean.

## Last Updated: 2026-10-20 11:20 +07 by /oss:build (ship round 5 implementer)

- R5-6 RED (umask 022, sandbox HOME): config.json -rw-r--r--, ~/.oss drwxr-xr-x; existing 644 config stayed 644. GREEN: -rw------- / drwx------, no config.json.* temp left. Mutations: drop `$HOME/.oss` from `dir`'s mkdir -m 700 -> red; plain `printf > config.json` -> red. Dropping only umask 077 + chmod 600 survives (mktemp already creates 600): defence in depth, unguarded by design.
- R5-7 RED: `{bad` and no jq (a jq stub exiting 127 first on PATH) -> rc 0, `Plan: pro` / `Plan: `, config.json truncated. GREEN: rc 1, error, cmp byte-identical, no temp. Added the empty config.json case (jq rc 0, no output); mutation dropping `test -n "$u"` -> that case red.
- R5-8 RED: oss-login.sh missing (14 red in oss-value section 22), login.md still calls oss-value.sh login (2 red), wrappers-run 2 red, session-start-hooks-copy 1 red. auto-permissions "oss-login.sh absent" (fresh + merged) passes by construction; mutation adding Bash(~/.oss/hooks/oss-login.sh:*) to OSS_PERMISSIONS -> 2 red. Mutations: removing the sourced-return guard in oss-value.sh -> 14 red; re-adding `login) exec oss-login.sh` to oss-value.sh -> the "oss-value.sh login is refused" check red.
- The login tests stay in oss-value.test.sh section 22 (its sandbox helpers) and run hooks/oss-login.sh via OV_SCRIPT.
- Final (sequential, once): hooks/__tests__ + commands/__tests__ 43 files, 42 rc 0, only ideate-template 3/4 (pre-existing); oss-value 328/328, auto-permissions 14/14, referenced-hooks-tracked 39/39, no-compound 2/2, wrappers 42/42, wrappers-run 61/61. watcher vitest test/hooks + test/commands (no-setup config): 48 files 372/372.
