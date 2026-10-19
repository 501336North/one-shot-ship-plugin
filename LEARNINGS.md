# Learnings

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
