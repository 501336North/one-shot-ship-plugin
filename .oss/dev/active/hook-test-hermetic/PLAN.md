# Implementation Plan: hook-test-hermetic

## Summary
Hook background jobs stop holding their caller's output open, and network calls get time limits. That is a customer-facing fix: session start and every /oss command start. The hook test suite becomes hermetic: no real HOME, no real network, no production analytics, no machine-wide pkill. It also stops being flaky: no timed section depends on the first exec of a new file.

## Design Reference
See: `.oss/dev/active/hook-test-hermetic/DESIGN.md`

## Ground rules for /oss:build
- **Each task is one RED-GREEN-REFACTOR cycle**, delegated to a specialist agent, phase-logged, then committed and pushed. Bash hooks go to `test-engineer` for RED and `debugger` or `refactoring-specialist` for GREEN. Vitest goes to `typescript-pro` or `test-engineer`.
- **Until T5 lands**, never run plain `npx vitest`: `watcher/test/setup.ts` pkills machine-wide. Use the untracked safe config, which has no setupFiles, pool forks and fileParallelism false. After T5, the real config is safe and is the one to run.
- **Test-only tasks (T7–T14) have no production code to write.** Their RED has two parts (see DECISIONS D2):
  1. The new assertion fails against the defect it guards.
  2. An anti-vacuity mutant of the production guard turns it RED.

  GREEN means it passes on real code. The flaky dependency (real HOME, real network, wall-clock, cold exec) must be gone from the file.
- **IRON LAW #1b:** every production task greps for sibling sites (T4 is the sweep) and records what it found in the commit body.

## Follow-ups pulled into this plan
FOLLOWUPS.md lines 59 (setup.ts pkill), 90 (api-curl.real curl has no -m), 103 (analytics curl has no -m and inherits stdio) and 126 (load-sensitive timing tests).

---

## Phase A: Production hooks (customer-facing)

### Task 1: Workflow `start` analytics POST never holds the caller and is time-bounded
**Objective:** `oss-notify.sh --workflow <cmd> start` returns, with its stdout and stderr closed, before the analytics request finishes. The request carries a time limit. (`hooks/oss-notify.sh:259-266`)

**Tests to Write (RED)**, file `watcher/test/hooks/oss-notify-analytics-detach.test.ts` (new). The sandbox has: HOME with a fake apiKey and an `apiUrl` pointing nowhere real; a PATH `curl` stub, created once and warmed, that writes `received` plus its argv, then waits for a `release` file (a 30 s cap is only a backstop).
- [ ] `should close its output before the analytics request finishes`. Spawn the hook with piped stdio and wait for `received`. The hook's `close` event (EOF on both pipes) must fire while `release` is still absent. Then write `release`.
- [ ] `should give the analytics request a time limit`. The recorded argv contains `-m N` or `--max-time N` with 1 ≤ N ≤ 10.
- [ ] `should still send the analytics event` (control). Within the backstop, the recorded argv targets `/api/v1/analytics/track` with the command name.

**Implementation (GREEN):** detach the subshell (`) </dev/null >/dev/null 2>&1 &`) and add `-m 5` to that one `oss_api_curl` call.

**Refactor:** none expected.

**Acceptance:** the 3 tests pass. Removing the redirect, or removing `-m`, turns the matching test RED (anti-vacuity, recorded in TESTING.md).

### Task 2: A pending update notice never holds session events for 11 s
**Objective:** `oss-notify.sh --session context_restored|fresh_start` returns at once even when `check-updates.sh` prints a notice. The notice is still posted later. (`hooks/oss-notify.sh:356-365`)

**Tests (RED)**, file `watcher/test/hooks/oss-notify-update-notice-detach.test.ts` (new):
- [ ] `should close its output before the update notice is posted`. Plugin-root sandbox: a `check-updates.sh` stub prints a notice, and a recording `workflow-state` CLI stub (or wf_state seam) is in place. The hook's `close` must fire while no `setNotification <notice>` call is recorded yet.
- [ ] `should still post the update notice` (control). The recorded call appears within the backstop of 20 s.

**GREEN:** add `</dev/null >/dev/null 2>&1` to that background subshell.

**Acceptance:** tests pass; removing the redirect turns the first test RED.

### Task 3: Session start does not wait for its background notify call
**Objective:** `oss-session-start.sh` launches `oss-notify.sh --session …` detached (lines 341 and 347), so a slow notify cannot hold Claude Code's startup.

**Tests (RED)**, file `watcher/test/hooks/oss-session-start-notify-detach.test.ts` (new). Session start runs with a sandbox PLUGIN_ROOT whose `hooks/oss-notify.sh` stub writes `received`, keeps stdout open and waits for `release`. The env is hermetic: HOME, no session id, `OSS_SKIP_MANIFEST=1` or equivalent, and no network (stub curl).
- [ ] `should finish starting while the notify call is still running`, for both the context_restored and the fresh_start branch.
- [ ] `should still launch the notify call` (control). `received` appears.

**GREEN:** add `</dev/null >/dev/null 2>&1` to both launches.

**Acceptance:** tests pass; reverting either redirect turns its branch's test RED.

### Task 4: Provenance sweep (IRON LAW #1b) of background jobs and unbounded network calls in `hooks/`
**Objective:** no live hook leaves a background job holding the caller's stdout or stderr. No live hook makes a network call without a time limit. Every site is fixed with a test, or justified.

**Sites found at plan time** (re-grep at build time; the list is a starting point, not the scope):

| Site | Status at plan time | Expected outcome |
|---|---|---|
| `hooks/oss-log.sh:423-437` (`agent` action) | `(node … 2>/dev/null) &`, stdout inherited | Fix: detach. Test: `oss-log.sh agent` closes its output while a stub `node` is still running. |
| `hooks/oss-session-start.sh:270-286` (opt-in health check, `OSS_RUN_HEALTH_CHECK=1`) | Echoes its summary from a background job; it only reaches the user because startup blocks for the whole test run | Fix: detach and write the summary to `health-check.log`. Test like T3. The decision goes in DECISIONS D3. |
| `hooks/oss-notify.sh:108-111` `oss-log.sh` fallback (found by acceptance) | `_found_log=$(find "$HOME/.claude/plugins/cache/…" … \| sort -V \| tail -1)` under `set -euo pipefail`. When the cache dir is missing, the hook exits silently, before any state update. | Fix: `\|\| true` (or a guarded lookup). Test: when `$PLUGIN_ROOT/hooks/oss-log.sh` is absent and there is no plugin cache, `--workflow X start` still updates state. |
| `run_with_timeout` `"$@" &` (oss-notify.sh:33, oss-session-start.sh:27) | Waited in the foreground | Justify: safe, the caller waits by design and the timer is already detached. |
| `oss-notification.sh` / `oss-stop.sh` `&>/dev/null &` | stdout and stderr already detached | Justify: safe. |
| `oss-session-start-new.sh`, `oss-session-start-test.sh` | Not registered as hooks (FOLLOWUPS line 29) | Justify: unreachable; their removal is the existing follow-up. |
| Every `curl` / `oss_api_curl` in `hooks/*.sh` (fetch-iron-laws, oss-fetch-team-iron-laws, oss-push-metrics, oss-login, ensure-oss-launch, ensure-decrypt-cli, oss-iron-laws-sync) | Multi-line calls: check each for `-m`/`--max-time` (or a CURL_OPTS that carries one) | Each unbounded call on a live hook path gets `-m` with a recording-stub test. Already bounded or dead calls are listed as justified. |

**Tests (RED):** one test per site that is fixed, in the matching hook test file, using the same received/release pattern as T1–T3.

**GREEN:** minimal redirect or `-m` per site.

**Acceptance:**
- Each fixed site has a RED-first test plus an anti-vacuity revert.
- The commit body lists every site found and why each unfixed one is safe.
- NOTES.md records the final grep commands and their output.

### Task 4e (found by T4c, 2026-10-29): other pipefail exits in oss-notify.sh. User decision 2026-10-29: follow-up, moved to .oss/dev/FOLLOWUPS.md, not in this branch.
Under `set -euo pipefail`, a `$(echo … | jq …)` with no `||` exits the hook silently whenever the input is not JSON:
- lines 160-162: TITLE, MESSAGE and SUBTITLE from get-copy.js output. `run_with_timeout` returns 0, so the `|| echo '{}'` at line 157 never catches bad output.
- lines 316-319: the `task_complete` context fields, before setTddPhase and setProgress.
- line 399: the `--issue` message, before setIssue.
- line 60 (`resolve_cli`, find|sort|tail): safe today only because it runs inside `$()` without inherit_errexit.
This is not a background-job or time-limit defect, so it is outside DESIGN's scope. It is listed here so it is tracked, not lost.

### Task 4a-2 (found by the full suite after T9, 2026-10-29): tests that read state the detached `oss-log.sh agent` chain has not written yet
`integration/agent-status-line` "should clear agent…" waits for `activeAgent` to clear, then expects `supervisor` to be watching. Since T4a, `setSupervisor watching` runs detached, after `clearActiveAgent`, so the test is flaky. RED: the observed failure, made deterministic. GREEN: wait for the supervisor value. Provenance: grep every test that runs `oss-log.sh agent … completed` (or relies on the order of the two chained calls) and fix each one the same way.

### Task 4f (user: fix in this branch, 2026-10-29): session start's subscription call uses the configured API URL
`hooks/oss-session-start.sh:142` sends the key to a hardcoded `https://one-shot-ship-api.onrender.com/api/v1/subscription/status`. Every other keyed call resolves the URL through `oss_api_url`. IRON LAW #1b: two sites disagree about where the key goes.
- RED: with `apiUrl` set to a sandbox URL in config.json, the recorded curl argv for the subscription call targets that URL (today it targets the hardcoded host). Control: with no apiUrl, the default host is used, as `oss_api_url` defines.
- GREEN: resolve the URL with `oss_api_url`, the same helper the other keyed calls use.
- Provenance: grep hooks/ (and watcher/src if keyed) for other hardcoded API hosts that take a key, for example oss-login.sh:15. Each one is fixed through the same helper or justified (login runs before any config exists).

