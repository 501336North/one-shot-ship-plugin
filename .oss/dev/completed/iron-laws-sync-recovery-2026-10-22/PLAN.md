# Plan: Recover hooks/oss-iron-laws-sync.sh (never committed since PR #150)

Boss, 2026-10-16: "yeah recover it ASAP then".

## Problem
Plugin PR #150 (2026-03-10) made session start call `$PLUGIN_ROOT/hooks/oss-iron-laws-sync.sh` and copy it to `~/.oss/hooks/`. It deleted `oss-iron-laws-inject.sh`, but it never committed the new script or its tests.
- PR #161 (`/oss:ideate`), `login.md` Step 4.1 and `auto.md` all call it.
- Released plugins (≤ 2.0.83) do not contain it.
- Result: customers get no IRON LAWS sync at session start, and `/oss:login` cannot fetch the IRON LAWS through it.
- The script and its tests survive only in the untracked-files stash commit `1241889` (2026-07-21). That copy is byte-identical to `~/.oss/hooks/oss-iron-laws-sync.sh` on Boss's Mac.

## Tasks (TDD)
### T1: Recurrence guard
RED: a test that every hook named in `hooks/oss-session-start.sh` (HOOKS_TO_COPY plus every `$PLUGIN_ROOT/hooks/*.sh` it executes), and every `~/.oss/hooks/*.sh` referenced by `commands/*.md`, exists and is tracked in git (`git ls-files`). It must fail today on `oss-iron-laws-sync.sh`.

### T2: Restore the script and its tests from 1241889
- Files:
  - `hooks/oss-iron-laws-sync.sh`
  - `hooks/__tests__/iron-laws-sync.test.sh`
  - `hooks/__tests__/session-start-iron-laws.test.sh`
  - `commands/__tests__/no-iron-laws-fetch.test.sh`
- Check them against TODAY's code and API before trusting them:
  - endpoint `/api/v1/prompts/shared/iron-laws`, its auth, and its response shape;
  - the IRON LAWS markers in CLAUDE.md that login.md uses;
  - `~/.oss/config.json` key extraction;
  - error-contract conventions (2.0.81+);
  - no secrets in output.
- The restored tests must FAIL without the script (move it aside) and PASS with it.

### T3: Clean-machine check
- With a temp HOME (empty `~/.oss` plus a config holding the real apiKey copied, never printed) and a temp project, run session start or the script, then verify CLAUDE.md gets the IRON LAWS block.
- Run it again and verify idempotence (a fresh block is not duplicated).
- Use read-only API calls only.

### T4: Version bump and changelog
- Bump `plugin.json` from 2.0.83 to 2.0.84, plus the CHANGELOG entry if the repo keeps one.

## Ship gate round 1 → fix tasks (2026-10-16)
All 4 gates FAILED (code-review: 1 CRIT, 3 HIGH; security: 2 HIGH; pen-test: 2 HIGH; performance: 3 HIGH), all reproduced. Round 1 fixes everything. Stopping rule as in the served ship.md (round 1 all; then CRITICAL/HIGH; human at the cap, which offers "keep going").

### R1 Session-start safety model (security/pen-test HIGH, INFO dirty tree / $HOME)
- Session start (no flag) only REFRESHES an existing, well-formed IRON LAWS block. It never creates CLAUDE.md and never appends.
- `--install` mode (used only by /oss:login, in the project the user is logging into) may create or append.
- Both modes refuse when CLAUDE.md is a symlink, not a regular file, or resolves outside CLAUDE_PROJECT_DIR (any parent symlink), and when CLAUDE_PROJECT_DIR is $HOME.
- Tests: symlink (absolute, relative, dangling) → target unchanged and no write; no markers at session start → no write; install creates the file; $HOME is refused.

### R2 Exact markers (CRITICAL cr-1, HIGH sec/pen)
- Match whole marker lines only (the exact login.md START/END lines). Rewrite only when there is exactly one START before exactly one END; otherwise skip (no write, warn on stderr).
- Strip any marker lines from the API body.
- Tests: START without END → byte-identical; prose containing "IRON LAWS START" → untouched; body containing an END marker → no growth after 3 refreshes; two blocks → untouched.

### R3 Body validation and caching (HIGH perf/cr/sec, MEDIUM size)
- `--max-filesize 262144`. Reject an empty body, one under ~500 bytes, one without "IRON LAW", or one that looks like HTML. On reject: keep the existing block, write nothing, print nothing.
- Negative cache: on any failure, touch a backoff stamp (1h) so session start doesn't retry every time.
- The fresh-cache stamp is touched only on a validated write.
- Tests: empty 200, an HTML 502 page, 16MB, a body without a heading → block unchanged, stdout empty; second run within the backoff makes no curl call.

