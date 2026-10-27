# Learnings

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

## 2026-10-26 | Planning | release-channels
- **Context:** plan
- **Insight:** The `URL:` WebFetch steps in agents/skills/commands are live calls, not documentation, and the API routes they hit return ENCRYPTED JSON, so the model gets ciphertext. The type/name comes from each file's URL, not its filename (e.g. `skills/build.md` fetches `prompts/workflows/build`). Probe with `oss-decrypt --type <t> --name <n>` before converting: on 2026-10-26, `agents/performance-auditor` and `agents/visionos-developer` failed the integrity check on production.

## 2026-10-26 | Planning | release-channels
- **Context:** plan
- **Insight:** The plan's archive step matches `Current Phase:.*(ship|complete)` anywhere on the line, so "ideate (complete) → next: plan" archives a live feature. Keep the word "complete" out of PROGRESS phase lines until the feature ships.

## 2026-10-26 | Config | release-channels
- **Context:** build
- **Insight:** A wrapper's shell step must be ONE command that matches an allowlisted prefix (`~/.oss/hooks/oss-value.sh …`, `~/.oss/bin/oss-decrypt …`). `source … && u=$(oss_api_url) && …` is correct shell, but it makes Claude Code ask for approval on every /oss command (R5-1); `commands/__tests__/no-compound-commands.test.sh` catches it. New wrapper behaviour goes into a verb of `oss-value.sh` (here `keycheck` and `api <endpoint>`), never into an inline pipeline. Run `commands/__tests__/*.test.sh` too, not only `hooks/` and `__tests__/`.

## 2026-10-26 | Testing | release-channels
- **Context:** build
- **Insight:** In a test harness, `VAR=value` produced by an array expansion (`${extra[@]} cmd`) is NOT an assignment: the hook never saw the variable, and a "calls nothing" row passed vacuously. Pass such pairs through `env "${extra[@]}" cmd`. Also, in `hooks/__tests__/oss-value.test.sh` a later section replaces the `$T/sbin/curl` stub with one that does not record stdin; any new section that asserts on `curl.stdin` must install its own stub.

## 2026-10-27 | Security | release-channels (ship round 1)
- **Context:** ship → build (fix round)
- **Insight:** A signature check that FAILS OPEN is no boundary. oss-decrypt delivered prompts unverified when the manifest was missing, slow (>3 s, measured on about 1 in 3 production fetches) or did not list the prompt. Every "key by address" guarantee in ADR-005 rested on it. Before trusting a verification step, test the paths where verification is SKIPPED (missing manifest, timeout, unlisted item), not only the paths where it fails.

