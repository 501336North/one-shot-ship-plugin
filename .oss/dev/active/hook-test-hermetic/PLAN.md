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