### Task 4f-2: session start reads the key from the same file as its URL
Found while doing T4f (IRON LAW #1b). The key was read from `~/.oss/config.json`, but `oss_api_url` reads `oss_config_file` (honours OSS_CONFIG_DIR), so HOME's key could go to another config's URL. RED: with OSS_CONFIG_DIR set, the call carries config B's key, never HOME's. GREEN: `CONFIG_FILE=$(oss_config_file)`.

### Task 4g (user: fix here, 2026-10-29): the other keyed scripts use the configured API and its key
`fetch-iron-laws.sh`, `oss-fetch-team-iron-laws.sh`, `oss-iron-laws-sync.sh` and `oss-push-metrics.sh` send the key to a hardcoded `https://one-shot-ship-api.onrender.com`, and read the key from `$HOME/.oss/config.json`. One cycle per script:
- RED: with a sandbox config (key K, apiUrl http://127.0.0.1:9), the recorded request goes to the sandbox URL with K, never to onrender. Control: with no apiUrl, the default host.
- GREEN: `API_URL=$(oss_api_url)` (refuse and skip the call when invalid), with the key from `oss_api_key` / `oss_config_file`.
- Out of scope, recorded: oss-login.sh (first login has no config; re-login against a custom apiUrl is in FOLLOWUPS); oss-session-start-new/-test.sh (unreachable, FOLLOWUPS:29).

### Task 4h: the two notify tests wait for the detached analytics POST
Found by T4g's full shell run. T1 (422f942) detached the workflow-start analytics POST, but `hooks/__tests__/optional-helper-source.test.sh` (case 3) and `hooks/__tests__/oss-notify-api-url.test.sh` (11 of 21) look for the request right after the hook returns, so they now see no call. That is a test that cannot see the real behaviour.
- RED: already red (4/5, 11/21). Before changing them, show each case's assertion would also pass for a hook that never sends (vacuity check) once fixed.
- GREEN: wait for the detached call with the event-driven pattern (fd-3 pipe or a received marker from the curl stub, no sleep), never by un-detaching the hook.
- Mutant: a hook whose analytics call is removed must fail each fixed case.

### Task 13b: complete-bounds parses under /bin/bash 3.2
Found by the T4h agent: T13's node stub has bare `pattern)` case arms inside `$(cat <<EOF)`, and bash 3.2 (the shebang's /bin/bash on stock macOS) ends the substitution at the `)`. It only ran because `bash` on PATH here is 5.3. RED: new hooks/__tests__/bash32-parse.test.sh (`/bin/bash -n` on every bash hook and hook test). GREEN: `(pattern)` arms.

### Task 4i: fetch-iron-laws.sh's request is bounded
Found by T4g: its `oss_api_curl` call has no `-m`/`--max-time`, the only keyed call left without one (DESIGN: no unbounded curls). RED: a stub that holds the request records that no time limit was passed. GREEN: add `-m` like its siblings.

---

## Phase B: Test isolation at the root

### Task 5: setup.ts sandboxes HOME and kills nothing it did not start
**Objective:** under the real `watcher/vitest.config.ts`, every test file runs with:
- `HOME` (so also `os.homedir()`) pointing at a per-run temp directory;
- `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PROJECT_DIR` removed.

setup.ts never pkills by name machine-wide, never deletes `watcher.pid` files under `$TMPDIR`, and never touches the real `~/.oss`. (`watcher/test/setup.ts`)

**Tests (RED)**, file `watcher/test/setup-isolation.test.ts` (new). This is an integration test: it runs a child vitest with the real config on a one-test fixture file, `watcher/test/fixtures/setup-probe/probe.test.ts`. The fixture writes what it sees (`os.homedir()`, `HOME`, the session id) to a path from the env.

The parent starts the child with:
- `HOME=<fakeRealHome>`, containing `.oss/current-project` and `.oss/logs/sentinel`;
- `CLAUDE_CODE_SESSION_ID=live-session`;
- a decoy process named `oss-session-start-decoy` (`bash -c 'exec -a … sleep 60'`, outside `$TMPDIR`);
- a `watcher.pid` in a temp dir it owns.

The tests:
- [ ] `should give tests a home folder that is not the user's`. The probe's `homedir` is not `<fakeRealHome>`, and the probe's HOME matches `os.homedir()`.
- [ ] `should hide the live session from tests`. The probe sees no session id and no `CLAUDE_PROJECT_DIR`.
- [ ] `should leave the user's real ~/.oss alone`. `<fakeRealHome>/.oss/current-project` and the sentinel still exist with the same content.
- [ ] `should not kill processes it did not start`. The decoy is still alive after the child run.
- [ ] `should not delete other runs' watcher pid files`. The pid file still exists.

**GREEN:** setup.ts creates `mkdtemp` HOME and sets `process.env.HOME` before anything reads `os.homedir()`. It deletes the two env vars and removes the pkill, pid-delete and `current-project` deletion. It keeps `OSS_SKIP_WATCHER` and `OSS_SKIP_HEALTH_CHECK`.

**Refactor:** remove the stale header comment. If a test truly needs a clean `current-project`, it lives in the temp HOME and stays per-test.

**Acceptance:** 5 tests pass; restoring any removed line turns its test RED.

### Task 6: Fix, as found, every test that breaks under the sandboxed HOME
**Objective:** the whole `watcher` suite is green under the T5 setup. Tests that relied on the real HOME (16 of 31 hooks files use `os.homedir()`) are made to build their own world in the temp HOME.

**Method:**
- Run the full suite once.
- Each failing file becomes one cycle. RED: the failure observed under the sandbox, recorded. GREEN: the test builds the files it needs. Never point it back at the real HOME.
- Each cycle is logged; the files are listed in PROGRESS.md as T6.a, T6.b, and so on.

**Run result (T5, 2026-10-29), full suite with the real config:** 42 tests failing in 10 files, 3523 passing.
- **T6.a, root cause of 8 files:** the old setup.ts ran `mkdirSync(~/.oss)`, and those tests write `$HOME/.oss/current-project` or `workflow-state.json` into it. The new temp HOME has no `.oss`, so they hit ENOENT. Affected: oss-statusline (19), oss-log-project-local (5), oss-notify-project (3), oss-statusline-next-command (3), oss-statusline-tdd-emoji (3), cli/update-workflow-state (2), oss-log-project (2), oss-statusline-git (1). Fix: setup.ts creates `$HOME/.oss` inside the temp HOME, which every real install has, with its own RED assertion in setup-isolation (DECISIONS D6).
- **T6.b:** oss-session-context-local (3) depends on a real `~/.oss/config.json` apiKey (it gets "Not logged in" instead of the restore, and no .gitignore block). Fix: a sandbox config with a fake key, plus a curl stub so nothing reaches the network.
- **T6.c = T11, pulled forward:** oss-session-logging (1) fails on the same not-logged-in exit. T11 makes this file hermetic anyway, and the suite must be green before T5 can be committed.
- T5 stays uncommitted until T6 is green (IRON LAW: no commit with failing tests).
- The 8 empty `oss-test-home-*` dirs in $TMPDIR predate T5 (dated Oct 19-28). Current runs leave 0: every test dir and all 24 files that mock fs/os were checked with a scratch TMPDIR. They came from killed runs or older local setups. Nothing to fix.

- **T6.b2 (found by T6.b anti-vacuity):** the "should read session-context.md from project-local .oss directory" test cannot tell the project file from the global one. A mutant that restores from `$HOME/.oss/session-context.md` survives. RED: drop the global file from that test (or give the two files different markers and assert the project marker), shown against that mutant. GREEN: the real hook passes. Test-only.
- **Noted, confirmed by T6.c (IRON LAW #1b: two sites disagree):** `oss-session-start.sh:142` hardcodes `https://one-shot-ship-api.onrender.com` for the subscription call and ignores `apiUrl`. Any session-start test that unsets `OSS_SKIP_HEALTH_CHECK` without a curl stub calls production. It is a FOLLOWUPS candidate, recorded at T16.

**Known item before the run (found by T4a, 2026-10-29):** `oss-log-agent-state.test.ts` "should still write to log file..." deletes its project dir in afterEach while the now-detached real `node` chain may still be writing. That is a teardown race that can flake, and it is one T6.x cycle: wait for the chain to finish, or stub node, before deleting.

**Acceptance:**
- The full suite passes.
- `grep -rn "os.userInfo().homedir\|/Users/" watcher/test` finds no reach-around to the real HOME.

---

## Phase C: The 7 diagnosed tests

### Task 7: Shared warm-stub helpers (TS and bash)
**Objective:** one helper per language writes an executable stub and executes it once outside any timed section. The first-exec security scan then happens up front, not inside a test's budget.

**Tests (RED):**
- [ ] `watcher/test/hooks/helpers/warm-stub.test.ts`: `should run a new stub once before handing it over`. `writeWarmStub(path, body)` returns after a warm-up exec of the file itself (not `bash file`). The exec is proven by a marker the warm-up writes. The stub's normal side effect does not happen during warm-up.
- [ ] `hooks/__tests__/warm-stub.test.sh`: the same two checks for `warm_stub` in `hooks/__tests__/lib/warm-stub.sh`.

**GREEN:** the helpers:
- `watcher/test/hooks/helpers/warm-stub.ts`: writes the body with a guard line `[ -n "${OSS_STUB_WARMUP:-}" ] && { : > "$OSS_STUB_WARMUP"; exit 0; }`, `chmod +x`, then execs it once with that env.
- `hooks/__tests__/lib/warm-stub.sh`: the same in bash.

**Acceptance:** tests pass; skipping the warm-up exec turns them RED.

### Task 8: `oss-notify-telegram.test.ts` creates its stubs once, warm
**Fix:** the fake `bin/node` and `plugin/hooks/oss-log.sh` are made once per file in `beforeAll` with `writeWarmStub`. Per-test variation goes through env (`NODE_CALLS`, mode vars), not new files.

**RED:** a new assertion that each test's stub calls were recorded in that test's own calls file (no cross-test leakage once the stubs are shared), shown RED before the per-test env is wired. Plus an anti-vacuity mutant of the production behavior the file guards.

**Acceptance:** the file creates no executable after `beforeAll`, checked with a grep in TESTING.md. It is green 5/5 in the full-suite runs of T15.

### Task 9: `hook-error-adoption.test.ts` uses one env-driven curl stub
**Fix:** the per-test `stubCurl` (lines 60-64) becomes one warm stub in `beforeAll`, driven by `STUB_CURL_MODE`, `STUB_CURL_BODY` and `STUB_CURL_CODE`. The `ensure-decrypt-cli.sh` cases use the same stub.

**RED:** for each mode, an assertion that the hook saw that mode's response (proves the env reaches the shared stub), RED before the env is wired. Plus an anti-vacuity mutant of one adoption path.

**Acceptance:** no executable is written per test; green 5/5 in T15.

### Task 10: `oss-notify-project.test.ts` is hermetic
**Fix:**
- Sandbox HOME with no apiKey, so no analytics call is possible.
- `CLAUDE_CODE_SESSION_ID` stripped from the child env.
- A stub `curl` on PATH that records calls.

**RED:**
- [ ] `should send nothing to the network` (new): the curl stub records zero calls. RED on the current file, which reaches the real network through the real apiKey.
- [ ] Anti-vacuity on one existing project-resolution assertion.

**Acceptance:** green with no network and no real-HOME access; green 5/5 in T15.

### Task 11: `oss-session-logging.test.ts` is hermetic and cannot touch the live session
**Fix:**
- Sandbox HOME, plugin root and cwd.
- `CLAUDE_CODE_SESSION_ID` set to a test-owned id.
- `OSS_SKIP_MANIFEST=1`, or a stub for the manifest step.
- A stub `curl` (covers the subscription call at `oss-session-start.sh:142` and `check-updates.sh:84`).
- Session-end tests get an explicit budget that matches their real cost, or become independent of the 5 s default by removing the slow cold paths.

**RED:**
- [ ] `should only remove its own session pointer`: a pointer for another session id in the sandbox survives session end. RED today, because the test inherits the live id.
- [ ] `should make no network calls`: zero curl-stub calls.

**Acceptance:** after a run, no real `~/.oss` file has changed (checked once by hand at build time with mtimes and recorded); green 5/5 in T15.

### Task 12: `oss-log-error-recovery.test.ts` writes only inside its sandbox
**Fix:** each execSync gets `HOME=<sandbox>` and cwd in the sandbox. All assertions read the sandbox logs. The partial restore of the real `session.log` is removed.

**RED:**
- [ ] `should leave logs outside its sandbox untouched`: a sentinel `build.log` in the parent-provided HOME keeps its exact content. RED today.

**Acceptance:** green; no restore code left; green 5/5 in T15.

### Task 13: `oss-notify-complete-bounds.test.sh` tests boundedness, not wall-clock
**Fix:**
- The node and `oss-log.sh` stubs are created with `warm_stub` in `sandbox()`.
- The `took < N` asserts are replaced by a recording `timeout`/`gtimeout` stub (or an `OSS_STATE_TIMEOUT_SECS` seam only if a recording stub can't observe it). It asserts that every state call ran under a timeout with the expected limit, and that a hung state CLI does not hang the hook (received/release).

**RED:**
- The new boundedness assertions fail against a mutant that drops `wf_state_timeout`.
- The new release-based "does not hang" assertion fails against a mutant that waits on the hung stub.

**Acceptance:** no wall-clock assertion left; green 5/5 in T15 and under load.

### Task 14: `oss-api-curl.real.integration.test.sh` scenario 1 is event-driven
**Fix:**
- Warm the curl shim.
- Replace the `ps` sampling window (8 × 0.15 s, lines 97-104) with a recorder that writes `received` and holds until a `release` file appears, so the argv check runs while the request is provably in flight.
- Add `-m` to the scenario-1 curl (FOLLOWUPS line 90).

**RED:** a mutant that puts the key back in argv fails the new in-flight check deterministically. The old sampler could miss it.

**Acceptance:** green 5/5 in T15 and under load; the test cannot hang (`-m` plus the backstop).

---

## Phase D: Proof and release

### Task 15: Stability proof
Not a code task: verification, recorded in TESTING.md.
- Full `watcher` suite with the real config (after T5): 5 consecutive green runs.
- The full `hooks/__tests__/*.test.sh`: 5 consecutive green runs.
- One run of each while 8 parallel stub-creator processes load the machine. This is the stall condition from diag-b, so it must stay bounded and green.
- A check of the real `~/.oss`: mtimes of `current-project`, `logs/current-session/*.log` and `plugin-root` are unchanged across a full run.

Any red counts as a defect. It is fixed as a new RED-first task, never retried.

### Task 15b: `oss-notification-style.test.sh` waits for the popup instead of a 2 s window (found in T15)
T15 shell run 2 and the load run failed: the hook backgrounds `terminal-notifier` (`&>/dev/null &`,
hooks/oss-notification.sh:50), the test writes the stub fresh per case and polls 20 × 0.1 s, and a fresh
executable's first exec takes 1.6–3.3 s. Under load both styles missed the popup and `telegram == visual`
passed on two incomplete lists.
- RED: a stub that is slow on purpose (or a mutant hook that drops the popup) shows the current test either
  fails or passes vacuously; the new test must fail for the mutant and pass for the real hook.
- GREEN: stubs made once with `warm_stub`, symlinked into each sandbox; run the hook with `3>&1` inside the
  substitution so it returns only when the backgrounded stub exits (the hook redirects only fds 0–2). No clock.
- Same pattern, same fix: `oss-stop-telegram-style.test.sh:30` (fresh stubs, 1 s window).

### Task 15c: negative checks after a background job wait for the job, not `sleep 1` (found in T15)
These pass without proving anything on a loaded machine:
- `session-start-iron-laws.test.sh:114` "no refresh started", `iron-laws-sync-safety.test.sh:363` "no write
  while locked", `project-routing.test.sh:139` "B untouched" (and `:95`, a 3 s window for the state write).
- `oss-session-logging` "should make no network calls" does not wait for the nohup'd sync or the notify job.
Each gets a wait on the job itself (fd-3 pipe or a done marker), plus a mutant showing the negative check can
now go red. No wall-clock asserts.

Then T15's shell part is re-run: 5 runs plus one under load.

### Task 17: session start never downgrades the shared ~/.oss/hooks (found in /oss:integration, user decision 2026-10-29)
`hooks/oss-session-start.sh` (HOOKS_TO_COPY loop) copies its plugin's hooks into the machine-global
`~/.oss/hooks` with no version check. On 2026-10-29 17:52 a session on plugin 2.0.83 replaced oss-log.sh,
oss-notify.sh and ensure-decrypt-cli.sh (2.0.94 installed), so every session logged by the old
current-project rule and ran the old notify and decrypt installer.
- Rule: a session start replaces the shared hooks only when its plugin version is the same as or newer than
  the version that last installed them. It records that version next to the hooks when it copies.
  No record yet (first install, or hooks from before this change): copy, as today.
- RED (acceptance, sandbox HOME): hooks installed by a newer version + a session start from an older plugin
  root → the shared hooks are unchanged. Controls: same version → copied; newer plugin → copied; no record →
  copied. Each must fail against a mutant that drops the check (or always refuses).
- Provenance check (IRON LAW #1b): grep every other writer of `~/.oss/hooks` (oss-session-start-new.sh,
  oss-session-start-test.sh, login, setup-permissions, ensure-decrypt-cli…) and either route it through the
  same rule or state in the commit why it is fine.
- Version compare is numeric per dot-separated part (2.0.100 > 2.0.95) and works in /bin/bash 3.2.

### Task 16: Version bump and server follow-up
- `.claude-plugin/plugin.json` 2.0.94 → 2.0.95 (customer-facing hook fix); also any version pins kept in sync by existing tests.
- FOLLOWUPS.md gets one item: production analytics contains test-run events sent from the developer's account during hook test runs, so AgenticDevWorkflow should exclude or flag them.

## Phase E: /oss:ship gate round 1 findings (2026-10-30)
Four gates (code-reviewer FAIL, security-auditor FAIL, pen-test FAIL, performance PASS). Under the ship
rules, every finding that matters is fixed in round 1, and every security finding matters. Each task is
RED-first with an anti-vacuity mutant, uses a sandbox HOME, and has no wall-clock asserts. Run the IRON LAW
#1b provenance grep on every task that changes where a key, URL, path or version comes from.
Nag, discarded and counted: SC2206 warnings (CR5, solved by T18 if it touches the split); stale committed
`watcher/dist` bundle (CR7, pre-existing); invalid apiUrl writes no backoff stamp (perf 3, no user effect);
iron-laws-sync-safety runtime (perf 4); copy on equal version (perf 6).

### Task 18: harden the T17 version record (pen-test M1, L2, L3, L4, I1; security S4, S5; code-review CR6)
`hooks/oss-session-start.sh`, the version record (`~/.oss/hooks/.installed-version`).
- The record is written only after every hook copy succeeded, atomically (temp file in the same dir + `mv`).
- It is read and written only when it is a regular file and not a symlink. A FIFO, a directory or a
  symlink means no trusted record, so the plugin copies (the same as having no record) and replaces it.
  Never `head` a FIFO.
- The record also names the plugin root that wrote it. A newer record counts only while that root
  still exists and its `plugin.json` still says that version. Otherwise (the newer plugin was uninstalled
  or rolled back, or the record was planted), the older plugin copies. This gives rollback a way back and
  stops a planted high record from freezing updates.
- `~/.oss/plugin-root` (line 62) is written only when the hooks are copied, so the shared hooks and the
  plugin root they use always come from the same plugin.
- Version parse: read `version` from the top-level object of `plugin.json` (not the first "version"
  anywhere); a prerelease such as `2.1.0-beta.1` compares as its numeric core; a part longer than 9
  digits is invalid.
- The health-check background job gets a time bound.

### Task 19: test setup clears every config override (security S1, code-review CR2)
`watcher/test/setup.ts` deletes `OSS_CONFIG_DIR`, `CLAUDE_PLUGIN_ROOT` and `OSS_MANIFEST_URL`. The bash test
files that run hooks with the real env (session-start-iron-laws, oss-notify-complete-bounds,
oss-notification-style, project-routing, oss-value) unset `OSS_CONFIG_DIR`. `setup-isolation.test.ts`
asserts all three are gone. RED: set `OSS_CONFIG_DIR` in the parent env and show a hook reaching the
config it points to.

### Task 20: plain http only with an explicit opt-in for a loopback API (pen-test M2)
`hooks/oss-api-curl.sh:55` (`oss_api_url`). An `http://127.0.0.1…`/`localhost` apiUrl is refused unless
`OSS_ALLOW_HTTP_LOOPBACK=1` is set, so the key is never sent in cleartext to a local port that anything can
listen on, and the reply is never written into CLAUDE.md or team-iron-laws.json. https stays as it is.
Tests that use a local server set the opt-in.
Never silent (user decision 2026-10-30): when a loopback http apiUrl is refused, session start and
`/oss:login` print one line naming `OSS_ALLOW_HTTP_LOOPBACK=1`, so a local dev setup says why it went quiet. Covers every caller: fetch-iron-laws, oss-fetch-team-iron-laws,
oss-iron-laws-sync, oss-push-metrics, oss-session-start.

### Task 21: an unreadable config refuses instead of falling back to production (security S3)
`oss_api_url`: when the config file exists but jq is missing or cannot parse it, return no URL (so no
request is made). Production is the default only when the file parses and has no `apiUrl`.

### Task 22: login and worktree-create use the same config file and API as the hooks (pen-test L1, security S2, code-review CR3)
`hooks/oss-login.sh` validates the key against `oss_api_url` and writes `oss_config_file`, keeping any
existing `apiUrl`. `hooks/oss-worktree-create.sh:21-27` copies `oss_config_file`. RED: with
`OSS_CONFIG_DIR` set, login writes there and the next session start finds the key.

### Task 23: session start reports a broken install instead of "Not logged in" (code-review CR4)
`hooks/oss-session-start.sh:141`: when `oss-api-curl.sh` did not load, say the install is broken (reinstall
the plugin), not "Not logged in".

### Task 24: JSON built from values is escaped, TEAM_ID is checked (security S6)
`hooks/oss-notify.sh:262` and `hooks/oss-session-start.sh:360` build their JSON with `jq -n --arg` (or reject
values that would need escaping). `hooks/oss-fetch-team-iron-laws.sh:96` refuses a TEAM_ID that is not
`^[A-Za-z0-9_-]+$` and makes no request.

### Task 25: team IRON LAWS cache is tied to the API it came from, and a failed fetch backs off (perf 1, perf 2)
`hooks/oss-fetch-team-iron-laws.sh` and `hooks/oss-iron-laws-sync.sh`: the cache records the apiUrl it was
fetched from, and a cache from another apiUrl is never served (not even as the stale fallback). A failed
team fetch writes a backoff stamp, so while the API is down an IRON LAW check does not wait up to 10 s
every time.

### Task 26: flaky and unbounded tests (code-review CR1, perf 5)
- `watcher/test/services/metrics-collector.test.ts:110` asserts on recorded durations without a real
  30 ms timer (fake timers or an injected clock), so it cannot read 29 ms under load.
- `hooks/__tests__/oss-notify-complete-bounds.test.sh:244`: the stub's release wait has a cap, so a killed
  test leaves no process spinning.

### Task 27: esbuild CVE (security D1, GHSA-67mh-4wv8-2f99)
`watcher/package.json`: esbuild `^0.21.5` → a fixed release that also satisfies vite 8 (`^0.27.0 || ^0.28.0`),
lockfile updated, `npm ls esbuild` shows no `invalid`, `npm audit` shows no esbuild advisory, the build and
the full suite pass.

## Phase F: /oss:ship gate round 2 findings (2026-10-30)
Round 2 rules: CRITICAL/HIGH, security findings at LOW or above, secrets and known CVEs block; the rest that
matters goes to FOLLOWUPS. The stop signal did not fire (findings are both about round-1 fixes and original), so
this is a full fix round; round 3 is a gate report only. Same rules as Phase E: RED-first, mutants, sandbox HOME.

### Task 28: bring origin/main's #213 into the tree, version 2.0.96 (code-review CR2, security F9)
origin/main gained e8b1fa8 (#213, decisions log, also "2.0.95") after this branch's merge base. Two different
builds called 2.0.95 defeat the T17/T18 guard (equal versions always copy). Apply #213's changes to the working
tree (no commit inside the gate loop), merge its LEARNINGS.md entries, set `.claude-plugin/plugin.json` to 2.0.96.
The ship commit then rebases cleanly onto origin/main. Full suites must pass with #213's tests included.

### Task 29: no test reaches the configured config or API (security F1 MEDIUM, F2; code-review CR5, CR8)
`hooks/__tests__/oss-api-curl.real.integration.test.sh` and `iron-laws-sync.test.sh` unset `OSS_CONFIG_DIR` and
`OSS_MANIFEST_URL`. New guard test: every `hooks/__tests__/*.test.sh` and `commands/__tests__/*.test.sh` that runs a
hook unsets both (or runs hooks only under `env -i`/`env -u`), so the next new test cannot forget. RED: the
sentinel run (OSS_CONFIG_DIR at a scratch config + local listener) shows requests or a changed result before.
`session-start-notify-payload.test.sh` gets mode 755 like its siblings.

### Task 30: one config reader for key and URL (pen-test 5, security F4, code-review CR1 MEDIUM regression)
`oss_api_url` and every key read (`oss-session-start.sh` grep, `oss-fetch-team-iron-laws.sh`, `fetch-iron-laws.sh`,
`oss_api_key`) read the config through ONE helper that accepts exactly one top-level JSON object: jq with `-s`
(slurp, length 1, type object); without jq, `node -e` JSON.parse (node is a plugin requirement); neither → refuse.
So nested objects (`models`, `webhook`, documented in commands/models.md and webhook.md) work again without jq,
concatenated documents and trailing garbage are refused in both branches, and key and URL always come from the
same object. Remove the grep/sed apiUrl reader added in T21.

### Task 31: the version record's plugin root must be real (pen-test 1, 2; security F3)
A newer record counts only when its root is a directory owned by the user, not a symlink, its
`.claude-plugin/plugin.json` is a regular, user-owned, non-symlink file, and the installed `~/.oss/hooks` copies
are byte-identical to that root's `hooks/` copies (so the record names the plugin the installed hooks really came
from). Otherwise the current plugin copies. A FIFO there is never opened.

### Task 32: files in ~/.oss are read only when regular and written atomically (pen-test 4, 7; security F6)
`~/.oss/team-iron-laws.json(.src)`, `~/.oss/.team-iron-laws-backoff`, `~/.oss/.iron-laws-last-check`: read only when
a regular file and not a symlink (a FIFO is never opened); written via a temp file in the same directory and `mv`,
so a symlink at the path is replaced, not followed.

### Task 33: login (pen-test 6; security F5, F8; code-review CR3, CR4)
`hooks/oss-login.sh` prints `.plan` through `oss_json_field`. `commands/login.md` Step 4.2 fetches the CLAUDE.md
template from the configured API (via the same hook helper), not a hardcoded host; the "Config:" line and the
credentials.enc removal follow `OSS_CONFIG_DIR`.

Deferred to FOLLOWUPS (not blocking): version parser rejects minified/tab plugin.json (pen-test 3); run_bounded
fallback does not kill grandchildren (pen-test 8, CR6); watcher api-credentials refuses loopback even with the
opt-in (CR7); team-laws warm-cache cost +10 ms and one refetch after upgrade (perf 1, 2); oss_api_url twice at
session start (perf 3); worktree config copy permissions window (pen-test 11, security INFO); login does not show
the host the key goes to (security F7, INFO); future-mtime stamps stay fresh (pen-test 9); missing helper under
set -e exits 127 (pen-test 10). Nag: run_bounded job status line in the log (perf 4).

## Phase G: /oss:ship keep-fixing round after the cap (2026-10-30)
Round 3 (report only) left 7 security LOW findings open; the user chose "keep fixing until clean". Same rules as
Phases E-F. After this round: a narrow re-check by the pen-tester and security-auditor plus code-reviewer.

### Task 34: the template hook accepts only a complete, bounded, clean template (pen-test r3 #1 MEDIUM, #2)
`hooks/oss-claude-md-template.sh`: a non-zero curl exit (timeout mid-body) is a failure; `--max-filesize` like
oss-iron-laws-sync.sh; an HTML body is refused like the sync hook does; terminal control codes (C0 except tab/newline,
C1, bidi/zero-width) never reach stdout.

### Task 35: the config is read only when it is a regular file (pen-test r3 #3, security r3 F5)
`oss_config_strings` (and every `-e` config test before it) opens the config only when `[[ -f ]]` holds (a symlink to a
regular file is fine; a FIFO, a device such as /dev/zero, or a directory is refused without opening it). The template
hook and the per-prompt team-laws hook must not hang.

### Task 36: a trusted record root must hold every hook (pen-test r3 #4)
`oss_record_trusted`: every HOOKS_TO_COPY entry must exist in the root and in ~/.oss/hooks and be byte-identical; a
missing one means not trusted.

### Task 37: key and URL from one read at every site (pen-test r3 #5, security r3 F2)
One helper returns the key and the checked URL from a single `oss_config_strings apiKey,apiUrl` read. Route the template
hook, oss-iron-laws-sync.sh, fetch-iron-laws.sh, oss-push-metrics.sh, and (IRON LAW #1b, the known follow-up of the same
class) session start and oss-notify through it. Error messages stay as they are.

### Task 38: login prints exactly one plan line (pen-test r3 #6)
`oss_json_field` (or the login call site) prints one line at most, from one JSON object; U+2028/2029, U+FEFF, U+061C,
U+00AD and the other format characters are stripped along with the existing set.

### Task 39: config path and names are never options to node or jq (security r3 F1)
`oss_config_strings` passes `--` before the path (node: `node -e CODE -- path names`; jq: `--` before the file), so a
path starting with `-` is a path.

### Task 40: /oss:login never puts the key on a command line (security r3 F3)
`hooks/oss-login.sh` hands the key to jq on stdin, not `--arg`; the real-integration test's "key out of every process
command line" check covers jq too.

### Task 41: the T40 test reads permissions GNU-stat first (post-crash baseline, stat-order guard)
`hooks/__tests__/oss-login-key-argv.test.sh:80` runs `stat -f %Lp ... || stat -c %a`, the BSD-first order that
stat-order.test.sh refuses (GNU stat on PATH misreads `-f`). Use the repo's GNU-first form. Test-only change; the
RED is stat-order.test.sh, which fails now.

### Task 42: session-start tests are flaky under load (post-crash baseline, IRON LAW #2)
In a full shell run done while the watcher suite was running, `oss-config-one-object` ("[nojq] session start: a key
in a second document is no key", out='') and `oss-settings-telegram-cleanup` (GNU-stat case, "session start removes
the telegram keys") each failed once. Both passed when run alone (126/126 twice, 15/15). Both cases run session start.
Find the root cause (suspected: a time limit in session start, or a test wait, that cuts the work off under exec load);
fix it, or delete the case. Prove it with a run under load. Customer-facing if the cause is in the hook.

### Task 43: session-start-notify-payload results vary (open item from T29)
The same class as T42, recorded in T29 as "varying results in clean runs". Investigate together with T42.

### Task 44: login's config jq call takes `--` before the path (found in T39)
`hooks/oss-login.sh:25` runs `jq ... "$c"` on `oss_config_file` with no `--`, so a config dir starting with `-` breaks
login (same class as T39). RED first, in the style of oss-config-dash-path.test.sh.

### Task 45: one stripping set for text shown to the user or to Claude (found in T38, IRON LAW #1b)
T38 widened `oss_json_field` to strip `\p{Cf}` and U+2028/2029. Two other places still strip only the old, narrower
set: `stripControl` (packages/cli-decrypt/src/strip-control.ts, whose comment claims it uses the same set as
oss_json_field) and the template hook's filter (hooks/oss-claude-md-template.sh:46). For the template, invisible
tag characters in CLAUDE.md are a hidden-instruction risk. Make the three agree, with a test at each site.

### Task 46: oss_json_field's object-type check is unguarded (T38 mutant survivor)
Removing the "exactly one object" type check survives every test, because jq errors and prints nothing and login
discards the exit code. Either show it with a test that can see the difference, or delete the check as redundant
and say so in DECISIONS.md.

### Task 47: the other OSS_CONFIG_DIR paths take `--` too (found in T44's grep, IRON LAW #1b)
The same class as T39 and T44, still unguarded: `hooks/check-updates.sh` (jq at lines 28, 45, 89, 105, 138, 146;
`mkdir -p` at 52; `chmod 600` at 63, 108, 141, 149), `hooks/oss-changelog.sh` (jq at 32, 65, 108) and
`hooks/oss-worktree-create.sh:28-29` (`cp`, which fails closed). A dash-named config dir breaks them. RED first, with
the GNU-coreutils second pass from oss-login-dash-path.test.sh (chmod `--` is only observable under GNU getopt).

### Task 49: no test can leave orphan processes (the likely cause of the 2026-10-30 Mac crash)
A `perl -e 'alarm N; exec @ARGV'` cap kills the hook's shell but not its children. In oss-config-read-safety a
`jq -s` child kept reading /dev/zero after the cap, growing without bound, and a dozen of them piled up. Two files
were fixed in place. 11 still use the shell-only cap; 3 of them also feed endless input or FIFOs
(iron-laws-sync-safety, session-start-no-hook-downgrade, oss-login-dash-path). The other 8 are config-change-guard,
oss-api-curl, oss-config-dash-hooks, oss-config-dash-path, oss-config-one-object, oss-config-one-read,
session-start-iron-laws and session-start-notify-payload.
1. One helper, `hooks/__tests__/lib/run-capped.sh`. It runs the command in its own process group. On the cap it kills
   the whole group. After every run it checks that no member of the group survived; if one did, it kills it and the
   test fails.
2. Route all 13 capped files through it, including the 2 with a hand-made group kill, so there is one implementation.
3. A guard test: any test file that writes its own `alarm`, `timeout` or `gtimeout` cap around a hook fails (RED: it
   names the 13 files).
4. A test of the helper itself: endless input plus a child that ignores SIGTERM; nothing outlives the cap; a mutant
   that drops the group kill is caught.

## Phase H: narrow re-check after round 3 (2026-10-31; user chose "keep fixing until clean")

Pen-test, security-auditor and code-reviewer re-checked T34-T49. Round-3 findings are closed, except that pen-test r3 #4
reopened in a new form (T50). Every task below is RED first and gets a mutation check in a private copy.

### Task 50: a record root whose hooks folder is a symlink is not trusted (pen-test re-check N1, LOW security)
`oss_record_trusted` (hooks/oss-session-start.sh:119) checks `-L` only on each hook file. A planted root with
`hooks -> ~/.oss/hooks` compares every installed hook with itself, so it is trusted and the re-copy is skipped. `$r/hooks`
and `$r/.claude-plugin` must be real directories, not symlinks. Record in DECISIONS.md that byte-identity cannot prove
where the hooks came from when the attacker can already write ~/.oss (same-user limit).

### Task 51: /oss:login saves the key with the URL it was checked against (pen-test re-check N2, LOW security)
hooks/oss-login.sh validates the key against `oss_api_url` (read 1, :17) and then saves it into whatever apiUrl the file
holds at read 2 (:27). Use one value for both: the saved config's apiUrl is the URL the key was validated against. Same
class as T37 (IRON LAW #1b: login was the site T37 did not route).

### Task 52: the strip set also removes variation selectors and invisible fillers (pen-test re-check N3, LOW security)
Add U+FE00-FE0F, U+E0100-E01EF, U+034F, U+115F, U+1160, U+3164, U+FFA0 and U+2800 at all three sites (OSS_JQ_INVISIBLE in
oss-api-curl.sh, the template filter, packages/cli-decrypt/src/strip-control.ts), with a test at each site.

### Task 53: check-updates never writes its state through a FIFO or symlink (security re-check, LOW security)
hooks/check-updates.sh:54 (and the writes at :108, :141, :149) does `cat > "$STATE_FILE"` with no type check; a FIFO there
blocks until oss-notify's 3 s cap. Write through the existing regular-file/atomic helpers (as T32 did for other state).

### Task 54: session start's no-timeout fallback kills the whole health-check group (code-review re-check, LOW)
`run_bounded`'s fallback branch (no timeout/gtimeout; hooks/oss-session-start.sh:357 caller) `kill -9`s only node, so the
health check's children outlive the bound: the same orphan pattern as T49, in customer-facing code. Kill the group; a
test with OSS_RUN_HEALTH_CHECK=1, a hanging check that forks a child, and timeout/gtimeout hidden from PATH.

### Task 54b: oss-notify.sh's no-timeout fallback kills the whole group too (T54 finding; user 2026-11-02 "Fix now as T54b")
hooks/oss-notify.sh run_with_timeout (:24-40) has the same leader-only `kill -9 $pid` fallback, including the 30 s
chain-trigger call that runs at the end of every /oss command. Apply T54's fix (own process group for the launch, kill
the group, restore the flags); keep its `|| true` semantics and stderr. Tests extend the closest oss-notify timeout test,
or mirror session-start-timeout-fallback: hidden timeout and gtimeout, a hanging command that forks a child, the child
gone, the caller surviving, exit/stdout passthrough. Same mutations as T54.

### Task 54c: the bound's timer can never miss its sleep (T54b finding; user 2026-11-03 "Fix now as T54c")
In both fallbacks (oss-session-start.sh run_bounded, oss-notify.sh run_with_timeout) the timer subshell is
`( trap 'kill $s; exit 0' TERM; sleep N & s=$!; wait $s && kill ... )`. A TERM arriving between `sleep &` and `s=$!`
kills an empty $s, so the sleep lingers until the bound (up to 30 s for chain-trigger). Make cancelling the timer always
take its sleep with it, with no window. Remove T54's 0.2 s workaround from the fast test rows and prove 0 lingering
sleeps over many (≥200) instant calls per hook, event-driven, under run_capped. Behaviour otherwise unchanged; mutation:
restore the window.

### Task 55: the hand-cap guard's allowlist matches the exact line (code-review re-check, LOW, vacuous test)
hooks/__tests__/no-hand-capped-tests.test.sh:49 matches the allowlist as a substring, so a cap added to an allowed line
passes; `CAP_RE` misses `timeout "$secs" ...`. Exact-line match and the quoted-argument form, with anchors.

### Task 56: remove the unwired session-start copies (security re-check, LOW security, IRON LAW #1b)
hooks/oss-session-start-new.sh and hooks/oss-session-start-test.sh grep-parse apiKey and send it to a hard-coded production
URL. Nothing references them. Delete both; a guard test that no hook file reads apiKey with grep.

### Task 57: no /oss command prints the API key into the chat (security re-check, security; user chose "fix now")
Step 1 of 57 of the 68 commands/*.md files runs `cat ~/.oss/config.json 2>/dev/null | grep apiKey`, which prints the
config line, key included, into the customer's transcript on every command. commands/visual-test.md already has the
quiet check (`grep -q '"apiKey"' "$HOME/.oss/config.json" && echo "API key configured"`, guarded by
commands/__tests__/visual-test-auth.test.sh, G10). RED: one guard test over every commands/*.md (and any other prompt
file the plugin ships) that names each file with a key-printing check. GREEN: the same quiet line in each.
Provenance grep (2026-11-02): the identical line is in 152 shipped files: 57 commands/*.md, 44 agents/*.md, 51
skills/*.md. All are in scope.

### Task 58: no prompt asks Claude to put the API key in a request header (T57 knock-on; user chose "fix now")
103 agent and skill files (and commands/workflows.md) have a Step 2 that WebFetches the expert prompt with
`Authorization: Bearer {apiKey}`. After T57, Claude no longer sees the key, so the step fails, or Claude reads
config.json to get it (and leaks it). First confirm in AgenticDevWorkflow that the encrypted endpoint serves each of
these agent and skill names. RED: a guard test that no shipped prompt contains `Bearer {apiKey}` (or any instruction
to put the key in a header or URL). GREEN: Step 2 becomes `~/.oss/bin/oss-decrypt --type agents|skills --name <x>`,
matching the 3 files that already do this. Names the API does not serve are reported, not guessed.

### Task 60: no new approval prompts; workflow config display works (T58 follow-up a+b; user chose "fix now")
T58 made /oss:status and /oss:workflows run a Bash block (source oss-api-curl.sh; oss_api_creds; oss_api_curl) that is not
on the allowlist (hooks/oss-setup-permissions.sh), and skills/ideate.md calls ~/.oss/hooks/oss-claude-md-template.sh, which
is not allowlisted either. Customers would see new approval prompts. Move each call to an allowlisted entry point:
oss-value.sh subcommands (already allowlisted; keeps R5-1, where a value hand-off is one allowlisted call reading a value
file), or allowlist the template hook if that is safe, and say why. `/oss:workflows <name>` gets encrypted config from
/api/v1/workflows/:name; switch it to /api/v1/workflows/:name/editor (plain config) after confirming the route and its
auth in AgenticDevWorkflow origin/main. RED: a test that every bash block a shipped prompt runs matches the allowlist.

### Task 61: prompts promise only what the step delivers (T58 follow-up c+d)
visionos-developer (agent and skill) still claims RAG snippets that oss-decrypt cannot request. /oss:status shows "Usage
This Month", but /auth/verify returns no usage. Correct the text, or fetch from a real endpoint if one exists (check the
API).

### Task 62: the watcher never builds a prompt that puts the key in a header (T58 follow-up e)
watcher/src/monitors/iron-law-log-parser.ts:111 builds `curl -s -H "Authorization: Bearer {apiKey}" .../shared/iron-laws`.
Point it at the allowlisted ~/.oss/hooks/fetch-iron-laws.sh. Vitest RED first, run with the no-setup config (never the
setup.ts that pkills).

### Task 63: a failed prompt fetch never breaks an agent or skill (rate limits; user 2026-11-02)
The trial tier (5 per minute, 30 per hour) and the per-IP global limiter can refuse an `oss-decrypt` fetch with a 429. The
99 migrated agent and skill Step 2s must say: if the fetch fails for any reason (429, network, not logged in), carry on with
this file's own instructions, which is today's behaviour, and never read config.json or retry in a loop. Check what
oss-decrypt prints and its exit status on a 429 (packages/cli-decrypt api-client.ts) so the wording matches. RED: the
guard test requires the fallback sentence next to every `oss-decrypt --type agents|skills|workflows` line in agents/ and
skills/. Live check against a local stub that returns 429: the CLI exits non-zero, prints no key, and the step text
covers it.
Constraints (dev-15, 2026-11-02): (1) "local instructions" means the public agent/skill .md text already in the plugin,
NEVER a cached or saved copy of a served prompt; prompts must not be stored on the user's machine (IP protection). The
guard also fails on any step that writes oss-decrypt output to a file. (2) The global limiter's 429
(rate-limit.ts:32, express-rate-limit 7.5.1, draft-6) has a plain-text body "Too many requests from this IP, please try
again later.", RateLimit-* headers and Retry-After; there is no JSON. The stub must serve exactly that shape, and the wording
must key off the failure, not a parsed body (e.g. "rate limited: carry on with this file's instructions"). T59's trial
run confirms Retry-After live.

### Task 64: the new oss-value verbs work for every customer (T60 risks)
(a) `status`, `workflows` and `workflow` need jq, but session start treats jq as optional, so a machine without jq gets an
error. Fall back to node the way oss_config_strings does (oss-api-curl.sh). Test with jq hidden from PATH.
(b) When a plugin update happens mid-session, ~/.oss/hooks/oss-value.sh is still the old copy until the next session
start, so the new verbs give a usage error. The prompt (or the old copy) must degrade to a clear message that says to
restart the session, never a raw usage error. Find out how plugin updates refresh ~/.oss/hooks.

### Task 65: oss-config-one-object never reports a survivor under load (zero-flake rule)
It failed once with rc=125 (run_capped found a member of the process group still alive) while other tests ran in
parallel, and passed 126/126 alone. Find the root cause: a real leak in the hook, or the run_capped settle wait under
load. Fix it, prove the fix under load, or delete the case.

### Task 66: signatures and tamper checks still pass (user 2026-11-02: "we will have to resign everything")
Inventory (2026-11-02):
(1) Server prompts: an Ed25519-signed manifest (AgenticDevWorkflow packages/api/src/prompts/prompt-manifest.json) that
oss-decrypt checks (packages/cli-decrypt/src/manifest-verifier.ts, prompt-integrity.ts). It covers 54 agents, 59 commands
and 15 skills. A name missing from the manifest returns `not_in_manifest`, and that still counts as valid.
(2) Pinned binaries: hooks/oss-decrypt-checksums.txt (cli-decrypt-v1.2.4) and hooks/oss-launch-checksums.txt, which
ensure-decrypt-cli.sh and ensure-oss-launch.sh check.
(3) Plugin hooks and prompt .md files carry no signature: they come through the plugin marketplace, and session start
trusts the install record by byte identity (T36/T50).
Gate:
(a) In T59 item 1, every fetch must show "Manifest signature: valid" and status `match`. A `not_in_manifest` result means
no hash protects that prompt: report it and get it added and signed on the API side.
(b) If T59 item 5 changes any server prompt, regenerate and re-sign the manifest in AgenticDevWorkflow with its own
signing script, coordinated with that repo's session, and deploy before this plugin merges.
(c) If the user chooses the cli-decrypt release (T45 stripping), do the new tag, the checksums in
oss-decrypt-checksums.txt, OSS_DECRYPT_TAG and the rebuilt dist, all in one reviewed change.
(d) Grep for any other committed hash or allowlist that covers a file this branch changed (for example the settings
allowlist from T60, or tamper floors), and update and verify it.

### Task 67: #214's ~/.oss reads cannot hang a picker answer (user 2026-11-02: "Fix now as T67", LOW security)
Found while merging #214 (91c808e): `oss_decisions_push_off` (hooks/oss-api-curl.sh, runs on every picker answer) and
`oss-decisions-policy.sh status` read files under ~/.oss with no regular-file check, so a FIFO in place of one hangs the
hook. FAIL CLOSED (dev-15, #214 task 16al): anything at ~/.oss/decisions-push-off (file, symlink, FIFO, dir,
unreadable) means OFF, so a guard must never turn "not a regular file" into "on" (privacy regression).
RED: FIFO-at-marker cases (push_off and policy `status`) expect OFF / "off for you" with no hang (run_capped); a
FIFO where a file's CONTENT is read (settings.json decisionsPush fallback) expects the fail-closed answer (off, or
"unknown" for status) with no hang. GREEN: (1) the marker is checked by existence only, `[[ -e m || -L m ]]` → off, never
opened; (2) `[[ -f ]] && [[ ! -L ]]` only before content reads, and a failed guard gives the fail-closed answer. #214's
16al "anything at the marker reads off" cases must stay green. Mutation: dropping each check, and turning a failed guard
into "on", must each fail a test.

### Task 68: `decisions status` says why a linked settings.json reads off (dev-15, after T67)
Dotfiles managers (stow, chezmoi, yadm) symlink ~/.oss/settings.json. Since T67 that reads off, and status says only
"could not be read". RED: a test asserts that a symlinked settings.json gives a status line naming the link (e.g. "…
~/.oss/settings.json is a link, not a file") and that a FIFO or an invalid file keeps the existing could-not-be-read
wording. GREEN: minimal; the on/off answer does not change (fail closed). Mutation: the reason dropped or swapped must
fail.

### Task 69: /oss:status shows real monthly usage (user 2026-11-02: "Wire in real usage")
T61 removed the "Usage This Month" section because /auth/verify has no usage. The real route is GET
/api/v1/analytics/usage (AgenticDevWorkflow origin/main packages/api/src/routes/analytics.ts:173, requireAuth, default
period=month; returns totalCommands, commandsByType, currentPeriod, periodStart). RED: oss-value-api.test.sh cases for a
new `usage` verb against the fake API: the key goes on curl stdin, never in argv or output; it prints the total and the
per-type counts; a 401/5xx/garbage reply prints one honest "usage unavailable" line and status still works. Update
prompt-promises.test.sh's field list to this route's fields. GREEN: the verb through `_ov_api`, and status.md shows the
section. Allowlist: the existing oss-value.sh rule covers it. Mutation: key in argv, and a missing fallback, must fail.
T59 item 1 checks it live.

### Task 53b: the shared safe-write and two symlinked reads (T53 findings, LOW; user 2026-11-02: "Fix all 3 now")
(1) oss_write_atomic (oss-api-curl.sh:140-147, 11 callers): `mktemp -- "$1.XXXXXX"` and `rm -f -- ...`, so a relative
dash path (e.g. OSS_CONFIG_DIR=-cfg) saves; then drop T53's one-off `./` workaround in check-updates.sh if the helper
covers it. (2) oss-changelog.sh:31,33,66,109 reads update-state.json behind a plain -f: use oss_is_regular (link or FIFO →
treated as missing). (3) check-updates.sh:35 reads settings.json behind -f: same. RED per site, mutation per guard;
oss-config-dash-hooks, check-updates and changelog tests stay green.

### Task 52b: the display filter uses the shared invisible list (user 2026-11-02: "Widen it in this PR")
The final shared list agreed with the API (dev-15, user-approved) for cleanText/UNSAFE_CHARS is
`[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\p{Default_Ignorable_Code_Point}⠀]` (TAB/LF kept). The display filter
(OSS_JQ_INVISIBLE, oss-api-curl.sh; node copy _OV_JS_PRE, oss-value.sh) adopts the same set (its C0 part stays as each
site has it), escapes only, no literal invisible characters. RED: U+17B4, U+180B, U+2065, U+FFF0, U+E0000, U+E0FFF
stripped at each site (jq and node identical). Compatibility: if the installed jq rejects \p{Default_Ignorable_Code_Point}
(older Oniguruma), the filter must fall back to the T52 list, never error (test with a jq shim that rejects the property).
Mutations: drop the DI property; drop the fallback.
Surrogate rejoin (dev-15 round 2, 2026-11-02): a u-flag strip that deletes a character between a lone high half and a lone low
half joins them into an astral invisible (e.g. "\uDB40​\uDC20" → U+E0020). The node path (_OV_JS_PRE) must first turn
lone halves into U+FFFD with a no-u regex, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, and
only then strip. The jq path already turns lone halves into FFFD when it parses: prove that with the same fixture. Mutation: do
the step after the strip, or drop it.

### Task 59: RELEASE GATE: customers keep a working plugin/API combination (user, 2026-11-02: "we NEED to make SURE")
No PR merges until each of these is proven by a run, not argued:
1. For every prompt file changed by T57/T58, run the exact fetch command the new file tells Claude to run, read-only,
   against the DEPLOYED API. It must return a valid signed prompt. Any failure blocks the merge: fix the mapping or have
   the API serve the name. Never ship a step that fails. (Uses the user's real key, about 100 calls: ask first.)
2. The same check against the other session's new API (it merges and deploys first). The plugin must work with BOTH
   the current and the new API.
3. Clean-machine smoke run with this branch installed and a fresh ~/.oss (sandbox HOME): login, session start,
   /oss:build, /oss:ship, one agent.
4. No API key in any output, transcript or log from those runs (scan for the key's value).
5. First-delivery review (user heads-up 2026-11-02): T58 makes about 99 server-side agent and skill prompts reach customers
   for the first time, so agent behaviour changes on merge. Decrypt each one (same run as item 1) and review its content
   before merge. Check that it does not tell Claude to print the key, use `Bearer {apiKey}`, or call a dead route. Check
   that it does not contradict the plugin's local agent file (Step 2.5 offload, the model-routing check). Check that it is
   not stale (wrong commands, removed features). Check how long it is, since it is added to every agent call. Fix
   problems at the source (AgenticDevWorkflow prompts, coordinated with that repo's session) or hold the migration for
   that name.

Deferred to FOLLOWUPS (re-check, not blocking or outside this change): cli-decrypt config.ts FIFO read and default-URL
fallback (security); watcher api-credentials.ts no regular-file check and different URL rules (security); stale tracked cli-decrypt
bundle needs a release (security, user decision); `--rawfile` needs jq >= 1.6; teamId non-string loses the key (already
deferred as CR r3 #2).

Deferred to FOLLOWUPS (not blocking): jq/node parity on BOM, NaN and deep nesting (fail closed both ways); teamId
non-string disables the team fetch (CR r3 #2); "No API key found" shown for an invalid config (CR r3 #4); login.md:249
path text; login.md Step 3 CREDS fallback when the helper is missing (pen-test r3 #7); TOCTOU windows in oss_is_regular
and oss_write_atomic (same-user, INFO); oss_record_trusted cmp cost (perf INFO); agents/*.md key handling (pre-existing).

---

## Implementation Sequence
1. **Phase A (T1 → T2 → T3 → T4).** Production fixes first, since they are customer-facing. T2 depends on the stub patterns of T1. T4 depends on T1–T3 being done, so the sweep sees the fixed state.
2. **T5 before everything in Phase C.** After T5 the real config is safe, and Phase C tests run under the sandboxed HOME.
3. **T6 right after T5.** The suite must be green before the per-file work.
4. **T7 before T8, T9, T13 and T14** (they use the helpers). T10, T11 and T12 do not depend on T7.
5. **T15, then T16.**

## Testing Strategy
- **Unit or behavior (vitest):** T1, T2, T3, T5, T7, T8–T12.
- **Shell tests:** T4 (some sites), T7, T13, T14.
- **Integration:** T5 runs a real child vitest with the real config. T14 is a real curl against a local recorder.
- **Edge cases:**
  - A hook whose background job is still running when the caller's pipes close.
  - A hung state CLI.
  - Another session's pointer.
  - A machine under exec load.

## Security Checklist
- [ ] No test can read the real apiKey (sandbox HOME): T5, T10, T11.
- [ ] No test can send to production (stub curl, no apiKey).
- [ ] The analytics POST still sends the key through `oss_api_curl` (stdin, not argv), and T14 still guards that.
- [ ] Detaching does not drop error handling the hook relied on (the analytics call was already `|| true` and silent).

## Performance Considerations
- [ ] Session start and workflow start no longer block on the network or on the 11 s sleep.
- [ ] Warm-up adds about 0.5 s per test file, once, and saves unbounded stalls inside tests.

## Rollout Strategy
- [ ] Feature flag: none. The changes are redirects and time limits on calls that were already best-effort.
- [ ] Rollout: plugin 2.0.95 through the normal update.
- [ ] Rollback: revert the PR. No data or migration is involved.

## Estimated Tasks: 16 (T6 expands to one cycle per file found)
## Estimated Test Cases: ~35

## Last Updated: 2026-10-28 by /oss:plan (orchestrator)

---

## Phase I: ship re-check after Phase H (2026-11-03). User: fix everything before release.
Reports: scratchpad/recheck-{security,codereview,pentest}.md.

### Task 70: decision push follows a linked settings.json (code-review M1; user: "Follow the link")
oss_decisions_push_off (oss-api-curl.sh ~:215) treats a symlinked settings.json as OFF since T67/T68. User decision:
follow a link to a regular file, as 2.0.96 did and as check-updates does (T53b). A FIFO, a dangling link, a folder, or
a link to a non-regular file (FIFO, /dev/zero) stays OFF with its reason; never hang. Remove the T68 "is a link" reason
text and its tests' expectation for the link case (keep the dangling-link row → off). Tell dev-15 (#214 owner).

### Task 71: agent offload cannot be steered by a repo (pen-test, HIGH, pre-existing; user: "Fix in this release")
watcher/src/cli/agent-model-check.ts:182-200 lets the repo's .oss/config.json pick the offload model; agent-offload.ts:80
runs `claude -p --dangerously-skip-permissions` in that repo. Fix: only user-level settings (~/.oss, via the existing
precedence minus project config) may enable offload / choose its model; the nested session must not skip permissions
(use a restricted, non-interactive permission mode or allowed-tool list that the CLI supports; verify with its --help, no
network). Step 2.5 in the 13 agents: gate only on Step 0's result, never read ~/.oss/config.json; the prompt goes to a
private 0600 file in a private dir (or stdin) and is deleted on every path. Tests: a hostile project config cannot
enable or route offload; no --dangerously-skip-permissions in argv; Step 2.5 text guards (no config.json, no /tmp, rm).
If removing the flag makes offload unusable, STOP and report (feature change = user's call).

### Task 72: one supervisor owns each time limit (security S1 MEDIUM, S2 LOW, pen-test L1 LOW)
In oss-session-start.sh run_bounded and oss-notify.sh run_with_timeout fallbacks, a timer in its own group outlives a
killed hook and may later SIGKILL a reused group id. Replace the timer with one supervisor that waits for the command
and kills its group itself only while the group is known alive (e.g. perl: fork, setpgrp, waitpid with alarm, kill
-KILL -pgid before reaping; the leader is never reaped before the group kill, so the id can't be reused), and dies with
the hook (no orphan timer). Hook killed by group/HUP/TERM → the bounded command's group is killed too. Keep exit codes,
stdout/stderr, stdin /dev/null, bash 3.2, no added startup time. Rework T54/T54b/T54c tests; add "kill the hook's group
mid-bound → nothing survives and nothing is signalled later".

### Task 73: commands' prompt fetch has a failure rule (pen-test M1 MEDIUM)
The 57 commands/*.md that run oss-decrypt get the same kind of rule as T63, command-shaped: on any failure tell the user
in one line (e.g. rate limited / offline / not logged in) and STOP; do not read ~/.oss/config.json, do not retry in a
loop, do not save the fetched prompt. Extend fetch-fallback.test.sh to commands/.

### Task 74: hook hardening (pen-test L2, L3; security S3, S4, S5)
(a) oss-changelog.sh:73-97 and check-updates.sh:99-101: manifest keys go to jq via --arg, are read with read -r, and are
stripped of control/invisible characters before printing. (b) OSS_JQ_INVISIBLE / _OV_JS_PRE old-jq fallback list also
covers U+17B4-17B5, U+180B-180D, U+180F, U+2065, U+FFF0-FFF8, U+E01F0-E0FFF. (c) workflow names: reject `.`/`..` (use
oss_valid_workflow_name). (d) _ov_api caps the body it reads (head -c). (e) the prompt files' apiKey presence check
must not hang on a FIFO and must treat an empty/null key as not configured.

### Task 74b: cap every network body a hook reads (T74 finding; user "Fix now as T74b")
These hooks read a network body bounded only by --max-time: check-updates.sh:91, oss-changelog.sh:65 (the unauthenticated
manifest), fetch-iron-laws.sh:69, oss-fetch-team-iron-laws.sh:115, oss-login.sh:20, oss-push-metrics.sh:91,
oss-session-start.sh:247. Each must stop reading at the same 262144-byte cap T74 used (curl --max-filesize plus head -c,
so a body with no Content-Length or a stream is also cut) and treat an over-cap body as a failure (no partial parse, no
partial file written, same user-visible behaviour as the existing failure path). RED-first per hook with a test server
that streams far past the cap; mutants per hook. Sweep for any other curl/wget body read in hooks/ and report it.

### Task 74c: bound every remaining download (T74b sweep; user "Fix all now as T74c")
(a) ensure-oss-launch.sh:56,61 (binary + .sha256): total --max-time, --max-filesize and a byte stop on the binary (a
binary-sized limit with room to grow: oss-decrypt today is ~60 MB, so e.g. 256 MB; the .sha256 gets a small cap), and a
hang-proof connect/total time. (b) ensure-decrypt-cli.sh:190,207: add a total --max-time (keep the speed limit) and the
same binary size limit. (c) commands/login.md:275 icon download: time limit and a small size cap (keep it allowlisted /
update the allowlist test consistently). (d) oss-decision-record.sh:254,286 and oss-decisions-policy.sh:72: size cap the
-o file so jq never reads more than the cap. (e) oss-iron-laws-sync.sh:120: add the byte stop (head -c / oss_capped) so an
old curl cannot write past the cap. (f) oss-notify.sh:284: cap the discarded body. Over any limit: the existing failure
path (no partial binary installed, no partial file kept, same message). RED-first per item, mutants per item, reuse
hooks/__tests__/body-cap.test.sh's server/shim. Binary downloads keep their checksum verification unchanged.

### Task 75: messages and tests (code-review L1, L2, INFO)
(a) The stale-hooks restart rule matches zsh's "no such file or directory" (any case) too; add a zsh row.
(b) fetch-fallback.test.sh verifies the decrypt binary's hash against hooks/oss-decrypt-checksums.txt before using it.
(c) check-updates.sh:17-18 stale chmod comment; FOLLOWUPS:146 stale entry (now covered by #215).

### Task 71b: oss-launch cannot be steered by a repo + docs (T71 finding; user 2026-11-03 "Fix oss-launch now")
oss-launch.ts loadMergedConfig lets a project .oss/config.json switch proxy routing on (models.agents) and choose
proxyPort, so a repo picks the 127.0.0.1 port the launched session (with real credentials) talks to. Same rule as T71:
only ~/.oss (and the existing env override) may enable routing or set the port. Docs (user: "User config only + fix
docs"): commands/models.md and the repo CLAUDE.md say agent/launch routing uses ~/.oss only; a release note line for
customers who had per-repo mappings. Tests RED first; mutation: re-allow project config.

### Task 70b: /oss:settings decisions off/on work through a linked settings.json (T70 finding; user "Fix now as T70b")
oss_settings_update / oss_settings_mergeable refuse a linked settings.json (#214 16u), so `decisions off` says "could
not be updated" (exit 1) and `decisions on` can't clear the marker. With a link that resolves to a regular file, update
the RESOLVED target atomically (temp file in the target's directory + mv; keep the link and the target's mode), and
report success; `on` clears the marker. A FIFO, a dangling link, a folder, a link to a non-regular file, or a link
loop is still refused with a clear message, never a hang. Tell dev-15.

### Task 71c: the oss-launch binary carries T71b (user 2026-11-03 "New binary in this release")
At ship time (after the PR's gates, before the release): ask the user, then push tag oss-launch-v2.0.97 so
.github/workflows/build-oss-launch.yml builds the binaries from current src; verify each artifact (its .sha256, a
sandboxed `--version`/dry-run, and that a hostile project config cannot route); then pin the new checksums in
hooks/oss-launch-checksums.txt and the tag in hooks/ensure-oss-launch.sh (OSS_LAUNCH_TAG). Part of T66.

### Task 71d: docs recommend auto mode, not skipping permissions (user 2026-11-03 "Recommend auto mode")
commands/auto.md "Zero-approval mode" and DRAIN_SH_INTEGRATION.md: recommend `claude --permission-mode auto`; mention
--dangerously-skip-permissions only as "sandboxed machines with no internet access only". grep the repo (commands/,
skills/, agents/, docs, README) for any other customer-facing advice to skip permissions and fix it the same way. A
guard test: no customer-facing file recommends --dangerously-skip-permissions without the sandbox-only caveat.

### Task 70c: every settings.json writer follows a link; written-through files become 600 (T70b finding; user 2026-11-03 "Follow the link everywhere", "Make it owner-only (600)")
Writers that refuse a linked ~/.oss/settings.json today: oss_settings_update callers (commands/login.md step 9,
commands/settings.md save block, hooks/oss-settings-cleanup.sh) and the watcher's TypeScript save()
(watcher/src/services/settings.ts). They write to the link's resolved target the same way as T70b (oss_settings_target:
up to 8 links, temp file in the target's folder, rename onto the target, the link stays a link; dangling link, loop,
folder, FIFO or device refused with the T70b reasons). The mergeable checks (owned by the user, regular file, one JSON
object) still run on the target. Whenever OSS writes through a link (T70b's off/on included), the target ends up 600,
like a plain settings.json. oss_write_atomic stays unchanged. Tests: each writer through a two-hop link (content,
inode changes, links remain, mode 600, no temp left) and each refusal reason; T70b's "mode kept 640" row becomes 600.

### Task 70d: the watcher never hangs on a non-plain settings.json (T70c finding, pre-existing; user 2026-11-03 "Fix now as T70d")
watcher/src/services/settings.ts loaders and watcher/src/services/notification.ts loadSettings use existsSync then
readFileSync: a FIFO at ~/.oss/settings.json (or a link to one) hangs the watcher at startup. Every watcher read of
settings.json resolves the link like settingsTarget (T70c) and reads only a regular file; anything else (FIFO, device,
folder, dangling link, loop) → defaults, no hang, no throw. Tests: FIFO, link to FIFO, folder, dangling link, loop, each
under a hard time limit; a linked regular file is still read. Rebuild dist (watcher-dist-fresh).

### Task 75d: fix the flaky watcher test oss-log-health-check (T70c finding)
test/hooks/oss-log-health-check.test.ts "should write health check output to log file" hit its 5 s timeout under load
(about 10). Iron Law #2: find the root cause and make it event-driven or give it a generous bound; never a retry.

### Task 70e: watcher reads of user files are hang-safe and owner-checked (T70d findings; user 2026-11-03 "Close it now", "Refuse, use defaults", "Audit and fix now")
1. settings.json reads (readSettingsFile) and the T70c save path (readForMerge): open with O_NONBLOCK (no follow is
   not needed: the target is already resolved), fstat the open fd, read only a regular file; close the swap race.
2. The loaders refuse a settings.json (resolved target) not owned by the current user → defaults, like the hooks.
3. Audit every readFileSync / readFile / createReadStream / existsSync+read in watcher/src on a user-writable path
   (~/.oss, the project's .oss, ~/.claude, tmp): list each with its path and risk. Each one reads only a regular
   file through a shared hang-safe reader (O_NONBLOCK + fstat isFile), and a FIFO / device / folder is handled as
   "missing" by that caller. Tests per caller group with a FIFO under a hard time limit. Rebuild dist.

### Task 75e: watcher test files type-check (T70e finding)
Pre-existing TS2345 errors in watcher tests (logging-integration.test.ts:68,147, healthcheck.test.ts:60: mockExec vs
execAsync signature; the offload acceptance test's mock typing). tsc -p . covers src only. Fix the test types (no
`any`) and add a test-typecheck step (e.g. a tsconfig for test/ run by a shell test or npm script) so it stays clean.

### Task 71e: migrate the oss-launch release build before tagging (FOLLOWUPS 2026-10-23 HIGH; user 2026-11-03 "Migrate the build first")
.github/workflows/build-oss-launch.yml still installs pkg@5.8.1 (GHSA-22r3-9w55-cj54, unmaintained) with node18 targets
and a deprecated softprops/action-gh-release v1. Mirror release-cli-decrypt.yml: @yao-pkg/pkg pinned from a lockfile,
node22 targets (macOS arm64 on a native arm64 runner, x64, linux x64/arm64), current pinned release action, least
permissions. A static test guards it (no pkg@5, no node18, actions pinned). T71c then tags with this build; verify the
binaries (run each: --help, the T71b user-config-only behaviour) before pinning hooks/oss-launch-checksums.txt.

## Phase J: ship re-check after Phase I (2026-11-04). Findings: scratchpad recheck2-{pentest,security,codereview}.md.
User picks: offload "Restrict + deny .oss"; the rest "Fix all now as Phase J"; duplication "Dedupe now with a match test".
T72 cost (CR L3, ~8 ms per bounded call without timeout) was already accepted by the user on 2026-11-03 ("Accept the cost").

### Task 76: offload nested session is confined (security N1 MEDIUM, N2 LOW; pen-test INFO)
watcher/src/cli/agent-offload.ts: replace `--setting-sources user` with `--restricted`, and deny `Read(./.oss/**)` and
`Edit(./.oss/**)` in the nested session (Write deny rules are ignored by the CLI). A user allow rule for Read must no
longer let it read outside the repo or the worktree's .oss/config.json copy. A CLI without --restricted (non-zero exit)
→ native fallback, as today. Use 127.0.0.1 like oss-launch (security N6). Tests RED first; mutants: drop --restricted,
drop each deny rule. Rebuild dist.

### Task 77: oss_capped never passes a partial body or a status trailer (pen-test L1, code-review L2, INFO)
hooks/oss-api-curl.sh oss_capped: on rc 63 (curl stopped at --max-filesize, with or without Content-Length) print
nothing. oss-login.sh checks oss_capped's status (an oversized answer never saves the key). Fix the decision-record /
decisions-policy comments. fetch-iron-laws: an over-cap body gets its own message, not "Could not reach OSS API".
Tests with the real curl: no-Content-Length stream stopped by curl at the cap, and a Content-Length over the cap.

### Task 77b: /oss:login names a network failure (user 2026-11-04 "Separate network message")
hooks/oss-login.sh: a failed check that is not a real 401/403 (offline, timeout, body cut short, oversized answer, any
oss_capped failure) prints "Couldn't verify the key (network problem). Check your connection and run /oss:login again."
and does not save the key; a real 401/403 still says "Invalid API key". Tests per case; mutants.

### Task 78: prompt fixes (code-review M1, L1, L5; security N5, N8)
(a) commands/trust.md `--verify-manifest`: its own rule. JSON with signatureValid → the display rules (an INVALID
signature keeps its tamper warning); `error: "Failed to fetch manifest"` → one line (offline / API unavailable).
(b) commands/settings.md save block: when the hook helpers are missing (stale hooks after an update), print the restart
message, never "not valid JSON ... Fix or remove it" (zsh row). (c) commands/login.md icon download: --proto '=https'
--proto-redir '=https' and a byte stop. (d) commands/models.md never prints models.apiKeys values. (e) agent Step 2.5
(13 agents): create only the 700 folder; the Write tool creates prompt.md. Tests per part.

### Task 79: manifest diff in one jq pass (pen-test L2)
hooks/oss-changelog.sh and hooks/check-updates.sh: one jq run over the manifest and the cached hashes (--argjson), same
output and the same display stripping; a 256 KB manifest finishes in about a second; a key with a newline is one entry.

### Task 80: watcher reads and saves (security N4, code-review INFO)
log-reader.ts:106 stats before it opens (the regular-file reader's rule). models.ts saveConfig: a FIFO or non-regular
config.json is refused (no hang); an invalid config.json is never overwritten in a way that loses apiKey. Make the
"LogReader tail (a folder appears)" test actually assert under load. Rebuild dist.

### Task 81: dedupe (code-review L4, INFO; user "Dedupe now with a match test")
One copy of the perl supervisor (shared file or a test that the two copies are identical), every body cap through
oss_capped (one slack rule), one ask() helper, and no test-only env var (OSS_TEST_BOUND_TRACE) read by shipped code
(prove the post-reap rule another way). Behaviour unchanged: the existing suites stay green.

### Task 82: a slow first install of the decrypt CLI finishes (user 2026-11-04 "Resume + longer step")
The install step runs as a Bash tool call (163 prompts), which Claude Code stops at 2 min by default; a ~60 MB binary
below ~500 KB/s never installs and each retry starts over. hooks/ensure-decrypt-cli.sh: keep the partial download in a
private (700, owner-checked, regular-file) folder under ~/.oss and resume it on the next run (curl -C -, same caps and
time limits); stop itself before ~110 s with a clear "still downloading, run the command again" line and a distinct
exit, never a half-installed binary; the checksum is verified on the complete file before install, and a partial that
fails it is deleted. The prompts' install step asks for a 10-minute Bash timeout. Also hooks/ensure-oss-launch.sh's downloads get --proto '=https' --proto-redir '=https' (security N5; T78 leftover). Upgrades over a working binary keep
today's behaviour. Tests: a throttled local server, a run cut at the self-limit then resumed to a verified install; a
tampered partial; a link/FIFO/foreign-owned partial refused; the prompt wording guard. Mutants per rule.

## Phase K: ship re-check after Phase J (2026-11-05). Findings: scratchpad recheck3-{pentest,security,codereview}.md
(pen-test 0C/0H/0M/1L/6I, security 0C/0H/0M/2L/3I, code review 0C/0H/2M/3L/4I). User picks: install line "Drop wrapper
now"; T82 "Fix all now as T82b"; key safety "Fix both now"; small items "Fix all now".

### Task 82b: concurrent first installs and honest resume messages
hooks/ensure-decrypt-cli.sh: an exclusive lock (mkdir lock in the private .download folder, stale-safe as in the
learnings: owner pid checked, takeover guarded) around resume_binary; a second run exits 75 with "another session is
downloading the decrypt CLI; run the command again in a minute". A dropped connection (curl 18/56/7 after progress in
this run) exits 75 too, not "failed". curl's --max-time is never below 1 (0 = no limit). Prompts: if the step is
stopped by the Bash time limit, run it again; after 3 reruns that still exit 75, stop and tell the user. Tests: two
concurrent runs (one 75 "another session", the other installs); a held lock from a dead pid is taken over; rc 56 after
progress is 75; max-time floor; prompt guard. Mutants per rule.

### Task 83: the install step runs without an approval prompt (user "Drop wrapper now")
Real CLI check 2026-11-05 (Claude Code 2.1.318): `X || { echo "..."; exit 1; }` is refused by the permission layer
("Contains brace with quote character"), old and new lines alike; the bare `~/.oss/hooks/ensure-decrypt-cli.sh
--long-step` runs under the plugin's allow rule. The 157 prompts + login.md run the bare line; the text around it says
what exit 1 (stop and show the message) and 75 (rerun, at most 3 times) mean. Guard: no install line with `||` or
`{`, and every install step carries the exit-code text.

### Task 84: config.json saves never leave a cut-off file (security R3-1, code review L3, pen-test I4)
watcher/src/utils/config-save.ts (and WebhookConfig through it): write a 0600 temp file in the target's real folder
(the link's target when config.json is a link the user owns), fsync, rename over it; any write error is NotSaved and
leaves the old file byte-identical. Tests: EFBIG/ENOSPC-style failure leaves the old file; link kept as a link; 600.

### Task 85: provider API keys never in argv (security R3-2, pre-existing)
watcher/src/cli/start-proxy.ts: the background proxy gets the provider key from config or its environment, never
`--api-key` in argv (ps). watcher/src/cli/models.ts `keys set`: the key from a value file or stdin, not argv; prompt
text (commands/models.md) updated. Tests: spawned argv has no key; keys set from stdin/value file; old argv form
refused with a clear message.

### Task 86: small hardening (user "Fix all now")
- hooks/oss-api-curl.sh oss_ask: any non-zero oss_capped status clears the code and the answer.
- watcher/src/logger/log-reader.ts: read new log data in capped chunks.
- config-save: a dangling config.json link is refused like settings.json's.
- commands/models.md: the T78d comment says exactly what is masked (models.apiKeys); check top-level .apiKeys is never loaded.
Each with a RED test and mutants.

### Task 76b: an old Claude Code says why offload ran on Claude (user 2026-11-05 "Tell them, run on Claude")
watcher/src/cli/agent-offload.ts: when the nested CLI rejects --restricted (unknown option), the reason is
`cli_too_old`, not spawn_error, and one visible line is printed: "Model offload needs a newer Claude Code (update
with: claude update); this agent ran on Claude instead of <model>." (model name sanitized). /oss:models (status/list)
shows the same warning when the installed CLI lacks --restricted. Agents' Step 2.5 text shows that line to the user.
Release note. Tests: stub CLI rejecting the flag -> cli_too_old + the line; other failures stay spawn_error; models
warning; prompt guard. Mutants.

### Phase K scope cut (user 2026-11-05 "Regressions only, then ship")
This branch finishes with T82b, T83 and T76b only. T84, T85 and T86 move to a follow-up branch (FOLLOWUPS, security
items). One last narrow review of the Phase K diff; only CRITICAL/HIGH/MEDIUM problems introduced by this branch are
fixed, everything else goes to FOLLOWUPS. No further full re-check rounds. Then T71c, T59, the PR.

### Task 87: /oss:queue --shared keeps working without Claude seeing the key (T59 finding; user 2026-11-05 "Plugin verb now + API prompt")
T59 live gate: the served queue prompt (AgenticDevWorkflow packages/api/src/prompts/commands/queue.md:39) tells Claude to
POST /api/v1/queue with `Authorization: Bearer {apiKey}`; after T57 Claude no longer sees the key. Plugin side (this
branch): `oss-value.sh queue-push` (allowlisted like `usage`/`status`) reads type.txt (feature|issue|review),
source.txt and prompt.txt from the value folder, checks them (type from the fixed set; source/prompt bounded length,
no control characters), POSTs JSON built by jq with the key on curl's stdin (oss_api_curl, oss_capped, https rules),
deletes the value files, and prints only the new item's id (cleaned) or an Error: line (401/403/429/network
distinguished). API side (API session, brief in scratchpad t59/api-brief.md): queue.md's --shared step uses the
verb, the manifest is re-signed, deployed; this PR merges only after that deploy and a live re-check. Tests: value
checks, key never in argv/output, request body/route/method via the local stub, error mapping, allowlist guard.

### Task 88: tell the customer when a repo's agent model mapping is ignored (T59 part 2 finding; user 2026-11-05 "Clear notice now")
T71b (on purpose) ignores `models.agents` / `models.default` in a project's .oss/config.json, so after the 2.0.97 upgrade a
2.0.96 customer's per-repo mapping silently runs on Claude; the only sign is the banner "OSS model: Claude (session
default)". Fix: when agent-model-check resolves to native Claude AND the project's .oss/config.json maps this agent (or
its default) to a non-Claude model, the banner gets a second line saying the repo's mapping is not used since 2.0.97,
the agent ran on Claude, and how to keep it in ~/.oss/config.json via /oss:models. /oss:models list shows the same.
The project file only feeds this notice; it never routes. Agent name and model pass through safeForLog. The read is
regular-file only (no hang on a FIFO), and a bad or missing file gives no notice and no error. No agent prompt changes
(Step 0 already echoes the banner).

### Task 89: the self-contained oss-launch starts its proxy in the background (T71c finding, also in 2.0.78; user 2026-11-06 "Fix now, new tag")
In the bundled binary, start-proxy's background mode spawns `process.execPath [selfPath, --router, --port N]`. The
binary sees a script path as argv[0], resolveEntry() picks "launch", and the child runs as the launcher instead of the
proxy, so `oss-launch` with an agent mapped to a local model always ends with "OSS proxy did not become healthy".
Fix: when bundled, the background child is spawned as `process.execPath start-proxy --router --port N` (as
oss-launch's own proxySpawnArgs does); the node-script path keeps `[selfPath, ...]`. Tests first. Then tag
oss-launch-v2.0.97-1, verify all four downloads, and run a sandbox test: version, a hostile repo config does not route,
the user's own config routes, and the proxy comes up healthy in the background. Then pin that tag and its checksums
(T71c).
