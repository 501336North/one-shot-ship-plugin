# Learnings

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
