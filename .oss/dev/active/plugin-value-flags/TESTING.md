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

## Last Updated: 2026-10-20 06:36 +07 by /oss:build (ship round 2 implementer)