### R4 Never block session start (HIGH perf)
- `curl --connect-timeout 2 -m 4`. session start runs the refresh in the background (detached, output discarded), so it never delays the session. login's `--install` runs in the foreground.
- Tests: a blackholed API → session start returns in < 3s (generous bound, not a timing race: assert background dispatch rather than elapsed time where possible).

### R5 apiKey never in argv (MEDIUM, IRON LAW #1b provenance)
- One shared helper, `hooks/lib/oss-api-curl.sh` (or similar), that passes the Authorization header via `--config -` on stdin.
- Route this script AND the other sites (`oss-session-start.sh:121`, `fetch-iron-laws.sh:64`, `oss-push-metrics.sh:93`, `oss-notify.sh:305`, plus a grep for any other `Bearer` in hooks/) through it.
- Test: a curl shim records argv; the key never appears in it; the request still carries the header.
- The new helper must be tracked (the T1 guard covers lib/ too).

### R6 Robust rewrite (MEDIUM/LOW)
- awk- or printf-based rewrite (no `echo "$line"`), keeping lines like `-n`/`-e`.
- Temp file in the same directory, chmod to the original mode, trap cleanup, atomic `mv`.
- `mkdir` lock with stale-lock handling; re-check the markers inside the lock.
- Parse `~/.oss/config.json` with real JSON parsing (node is guaranteed by Claude Code). This makes the ideate.md claim true.
- Tests: `-n` line kept; mode 0644 kept; 3 concurrent runs → exactly one block; JSON with spaces/escapes parsed.

### R7 login.md double block (MEDIUM cr)
- login Step 4 uses `oss-iron-laws-sync.sh --install` as the single writer of the block and no longer appends the IRON LAWS itself. Keep the template merge for the non-IRON-LAWS part.
- Text test: login.md does not append a second START block; the 4.1/4.3 flow is coherent.

### R8 Tests and guard quality (LOW)
- `session-start-iron-laws` tests 1-2 become behavioural (run session start in a temp HOME with a curl shim).
- The T1 guard also covers `${CLAUDE_PLUGIN_ROOT}/hooks/...` references in hooks.json and commands.
- The network path is tested even with `OSS_SKIP_HEALTH_CHECK` (call the script directly).

## Ship gate round 2 → Boss: one more round for 4 customer-impacting items (2026-10-16)
Round 2: all 4 gates PASS (no CRITICAL/HIGH). Boss: "Yes, one more round".

### S1 (MED cr2-2): legacy marker
`<!-- IRON LAWS START -->` (written by /oss:ideate 2026-02-27..03-18, #146-#161) and its END twin are accepted as a well-formed block and rewritten to the canonical markers. Tests: refresh and --install on a legacy block → one canonical block, user content kept.

### S2 (MED pen2-1): login.md stops when the script refuses
If `oss-iron-laws-sync.sh --install` refuses (symlink, non-regular file, outside the project, $HOME, malformed markers), login skips 4.2-4.3 entirely and tells the user why. Text test that pins this wording.

### S3 (LOW cr2-6): node-free config parsing
Parse `~/.oss/config.json` without requiring node. Use node if available, else python3, else a strict, documented sed/grep fallback for the flat `"apiKey": "..."` shape that handles JSON escapes (\" and \\). The key is never printed. Tests run each path with PATH manipulated (node absent, python3 absent).

### S4 (LOW cr2-1, sec2-3, pen2-5): CRLF and trailing whitespace on marker lines
Strip `\r` and trailing whitespace before comparing marker lines. A file that uses CRLF keeps CRLF line endings after a rewrite. Tests: a CRLF file with one block → refresh updates it in place (no second block); --install doesn't duplicate it.

### Deferred → FOLLOWUPS (round 2, non-blocking)
- per-project freshness stamp
- stale-lock double-break and clock skew
- the CLAUDE.md→symlink swap race at mv (use a rename that does not follow the target)
- ideate/auto foreground refresh
- single-flight fetch before the lock
- setsid for the detached sync
- login.md/settings.md/telegram.md still show the key in a curl argv
- the parent-directory check is dead code
- login.md 4.3 stale template tail
- JSON body `{` not rejected
- behavioural tests for notify/telegram call sites
- oss-notify analytics curl has no -m