## 2026-10-27 | Security | release-channels (ship round 1)
- **Context:** ship → build (fix round)
- **Insight:** Tightening one key sender (oss-decrypt's address→key allowlist) while others (hooks, watcher, login) still accept any https address leaves the key exfiltrable. That is IRON LAW #1b at the security layer. Keep the TRUST rule (which hosts may receive the key) in its own shared case table (`trusted-api-url-cases.json`), separate from the SYNTAX table, and run every reader, in every language, against it.

## 2026-10-27 | Testing | release-channels (ship round 1)
- **Context:** ship → build (fix round)
- **Insight:**
  - A test that greps a workflow's text cannot catch a logic bug in it: `contains(github.ref_name, '-')` was "tested" while matching EVERY tag. Extract the step's shell and RUN it on sample inputs.
  - Once the repo itself is on a beta version (`next`), suites that model a CUSTOMER install must run the hook from a throwaway STABLE plugin tree, or they silently start testing the beta path.

## 2026-10-27 | Process | release-channels (ship round 1)
- **Context:** ship → build (fix round)
- **Insight:**
  - Read every test result line before writing a commit message that quotes it. A 2/3 was committed as "3/3" and needed a follow-up correction commit.
  - When a bash command is moved to the background after it already ran `git stash push`, never touch the stashed file until it finishes. Then restore by the stash entry's SHA, not by position.

## 2026-10-27 | Testing | cli-decrypt
- **Context:** build (release-channels ship round 2, SR7)
- **Insight:** `stripControl` removes LF and TAB too, so it flattens a multi-line document into one line; prompt bodies (team custom commands) need `stripControlKeepLines`, which strips the same set except LF/TAB (CR still goes, so CRLF prints as LF).

## 2026-10-27 | Testing | cli-decrypt
- **Context:** build (release-channels ship round 2, SR10)
- **Insight:** a "timeout survives a stalled body" test needs a real local server that sends 200 + headers + part of the body and then stalls; a server that never sends headers passes with any abort mechanism. In vitest, `AbortSignal.timeout` did abort the stalled body (the perf gate saw it hang in a plain node run under GC), so the AbortController+setTimeout choice is not distinguishable by that test: guard the wiring (signal passed, timer cleared only after the body is read), not the mechanism.

## 2026-10-27 | Security | cli-decrypt
- **Context:** build (release-channels ship round 2, SR4/SR17)
- **Insight:** fixing one file writer for symlink-following left three others (prompt cache, update state, credentials) with the same defect; when a gate names one writer, grep every `writeFileSync`/`mkdirSync` in the package and route them all through one safe-write helper (IRON LAW #1b).

## 2026-10-27 | Testing | plugin
- **Context:** build (release-channels ship round 2)
- **Insight:** in this harness, typing `\uXXXX` inside a Bash command (even in a quoted heredoc) can turn into raw or corrupted UTF-8 bytes; write test data containing `\u` escapes with the Write/Edit tools instead.

## 2026-10-27 | API | packages/api
- **Context:** build (release-channels ship round 2, SR15)
- **Insight:** a `Record` lookup with `map[name] || name` on a URL param resolves `constructor`/`__proto__`/`toString` to Object.prototype members; here it surfaced as a 400 "Invalid prompt name" for a well-formed name, not a 500, so only a test asserting 404 catches it. `tsconfig` lib is ES2020: use `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`.

## 2026-10-27 | API | packages/api
- **Context:** build (release-channels ship round 2, SR1)
- **Insight:** when a route resolves a name through a mapping with a fallback (`workflowCommandName`: alias, else `commands/<n>`), whatever signs or lists the servable names must go through the same function and enumerate the fallback set too; signing only the mapping keys silently left 29 shipped commands unsigned.

## 2026-10-27 | Security | plugin + cli-decrypt
- **Context:** build (release-channels ship round 2, SR17)
- **Insight:** "refuse symlinks" collides with this feature's own layout: `~/.oss` is a symlink to `~/.oss-<channel>` by design (oss-channel.sh). Resolve the config directory itself once (realpath, then owner/mode checks on the target) and refuse symlinks only for what is inside it. Every hardening of a path under `~/.oss` needs a test row with the symlinked channel layout.

## 2026-10-27 | Testing | cli-decrypt
- **Context:** build (release-channels ship round 2, SR17)
- **Insight:** in a test that changes HOME, assert `os.homedir() === HOME` before touching anything, so a runtime that ignores HOME can never reach the real `~/.oss`; and in mutation loops back up into a fresh `mktemp -d` and check the copy succeeded, or mutations stack silently.

## 2026-10-27 | Testing | watcher
- **Context:** build (release-channels ship round 2, SR10)
- **Insight:** on Node 25 a fetch with `redirect: 'error'` whose signal is aborted while GC runs does NOT reject a pending `response.json()`, whether the signal came from `AbortSignal.timeout` or an AbortController + timer; bound fetch + body read with one deadline race (`watcher/src/api/with-deadline.ts`). To reproduce in vitest without CLI flags: `v8.setFlagsFromString('--expose-gc'); vm.runInNewContext('gc')` and call it in a tight interval during the request.

## 2026-10-27 | Testing | watcher
- **Context:** build (release-channels ship round 2, SR13)
- **Insight:** status-line tests inherit `CLAUDE_PLUGIN_ROOT` / `~/.oss/plugin-root`, which other tests rewrite; on a beta checkout the channel mismatch warning leaks into unrelated assertions. Pin the plugin version per test file (temp plugin root with its own plugin.json). And a new `src` module imported by a tracked `watcher/dist` file must have its dist output committed too.

## 2026-10-27 | Config | hooks
- **Context:** build (release-channels ship round 2, SR9/SR2/SR11)
- **Insight:** on macOS a status-line render pays ~15 ms per `find` and ~4 ms per `stat`; `id`/`find`/`tr`/`head` forks were most of the +20 ms. Guard render cost by counting processes (PATH shims, diff against a stubbed section), not wall time. Checking modes through a symlinked channel home needs `stat -L`/`find -H` (plain stat judges the link's 0755). `kill` on a `( sleep N; ... ) &` watchdog leaves the sleep alive: trap TERM inside the subshell. On GNU, a `stat -f` probe can exit 0 when a file named like the operand exists, so validate the output, not only the rc.

## 2026-10-27 | Testing | watcher + hooks
- **Context:** build (release-channels ship round 2, SR18)
- **Insight:** parallel fix branches each passed their own suites, yet the merge broke a watcher test: SR6 (hook always runs the CLI installer) made a watcher test that runs the real hook with a stub CLI start real GitHub downloads. After merging fix branches, run every suite that executes a changed script, across packages; and put a curl tripwire on PATH in any test that runs a hook, so network access fails loudly.

## 2026-10-27 | Testing | hooks + API
- **Context:** integration (release-channels ship round 2)
- **Insight:** a test seed that bypasses the real writer (a synthetic `personal_<id>` row) made a read path look tested when real data never reaches it; seed through the route. And in shell tests, a `$(...)` in a call's arguments resets `$?` before a later `$?` in the same argument list expands, so `cmd; check "x $(wc -l <f)" $?` always passes. To boot the API without loading `packages/api/.env`, run it from an empty cwd (`dotenv.config()` reads `process.cwd()/.env`).
