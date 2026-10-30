# Testing: hook-test-hermetic

## Strategy
- **Not blocking the caller:** proven with received/release files and the `close` event (EOF on all pipes). Never with wall-clock thresholds. Time limits are only backstops against hangs.
- **Hermeticity:** proven with sentinels in a parent-provided HOME that must survive unchanged, plus recording stubs that must see zero network calls.
- **Anti-vacuity:** each new guard is shown RED against a mutant of the code it protects. The result is recorded below per task.
- **Safe runs until T5:** use the untracked safe vitest config (no setupFiles). After T5, use the real config.

## Results

### Acceptance (2026-10-28, /oss:acceptance, test-engineer)
File: `watcher/test/hooks/acceptance/hook-background-detach.acceptance.test.ts`. It has 4 tests across 3 scenarios, is hermetic and event-driven, and warms its stubs in beforeAll.

**On current code:** 4/4 RED, each because the hook kept its output open. A rerun by the orchestrator confirmed it.
- Workflow start: output stays open while the analytics request is in flight.
- Session event: output stays open while the update notice is pending (the delay job was reached).
- Session start, fresh start: output stays open while notify runs.
- Session start, context restored: output stays open while notify runs.

**Anti-vacuity:** with all four redirects in place, 4/4 GREEN. With only two of them, exactly the matching two turn GREEN. The hooks were then restored, and `git diff hooks/` is empty.

**Committed with T3 (2026-10-29), 4/4 GREEN.**

**Observed during warm-up:** one first exec of a new stub took 19.4 s at load average 9. That confirms DESIGN test defect 1.

### T1 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-analytics-detach.test.ts`, 3 tests.
- RED on current code: 2 failed for the right reason. Output was still open 15 s after the request started, and the analytics curl argv had no `-m`. The control (event still sent) passed.
- GREEN: 3/3. The acceptance "workflow start" test now passes; the other 3 acceptance tests stay RED (T2, T3).
- Anti-vacuity: reverting the redirect turns only test 1 RED; removing `-m 5` turns only test 2 RED.
- Whole hooks dir (safe config): 173/177. Failures: the 3 acceptance tests for T2/T3, and `oss-session-logging` "should log hook START event for session start" (6.7 s, a known flake, fixed by T11).

### T2 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-update-notice-detach.test.ts`, 2 tests.
- RED: test 1 failed because the output was still open 15 s after the notice delay started. It checks first that the delay was reached, so it cannot pass vacuously. The control (notice still posted after release) passed.
- GREEN: 2/2. Acceptance: "workflow start" and "session event" now pass; the 2 session-start tests stay RED (T3).
- Anti-vacuity: reverting the redirect turns test 1 RED with the same message.
- Whole hooks dir (safe config): 177/179. The only failures are the 2 T3 acceptance tests.
- **Watch in T15:** in that full run, the acceptance "fresh start" test failed at its launch check (line 355) after the 20 s marker backstop, not at the close check. Run alone, it fails at the close check as expected. If this recurs after T3, the backstop is load-sensitive and needs fixing.
- The helpers (`writeStub`, `warm`, hermetic env, `startHook`) are now copied in 3 files. T7 is where they get shared.

### T3 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-session-start-notify-detach.test.ts`, 4 tests (2 branches × close + control).
- RED: both "finish starting" cases failed: output still open 15 s after the notify launch. Controls passed.
- GREEN: 4/4. Acceptance file: 4/4.
- Anti-vacuity: reverting the context_restored redirect turns only that case RED; the same holds for fresh_start.
- REFACTOR: the acceptance MARKER_BACKSTOP_MS went from 20 s to 60 s, and TEST_TIMEOUT_MS from 40 s to 100 s (load-sensitive launch wait seen in the T2 run). No assertion changed.
- Whole hooks dir (safe config): 182/183. The one failure was `hook-error-adoption` "should emit OSS-AUTH-001 ... 401", a known flake that T9 fixes.

### T4c (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-log-fallback.test.ts`, 2 tests.
- RED: when there is no oss-log.sh and no plugin cache, the hook exited 1 silently before `setActiveStep build` (no node calls). The control, with oss-log.sh in the cache, passed.
- GREEN: 2/2. Anti-vacuity: removing `|| true` turns test 1 RED with the same message. Together with the T1 and T2 files: 7/7.

### T4b (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-session-start-health-check-detach.test.ts`, 2 tests.
- RED: (1) session start stayed open 15 s into the health check; (2) health-check.log had no summary, which went to the hook's stdout instead.
- GREEN: 2/2. Anti-vacuity: reverting the redirect turns only test 1 RED; reverting `>> health-check.log` turns only test 2 RED.
- Regression check: the notify-detach file and the acceptance file both pass (10/10).

### T4a (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-log-agent-detach.test.ts`, 5 tests: 4 variants (starting or completed, each with and without a project dir) plus a control.
- RED: all 4 variants were still open 15 s into the state update. Each also confirms it reached its intended branch. The control passed.
- GREEN: 5/5, 16 runs in a row including parallel runs. The orchestrator then reran it together with oss-log-agent-state 3 times: 10/10 each time.
- Anti-vacuity: reverting each of the 4 redirects alone turns exactly its own variant RED. A partial mutant (stdin and stdout redirected, no `2>&1`) is also RED.
- **The fix broke one existing test, and it was fixed:** `oss-log-agent-state` "should set supervisor to watching when agent completes" failed 3/3 with the fixed hook and passed 3/3 at HEAD. That test only passed because the hook blocked: it read `supervisor` after `clearActiveAgent` and before `setSupervisor`. It now waits for `supervisor === 'watching'`.
- **Unexplained, recorded:** the first GREEN run had 1 failure at 217 ms, and its message was not captured. It did not recur in 16 later runs. The likely cause is that `afterEach` deleted the state dir while the detached node chain was still writing to it. afterEach now waits for both node calls to finish (`node-done`). T15 must confirm this.
- **Same race, not yet fixed:** `oss-log-agent-state` "should still write to log file..." deletes its project dir while a real detached node chain may still be running. Added to T6.

### T4d (2026-10-29, /oss:build, test-engineer)
File: `hooks/__tests__/oss-value.test.sh`, section 22: 2 new assertions, a control plus the time-limit check.
- RED: no `-m`/`--max-time` in the login curl argv (333/334). The control (login succeeds) passed.
- GREEN: 334/334. Anti-vacuity: removing `-m 10` gives the same failure. Regression: `commands/__tests__/value-file-wrappers-run.test.sh` passes 59/59.
- **Slow, worth noting for T15:** oss-value.test.sh takes about 3 min. value-file-wrappers-run.test.sh took over 10 min at load 3 to 4.5, with long silent stretches inside `oss-value.sh dir`. Neither failed.

### T5 (2026-10-29, /oss:build, typescript-pro)
Files: `watcher/test/setup-isolation.test.ts` (a child vitest with the real config runs the probe `watcher/test/fixtures/setup-probe/probe.test.ts`) and `watcher/test/setup.ts`.
- **Safety:** the child runs with recording `pkill`, `find` and `killall` stubs first on PATH. It also gets a sandbox TMPDIR and a fake "real" HOME. A throwaway check confirmed `execSync('pkill …')` resolves to the stub. So the RED run could not kill anything on the machine.
- **RED:** 5/5 behaviour tests failed for the right reason:
  - the probe saw the fake real home;
  - `live-session` was visible;
  - the real `current-project` was deleted;
  - pkill was called 4 times;
  - `find -delete` was called once.
  The guard test (child exits 0, probe written) passed.
- **GREEN:** 6/6.
- **Anti-vacuity:** restoring each removed behaviour alone turns exactly its own test RED. That covers the HOME redirect, the env deletes, the current-project unlink, the pkill and the find -delete.
- **Full suite with the real config:** 3523 passed, 42 failed in 10 files. All 10 files depended on the real HOME. They are the T6 cycles.

### T6.a (2026-10-29, /oss:build, typescript-pro)
- **RED:** the new setup-isolation test failed: the probe saw no `$HOME/.oss`. `oss-log-project` failed with ENOENT on `.oss/current-project`.
- **GREEN:** setup.ts runs `fs.mkdirSync(<testHome>/.oss, { mode: 0o700 })`, which is the real install's mode. setup-isolation passes 7/7, and all 8 files pass:
  - oss-statusline 19/19
  - oss-log-project-local 5/5
  - oss-notify-project 3/3
  - oss-statusline-next-command 3/3
  - oss-statusline-tdd-emoji 3/3
  - update-workflow-state 4/4
  - oss-log-project 2/2
  - oss-statusline-git 3/3
- **Anti-vacuity:** removing the mkdir turns the new test RED.

### T6.b (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-session-context-local.test.ts` (+144/-218: shared hookEnv/runHook helpers, no save/restore of the real HOME files).
- RED under the temp HOME: 3 failed ("Not logged in" instead of the restore; no .gitignore block, or no .gitignore file created). 2 of the 4 passing tests were passing vacuously: they pass when the hook exits early.
- The new "should make no network calls" test records zero curl calls. Every network path is gated by `OSS_SKIP_HEALTH_CHECK=1`. Non-vacuity was shown by dropping that switch: the stub then records the subscription call to the production host. The stub-off variant was not run: `oss-session-start.sh:142` hardcodes the production URL and ignores `apiUrl`, so without the stub it would really reach production.
- GREEN: 8/8 in 3 back-to-back runs.
- Anti-vacuity on a scratch copy of hooks/:
  - removing the .gitignore block turns its test RED;
  - disabling the project-context restore turns its test RED;
  - **a mutant that restores from the GLOBAL file instead of the project file SURVIVED.** The restore test also writes a global context and checks only the message. This becomes task T6.b2.
- First exec of a new stub took 40.2 s under parallel-agent load (second exec 0.002 s). The warm-up budget is 120 s. T7 must take this into account.

### T6.b2 (2026-10-29, /oss:build, test-engineer)
- The restore test no longer writes a global `~/.oss/session-context.md`. It deletes one if the inject test left it behind. That way only the project file can produce "Previous session context restored", which is the hook's only stdout observable for the restore.
- RED against the global-file mutant, run on a scratch copy of hooks/ with the files warm: "OSS: Ready (active)…" printed, but no restore. 1 failed / 7 passed. The first mutant run timed out on first-exec scans of the fresh copy (24-30 s, empty output) and is not counted as RED.
- GREEN: 8/8 in 3 runs. `git diff hooks/` is empty.

### T6.c = T11 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-session-logging.test.ts`, 6 tests.
- RED under the temp HOME: "session START event with project metadata" failed because of the not-logged-in exit. The new "no network calls" test, run against the old env (logged-in HOME, health check on), recorded a call to the production subscription URL.
- The new "should only remove its own session pointer" test sets up real pointers for the test-owned id and for another id. It was RED with the old inherited-id behaviour (the parent env carried the other id): the other pointer was deleted.
- The curl stub is reached as `BASH_FUNC_curl%%` → `bash <stub>`, so it is never exec'd directly. Direct first exec of a new file cost 0.8 to 16.5 s, and about 58 s inside vitest.
- Each test now has its own session id. A shared id let an earlier test's pointer redirect a later test's log lines.
- Timeouts: 15 s per test (session end no longer uses vitest's 5 s default). GREEN: 6/6 in 3 runs, plus 5 earlier runs.
- Anti-vacuity:
  - Session end skipping `oss_session_pointer_remove`: the pointer test goes RED.
  - Session start skipping its START line: the START test goes RED.
  - The remove-all mutant (an `rm -rf` of an expanded var) was blocked by a safety check and not run. The first mutant covers that the removal runs; the setup with two pointers covers whose pointer is removed.
- The real `~/.oss` (plugin-root, hooks/oss-log.sh, sessions/) is unchanged across these runs: the mtimes are still 08:01. The real session.log already holds test lines from 08:01, from an earlier run made elsewhere.

### Full suite after T5 + T6 (2026-10-29, real config)
3565 passed, 4 failed. All 4 are in `hook-error-adoption.test.ts` "fetch-iron-laws.sh emits OSSError…": vitest's 5 s timeout fired. Alone, the file passes 7/7. This is the per-test cold-stub defect diagnosed in DESIGN, so T7 and T9 are pulled forward. T5 and T6 are committed only once the suite is green.

### T7 (2026-10-29, /oss:build, test-engineer)
Files: `watcher/test/hooks/helpers/warm-stub.ts` (+ `.test.ts`); `hooks/__tests__/lib/warm-stub.sh` (+ `hooks/__tests__/warm-stub.test.sh`).
- API: `writeWarmStub(file, body, onWarm?)` plus `WARMUP_TIMEOUT_MS = 180_000`; `warm_stub <file> <body> [on_warm]`. Each helper writes the guard line, sets 0755, execs the file ITSELF once with `OSS_STUB_WARMUP=<marker>`, and fails if the marker is missing.
- RED: the modules did not exist. GREEN: vitest 1/1, bash 3/3, 3 more runs each.
- Anti-vacuity: skipping the warm-up exec turns each test RED.
- **Known survivor:** a mutant that runs `bash file` instead of exec-ing the file passes. The marker and the side effect are the same either way, and only the OS scan differs. Pinning it would need a spy on the unit under test or a timing check, so it is recorded here and not chased.
- No runner picks up `hooks/__tests__/lib/` by glob. Bash tests are run by hand, and `stat-order`, `referenced-hooks-tracked` and `no-stray-oss` still pass.
- `watcher/tsconfig.json` excludes `test/`, so test files have no type check in the repo. A scratch tsconfig gave rc 0 with no `any`.

### T9 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/hook-error-adoption.test.ts`. There is now one curl stub, made with `writeWarmStub` in beforeAll, driven by `STUB_CURL_MODE` (http | fail | checksum), `STUB_CURL_BODY` and `STUB_CURL_CODE`. If no mode is set, the stub exits 99.
- RED: with the env not yet wired, 5 per-mode assertions failed: no 401/403 text, no `curl exit 6`, exit 99 instead of 1, no checksum mismatch.
- Mutant: fetch-iron-laws emits OSS-AUTH-999 on 401 (in a scratch copy). Only the 401 test fails.
- GREEN: 7/7 in 5 runs, about 1.2 s each. No executable is created outside beforeAll. `git diff hooks/` is empty.
- Gap: the ensure-decrypt-cli fail-mode cases cannot see curl's exit code, because the hook does not print it. Fail mode is proven only through fetch-iron-laws.

### Full suite after T9 (2026-10-29, real config)
3569 passed, 1 failed: `integration/agent-status-line` "should clear agent from status line when agent completes". It expected `✓` (watching) and got `✅`. The test waits for the agent to be cleared, then reads `supervisor`, which the detached second call (`setSupervisor watching`) has not written yet. This is the same race T4a found in oss-log-agent-state, and it was introduced by T4a's detach. It passed in the post-T6 run, so it is intermittent. It is fixed as T4a-2 below, with a provenance grep.

### T4a-2 (2026-10-29, /oss:build, test-engineer)
- RED: deterministic. A scratch copy of hooks/ has `sleep 1` between the chained calls, and with it the test fails with the observed message.
- GREEN: `waitForSupervisor('watching')` runs before the status-line read. It passes 2/2 on the delayed copy and 10/10 over 5 runs on the real hooks.
- Provenance: every test that runs `oss-log.sh agent`, or reads activeAgent/supervisor, was grepped in watcher/test and hooks/__tests__. Each match was run against the delayed copy, and only agent-status-line depended on the chain order. The verdicts are in the commit body.

### Full suite after T4a-2 (2026-10-29, real config): 264/264 files, 3570/3570 tests, rc 0.

### T8 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-telegram.test.ts`. The `bin/node` and `oss-log.sh` stubs are created once in beforeAll with writeWarmStub. Each test gets its own `NODE_CALLS` file. The behaviour test is `it.each(['build','ship'])`, so a leak between runs would show.
- RED (leak): with the stubs shared but writing to a fixed file, the ship run saw build's call.
- Mutant: a scratch hooks copy that calls telegram-notify.js after chain-trigger turns all 3 tests RED.
- GREEN: 3/3 over 5 runs. No executable is created after beforeAll.
- A hand probe before the change: the first run against fresh stubs took 5.36 s and the second 0.10 s, just over vitest's 5 s default.

### T10 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-project.test.ts`. The file now owns its HOME: mkdtemp, `.oss` at 0700, no save/restore of real files. A recording curl stub (warm, per-test `CURL_CALLS`). The child env drops CLAUDE_CODE_SESSION_ID, CLAUDE_PROJECT_DIR and OSS_CONFIG_DIR.
- New test, "should send nothing to the network". With a fake key and apiUrl in the sandbox, it is RED: the analytics POST was recorded. The fake key is not kept, because a keyed `start` is supposed to send the event, and T1 covers that.
- **The hook runs via spawnSync with an extra pipe on fd 3.** The detached jobs inherit it, so spawnSync returns only after they exit, with a 15 s bound. Without that pipe, the zero-call assertion passed even with a key: it raced the detached job and was vacuous. This applies to any "no call happened" check on a hook with detached jobs (see T15).
- Mutant: project dir taken from `current-project` (the D1 defect) turns all 3 project-resolution tests RED. An unmutated scratch copy passes 4/4.
- GREEN: 4/4 over 5 runs.

### T12 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-log-error-recovery.test.ts`. One sandbox per test (home/.oss plus a work dir with an empty `.git` that fences the project walk). Every run gets HOME=sandbox and has CLAUDE_PROJECT_DIR and CLAUDE_CODE_SESSION_ID removed. The save/restore code is gone (`grep restore` finds nothing).
- RED: a sentinel parent HOME received RECOVERY and TIMEOUT lines in build.log and session.log under the old execSync options. The old file also forced `~/.oss/current-project` to '' and could leave it behind empty.
- Mutants: `recovery` logs nothing makes the 2 recovery tests RED; dropping HOME=sandbox makes 5 RED.
- GREEN: 7/7 over 5 runs.
- Noted: `$TMPDIR/.oss` exists as an empty dir (from Oct 20). With a `.git` above any test cwd under $TMPDIR, the project walk would pick it up. This file is fenced. Checked in T15.

### Full suite after T8, T10, T12 (2026-10-29, real config): 264/264 files, 3573/3573 tests.

### T14 (2026-10-29, /oss:build, test-engineer)
File: `hooks/__tests__/oss-api-curl.real.integration.test.sh` (+50/-19). Scenario 1 no longer samples ps on a timer.
- The recorder takes one request on hold when `$T/hold/armed` exists, signals `received` on a fifo, and holds until `release`, with a 25 s backstop. The test reads `ps -axo args=` once while the request is held. It checks that the analytics curl line is there and that the key is absent.
- The curl shim is warm. Scenario 1's curl has `-m 30`; it was `-m 5`, and the timeout was raised above the hold time. The `OSS_API_CURL_HELPER` override points the test at scratch copies.
- Mutant (key back in argv via `-H "Authorization: Bearer $key"`, scratch copy) failed 5 of 5, every time on "key never in any command line". The "server received Bearer <key>" assertion still passes under this mutant (Python `headers.get` returns the first value), so only the in-flight check catches it.
- Unmutated scratch copy: 15/15. 5 runs green, 15/15 each. Under load (8 loops making and running fresh scripts) green, 15/15 in 6 s. Re-run by orchestrator: 15/15.

### T4f (2026-10-29, /oss:build, test-engineer)
Files: `hooks/oss-session-start.sh` (subscription check) and the new `watcher/test/hooks/oss-session-start-subscription-url.test.ts`. The URL is now resolved with `oss_api_url`. An invalid apiUrl means no call is made and the status is "unknown".
- The test runs with its own HOME, warm curl/claude/say/afplay stubs, and a sandbox plugin root that holds a copy of hooks/ (`OSS_TEST_HOOKS_DIR` points it at a scratch copy). It uses spawnSync with an fd-3 pipe, so detached jobs are awaited. beforeAll runs one warm-up session start, because the copied hooks are new files and their first exec is scanned (40-60 s under parallel load; the hook was observed stuck at its first exec of oss-log.sh).
- RED: apiUrl 127.0.0.1:9 → the call went to onrender (2 failed; the no-apiUrl control passed).
- Mutants (scratch copies), all RED: the original hook; the guard kept but the URL hardcoded; `oss_api_url || jq .apiUrl` (bypasses the invalid-URL check).
- GREEN: 3/3 over 5 sequential runs. 12/12 with 6 vitest processes running at once. Neighbouring suites 17/17. Orchestrator re-run: 3/3.
- Provenance: fetch-iron-laws.sh, oss-fetch-team-iron-laws.sh, oss-iron-laws-sync.sh and oss-push-metrics.sh still send the key to the hardcoded host (FOLLOWUPS:95; asked the user whether to widen T4f). oss-login.sh's first login is justified. The -new/-test copies are unreachable (FOLLOWUPS:29). check-updates and changelog send no key.
- Gap at this same site: the key is read from `~/.oss/config.json` (line 124), but the URL comes from `oss_config_file` (honours OSS_CONFIG_DIR). Fixed in T4f-2.

### T13 (2026-10-29, /oss:build, test-engineer)
File: `hooks/__tests__/oss-notify-complete-bounds.test.sh` (8 checks, was 7). No wall-clock assertion is left; `grep took|date +%s|SECONDS` only matches a comment.
- Warm `node` and `oss-log.sh` stubs. The recording `gtimeout`/`timeout` stubs export the limit they ran under, so each state call logs `<limit>|<argv>`.
- The ship complete case expects 6 calls, all `2|`; the build complete case expects 5.
- Hang case: no timeout tools on PATH, so the hook's own fallback timer is tested. It passes when the hook exits without `release` after at least one `received`. Its timer `sleep` is a gated stub: timer N waits until `received` has N lines, so "all 6 attempted" cannot race the 2 s timer. Proven by a scratch test whose hung stub waits 3 s: the old count failed, the new one passed 8/8.
- Fallback-timer case: the `sleep` stub records its pid, so "stdout released, no sleep left behind" is checked without a clock.
- Mutants (scratch copies; each fails within one 60 s backstop): m1 wf_state_timeout calls node directly gives 3/8; m2 setWorkflowComplete loses its timeout gives 6/8; m3 the timer never kills gives 6/8; m5 the TERM trap leaves its sleep gives a case-6 failure. m4 (timer keeps stdio) survives; it is equivalent, because the timer is still killed and stdout closes.
- GREEN: 5 sequential runs plus 1 under load (8 fresh-script loops). Orchestrator re-run: 8/8.
- Runtime is 25-302 s depending on load. One instrumented run under load took 50 s: 57% the 18 stub warm-ups (first-exec scan), 24% the hook's real timers, 16% `no_timeout_tools` symlinking /usr/bin. FOLLOWUPS: make the shared stubs once per run and the no-timeout PATH once.

### T4f-2 (2026-10-29, /oss:build, test-engineer)
Hook: `CONFIG_FILE=$(oss_config_file)` in oss-session-start.sh, so the logged-in check, the key read and oss_api_url read one file. The curl stub now also records stdin, where the key travels.
- New test: with OSS_CONFIG_DIR set (key KB, apiUrl 127.0.0.1:9) and HOME's config holding KA, only KB is sent, to 127.0.0.1:9. New control: unset, HOME's key and URL are used.
- RED: the call carried `Bearer fake-key-home-KA`; the URL assertion before it passed, which is exactly the leak.
- The flake fix in the same test: the sandbox plugin root's `hooks` is now a SYMLINK to the real (or mutant) hooks dir, not a copy, so no new files are scanned. The first run had hit the 180 s beforeAll budget while copying. The hooks resolve their root logically (`cd dirname && pwd`; CLAUDE_PLUGIN_ROOT is set). A recording node stub asserts that no node CLI ran, which proves the root did not jump to the repo's watcher/dist. The warm-up session was dropped (beforeAll 2.3-2.8 s).
- Latent: oss-notify.sh:19 (`$SCRIPT_DIR/..` when CLAUDE_PLUGIN_ROOT is unset) and check-updates.sh:24 would cross the symlink. Neither runs in this test.
- Mutants (fresh scratch copies), all RED by assertion, no timeouts: A pre-T4f hook gives 4 failed; B hardcoded URL gives 3; C invalid-URL bypass gives 1; D old line 124 gives 1 (`Bearer fake-key-home-KA`).
- GREEN: 5 sequential runs (5.8-9.9 s) and 6 parallel runs (17-21 s) at load ~18, all 5/5. Neighbouring suites 23/23. Orchestrator re-run: 5/5 in 5.8 s.
- FOLLOWUPS: the grep key read vs oss_api_key (jq) parse a `\"` key differently.

### T4g (2026-10-29, test-engineer; by hand, not a /oss:build invocation)
Four scripts now send the key only to the configured apiUrl, with key and URL from `oss_config_file`: fetch-iron-laws.sh, oss-fetch-team-iron-laws.sh, oss-push-metrics.sh, oss-iron-laws-sync.sh. One recording, warm curl stub per file (argv plus the `--config -` stdin where the key travels); a sandbox HOME per case; OSS_CONFIG_DIR always passed explicitly; `HOOKS_UNDER_TEST` for mutants.
- Cases per script: (a) apiUrl honoured, (b) OSS_CONFIG_DIR's key sent and HOME's never, (c) a refused apiUrl sends nothing, (d) control: no apiUrl uses the default host.
- RED: fetch-iron-laws 3/6, team 1/4, push-metrics 1/4, sync-safety 53/57 (both refresh and --install).
- Mutants (scratch copies): hardcoded URL fails (a)-(c) everywhere; HOME config fails (b) everywhere.
- GREEN: 5/5 runs each (6/6, 4/4, 4/4, 57/57 + 8/8). Orchestrator re-run: all green, oss-api-curl 6/6.
- Full shell suite (2751 s under load): 2 failures, both regressions from T1 (422f942): optional-helper-source (4/5) and oss-notify-api-url (11/21) assert right after the hook returns, but the analytics POST is now detached. Tracked as T4h.

### T4h (2026-10-29, test-engineer; by hand, not a /oss:build invocation)
Files: `hooks/__tests__/optional-helper-source.test.sh`, `hooks/__tests__/oss-notify-api-url.test.sh`. Both now take `HOOKS_UNDER_TEST`, make their stubs once with `warm_stub` (cases symlink to them; each case's dir is `$SHIM`), and run the hook with `3>&1` inside the command substitution. The detached analytics job and its curl inherit fd 3, so `$(...)` returns only after they exit.
- Diagnosis: scratch trees with the unmodified tests. Current hooks: 4/5 and 11/21 (the reported failures). Only the detach redirect reverted: 5/5 and 21/21. Hook at 422f942^: 5/5 and 21/21.
- Vacuity of the old "no request" checks, proven: under mutants m3 (apiUrl validation bypassed), m4 (workflow-name validation bypassed) and m5 (helper absent → direct curl), the OLD files still passed all 7 refused-URL cases, all 4 hostile-name cases and optional-helper case 2.
- Mutants against the new files (scratch copies): m1 analytics call removed → 10/10 request cases of api-url fail and optional-helper case 3 fails; m2 key to a hardcoded host → the 5 custom-apiUrl cases fail (the 4 default-host cases pass, as expected); m3 → 7/7 refused-URL cases fail; m4 → 4/4 hostile-name cases fail; m5 → optional-helper case 2 fails.
- GREEN: 5 sequential runs each, 5/5 and 21/21 (load 5-9).

### T4i (2026-10-29, test-engineer; by hand, not a /oss:build invocation)
`hooks/fetch-iron-laws.sh` gets `--max-time 10` (as oss-fetch-team-iron-laws.sh). New test 7 in `fetch-iron-laws.test.sh`: the recorded argv has `-m N` or `--max-time N`, 1 <= N <= 10.
- RED: 6/7, `limit=` empty, argv without a limit. Mutant (scratch copy without the flag): 6/7, same message. GREEN: 7/7 over 5 runs.
- Neighbours touching oss-notify.sh (/bin/bash): auto-permissions 14/14, oss-notify-updates 2/2, dead-vars 6/6, project-routing 45/45, workflow-name 12/12, writer-nofollow 49/49, session-start-copy 9/9, oss-value 334/334, session-routing 124/124, timeout-fallback 1/1.
- **Found:** `oss-notify-complete-bounds.test.sh` (T13, ad194f2) does not parse under /bin/bash 3.2, its own shebang: line 79, a `case` pattern `)` inside a `$(cat <<EOF)` body ends the substitution early. It passes 8/8 under bash 5.3. Not fixed here.

### T13b (2026-10-29, /oss:build orchestrator)
- RED: new hooks/__tests__/bash32-parse.test.sh, `/bin/bash -n` over every bash script in hooks/ and hooks/__tests__/: 96/97, oss-notify-complete-bounds.test.sh line 79 `syntax error near unexpected token '('`. That RED run against the original file is the guard's mutant check.
- GREEN: the two case arms in the node stub's heredoc become `(*update-workflow-state.js)` and `(*chain-trigger.cjs)`. 97/97. complete-bounds itself 8/8 under /bin/bash 3.2 and under bash 5.3.

## Stability proof (T15)
Extra checks found during build:
- every "no network / no call" assertion on a hook with detached jobs must wait for those jobs (fd-3 pipe or a done marker), or it is vacuous (T10);
- `$TMPDIR/.oss` must not be picked up as a project by any test (T12).
(5 runs per suite, plus 1 run under load, plus the real ~/.oss mtime check)

### T15 result (2026-10-29 15:02-16:58 CST, test-engineer; HEAD 28f8d67): NOT PASSED
One shell file is flaky: `hooks/__tests__/oss-notification-style.test.sh`, red in shell run 2 and in the shell run under load. Everything else was green in every run. Per the plan, this is a defect to fix as a new RED-first task, not a retry.

How it was run (scripts and every log are in the session scratchpad `t15/`):
- Watcher: `cd watcher && npx vitest run` (the real vitest.config.ts with setup.ts), `gtimeout 3600`.
- Shell: every `hooks/__tests__/*.test.sh` in order, from the repo root. Each is exec'd so its own shebang applies (48 have `#!/bin/bash`, i.e. 3.2). `ensure-oss-launch.test.sh` is not executable, so it ran as `/bin/bash file`. `no-telegram-hook`, `oss-notify-dead-vars` and `stat-order` use `#!/usr/bin/env bash`, which resolves to bash 5.3 on PATH. `gtimeout 1800` per file.
- Load: 8 parallel loops, each writing a brand-new script, `chmod +x`, exec, `rm`, until a stop file appears. A trap and the stop file end them; afterwards ps shows none left. Measured with no load generator: a new script's first exec takes 1.6-3.3 s and its second about 0.01 s. Under the shell load run each loop managed 327 iterations in 1392 s, about 4.3 s per new script.

| Suite | Run | Result | Duration | Load (1/5/15 at end) |
|---|---|---|---|---|
| watcher | 1 | 265/265 files, 3578/3578 tests | 124 s | 5.37 7.28 8.49 |
| watcher | 2 | 265/265, 3578/3578 | 127 s | 5.92 6.64 8.06 |
| watcher | 3 | 265/265, 3578/3578 | 124 s | 4.65 6.18 7.70 |
| watcher | 4 | 265/265, 3578/3578 | 120 s | 6.77 6.12 7.45 |
| watcher | 5 | 265/265, 3578/3578 | 116 s | 5.66 6.17 7.31 |
| watcher | load | 265/265, 3578/3578 | 263 s | 12.33 44.61 79.36 (start 14.81) |
| shell | 1 | 51/51 files, 963 PASS lines | 523 s | 9.99 7.75 6.90 |
| shell | 2 | **50/51**, 962 PASS, 1 FAIL | 755 s | 6.17 7.64 7.49 |
| shell | 3 | 51/51, 963 PASS | 524 s | 4.40 6.18 6.81 |
| shell | 4 | 51/51, 963 PASS | 455 s | 5.95 6.31 6.65 |
| shell | 5 | 51/51, 963 PASS | 523 s | 65.57 25.49 14.01 (see below) |
| shell | load | **50/51**, 962 PASS, 1 FAIL | 1388 s | 3.60 5.33 19.42 (start 8.03) |

During shell run 5, another session (oss-lab) ran 48 busy-loop CPU burners: load 65 to 119. The run stayed green. The load runs waited until that job had exited and the 1-minute load was below 15.

**Defect: oss-notification-style.test.sh waits on the clock for a fresh stub's first exec.**
- Run 2: `✗ FAIL: a saved telegram style behaves exactly as visual — visual=node update-workflow-state.js setNotification Ready 10|terminal-notifier -title OSS -message Ready -sound Funk| telegram=node update-workflow-state.js setNotification Ready 10|`
- Load run: `✗ FAIL: visual style sets the Ready notice and shows the popup — calls=node update-workflow-state.js setNotification Ready 10|`
- Root cause: `oss-notification.sh:50` backgrounds `terminal-notifier ... &>/dev/null &`. `run_style` creates that stub fresh in every call (mktemp, printf, chmod), then polls for its line for at most 20 x 0.1 s = 2 s. The stub's first exec costs 1.6-3.3 s at ambient load (measured above), so whether the line lands within the window is chance. This is the diag-b stall condition: a fresh executable plus a wall-clock window.
- Vacuity: in the load run, both styles missed the popup, so `telegram == visual` passed comparing two incomplete call lists. Only the anchor check caught it.
- Fix direction (test only, not done here): make the stubs once with `warm_stub`. Wait for the backgrounded popup with an event, not a clock: the hook redirects only fds 0-2, so a `3>&1` pipe inside the command substitution (as in T4h) makes it return after the popup stub exits.

**Same pattern, green in all 6 runs but latent:**
- `oss-stop-telegram-style.test.sh:30`: fresh stubs per call, 10 x 0.1 s = 1 s window for backgrounded say/afplay.
- `project-routing.test.sh:95`: a 10 x 0.3 s window for the detached `oss-log.sh agent` state write. Line 139 runs `sleep 1` and then asserts B is untouched; it does not wait for the detached jobs, so that check is weak under load.
- `iron-laws-sync-safety.test.sh:363`: `sleep 1`, then "no write while locked". The child could still be in its first exec, so this check can pass vacuously.
- `session-start-iron-laws.test.sh:114`: `sleep 1`, then "no refresh started" on a nohup'd job. Same vacuity under load.

**Real ~/.oss untouched.** Snapshots of mtime+size (and shasum) were taken for every file directly under `~/.oss` (986 entries) and `~/.oss/logs/current-session/*`: before any run, after each run, and at the end.
- Test-only sentinels are byte-identical and keep their mtimes: `fallbacktest.log` (written only by watcher/test/hooks/oss-log-project-local.test.ts; last written 08:01 today, before T5), `projectA_cmd.log` and `testcmd.log` (oss-value.test.sh names), `envtest.log`, `projectB_cmd.log`, `test.log`, `test-tdd.log`, `test-verbose.log`, `red.log`, `precheck.log`, `plan.log`, `health-workflow-state.json`.
- Excluded as written by live processes, each attributed:
  - `workflow-state.json`: `daemon/bin/oss-daemon.js` (PID 2640, up 10 days) writes `daemonHeartbeat` every 60 s at :52, also while idle with no test running (watched for 5 min). The decisions worktree session also ran `update-workflow-state.js`.
  - `session.log`: the bytes appended during all runs are only session START/END lines for real projects (oss-model-eval, AgenticDevWorkflow-g21, this worktree at 16:57/16:58).
  - `current-project`, `plugin-root`, `oss-statusline.sh`: rewritten together at 15:39, 15:57 and 16:58, matching those live session STARTs. plugin-root holds the installed cache path `.../oss/2.0.94`, which a test from this worktree would not write.
  - `build.log`: lines at 16:33 about `watcher/test/cli/redact-decision.test.ts`, a file that exists only in the one-shot-ship-plugin-decisions worktree.
  - `team-iron-laws.json`: rewritten 3649 s after its previous write, i.e. the 1 h cache TTL of oss-fetch-team-iron-laws.sh via a live oss-iron-law-check. Content hash unchanged, and it holds server-only fields that appear in no test fixture.
  - `update-state.json`: mtime only (15:24:41), content hash unchanged, during live session activity. No test running at that moment touches it.
  - `proxy-596xx.pid`: the model proxy of a live session.
- `$TMPDIR/.oss`: still the empty dir from Oct 20, same mtime before and after. There is no `.git` at or above `$TMPDIR`, so the walk (which stops at the first `.git`) cannot reach it.

**Audit of "no network / no call" assertions on hooks with detached jobs.** Detached jobs exist in oss-notify.sh (analytics POST on start; check-updates under --session), oss-session-start.sh (nohup iron-laws sync, notify --session, health check), oss-log.sh agent (state updates), oss-notification.sh and oss-stop.sh (popup/say/afplay).
- Waits correctly (fd-3 pipe): watcher oss-notify-project ("send nothing to the network"), oss-session-start-subscription-url; shell oss-notify-api-url, optional-helper-source (`3>&1`, T4h).
- Waits correctly (markers): oss-notify-analytics-detach, oss-notify-update-notice-detach, oss-log-agent-detach, oss-session-start-notify-detach, oss-session-start-health-check-detach, acceptance hook-background-detach. These assert only positive calls, via received/release/done markers.
- Valid, because no detached job is started:
  - oss-session-context-local "no network calls": OSS_SKIP_HEALTH_CHECK=1 skips notify --session and the iron-laws sync.
  - oss-notify-workflow-name: the name is refused before any job.
  - value-file-wrappers-run settings "no curl": the settings block has no detached job.
  - workflow-config: in-process fetch, not a hook.
- Does not wait, partly vacuous: oss-session-logging "should make no network calls". It runs execSync with stdio 0-2 only and without OSS_SKIP_HEALTH_CHECK. The nohup'd iron-laws sync and the detached notify --session can run curl after the assertion. Today the sandbox apiUrl, the PATH curl stub and OSS_SKIP_MANIFEST keep them off the network, but the assertion itself would not see a late off-sandbox call.
- Does not wait, backed by a static check: oss-notify-telegram "never runs telegram-notify.js" (stdio 0-2). The `complete` path's node calls are synchronous, and the source grep test guards the rest.
- Vacuous under load (clock waits): session-start-iron-laws:114, iron-laws-sync-safety:363, project-routing:139 (listed above), and oss-notification-style's equality check.

### T15b / T15c (2026-10-29 17:21 CST, test-engineer; by hand, not a /oss:build invocation)
Test-only changes; no hook touched. Each file can now be pointed at a scratch copy of hooks/ with
`HOOKS_UNDER_TEST`. All mutants were made in scratch copies, never in the real hooks. "Delay" mutants
stand in for a slow first exec under load and keep the behaviour correct, so a sound test must pass them.

| File | Mutant (scratch copy) | Old test | New test |
|---|---|---|---|
| oss-notification-style | popup run as `( sleep 3; terminal-notifier … ) &` (correct, just late) | FAIL: anchor "visual … shows the popup", and `telegram == visual` PASSED on two lists without the popup (the T15 failure, reproduced) | PASS 3/3 |
| oss-notification-style | style `t*` also runs `{ sleep 3; say Ready; } &` (telegram != visual) | **PASS 3/3 (vacuous)** | FAIL: telegram has `say Ready` |
| oss-notification-style | popup line replaced by `:` | (not run) | FAIL: anchor |
| oss-stop-telegram-style | popup run as `( sleep 3; terminal-notifier … ) &` (correct, just late) | FAIL: anchor, calls empty | PASS 2/2 |
| oss-stop-telegram-style | style `t*` also runs `{ sleep 3; say Done; } &` | **PASS 2/2 (vacuous)** | FAIL: telegram has `say Done` |
| session-start-iron-laws T2 | refresh started before the key check (no key needed) | FAIL (caught at idle) | FAIL |
| session-start-iron-laws T2 | same, started after `sleep 2` | **PASS 4/4 (vacuous)** | FAIL |
| iron-laws-sync-safety R6 lock | acquire_lock ignores the lock | FAIL (caught at idle) | FAIL: never-waited |
| iron-laws-sync-safety R6 lock | acquire_lock ignores the lock after `/bin/sleep 2` | **PASS (vacuous)** | FAIL: never-waited |
| iron-laws-sync-safety R6 lock | write first, then take the lock | FAIL | FAIL: written_while_locked=y |
| project-routing :95 | agent state update starts after `sleep 4` (correct, just late) | FAIL (3 s window) | PASS |
| project-routing :95 | agent state update dropped | FAIL | FAIL |
| project-routing :139 | no-project agent update goes to `current-project` (B) after `sleep 2` | **PASS 45/45 (vacuous)** | FAIL: C and D cases, B:workflow-state.json |
| watcher oss-session-logging "no network calls" | nohup'd refresh replaced by `sleep 3; curl https://mutant.invalid/sync` | **PASS 6/6 (vacuous)** | FAIL: mutant URL recorded |
| watcher oss-session-logging "no network calls" | extra `( sleep 3; curl https://mutant.invalid/late ) &` at the end of session start | **PASS 6/6 (vacuous)** | FAIL: mutant URL recorded |

GREEN changes:
- notification-style, stop-telegram-style: stubs made once with `warm_stub` and symlinked; the hook runs with `3>&1` inside `$(...)`, and the calls are read after every backgrounded job has exited. The polling loops are gone.
- session-start-iron-laws: curl shim and refresh stub made once with `warm_stub` and symlinked (they write into `$SS_T`); T2 runs `$(ss_run 3>&1 >/dev/null)`. The `sleep 1` is gone.
- iron-laws-sync-safety R6 lock: a `sleep` stub first on PATH is the handshake. On the sync's first lock-wait sleep it records whether CLAUDE.md exists, then releases the lock. The test waits for the sync to exit. A sync that never waits never releases the lock, which reads "never-waited". The `sleep 1` is gone.
- project-routing: `run()` adds `3>&1`, so every case waits for detached jobs. The 10 x 0.3 s poll (:95) and the `sleep 1` (:139) are gone. The run time went from 15 s to 13 s.
- watcher oss-session-logging: test/setup.ts sets `OSS_SKIP_HEALTH_CHECK=1` for every test, and `hookEnv` inherited it, so the old "no network calls" test never ran the refresh or the session notify. The test now sets `OSS_SKIP_HEALTH_CHECK: ''`. It runs both hooks through `runHookAndJobs` (execSync with a 4th `'pipe'`, which execSync waits on; ETIMEDOUT is a failure, not swallowed), and anchors that the subscription-check request was recorded.

Verification (/bin/bash 3.2, run directly): bash32-parse 97/97. 5 consecutive runs each: notification-style 5/5, stop-telegram-style 5/5, session-start-iron-laws 5/5, iron-laws-sync-safety 5/5 (57/57 each), project-routing 5/5 (45/45 each), `npx vitest run test/hooks/oss-session-logging.test.ts` 5/5 (6/6 each). Not done here: the T15 re-run of the whole shell suite and the run under load.

### T15 re-run (after T15b/T15c) (2026-10-29 17:26-18:26 CST, test-engineer; HEAD cd24cb8): PASSED
Verification only. No code or test was changed. The scripts are the same as in the T15 run (copied to the session scratchpad `t15-rerun/`, with fresh logs): all 51 `hooks/__tests__/*.test.sh` files, each exec'd through its own shebang (`ensure-oss-launch.test.sh` through `/bin/bash`), `gtimeout 1800` per file, from the repo root. The load run started at a 1-minute load of 1.95, below the limit of 15. PASS/FAIL are lines matching `PASS`/`FAIL` across all the per-file logs. That count includes T15b/T15c's new checks and is not comparable with the 963 in the T15 table.

| Run | Files passed | PASS / FAIL lines | Duration | Load (1/5/15 at end) |
|---|---|---|---|---|
| shell 1 | 51/51 | 1142 / 0 | 409 s | 3.89 3.70 4.86 |
| shell 2 | 51/51 | 1142 / 0 | 418 s | 4.50 5.78 5.63 |
| shell 3 | 51/51 | 1142 / 0 | 428 s | 8.51 5.29 5.25 |
| shell 4 | 51/51 | 1142 / 0 | 402 s | 1.77 3.20 4.24 |
| shell 5 | 51/51 | 1142 / 0 | 382 s | 1.73 2.50 3.51 |
| shell, under load | 51/51 | 1142 / 0 | 1484 s | 3.88 4.99 4.55 (start 1.95) |

- **Load:** the 8 fresh-script loops ran 326-327 iterations each in about 1488 s, roughly 4.6 s per new script. That is the same stall condition as the T15 load run (4.3 s). Under load, the files T15b/T15c changed were green: oss-notification-style 21 s, oss-stop-telegram-style 23 s, project-routing 15 s, session-start-iron-laws 10 s, iron-laws-sync-safety 284 s.
- **Cleanup:** the trap and stop file ended the loops; all 8 wrote their final count line. The trap removed the load directory. `ps` afterwards showed no process from shellsuite, master, load or the loaddir.
- **Real ~/.oss** (mtime+size of 1001 entries and shasum of 999 files, taken before, after each run and at the end). Test-only sentinels are unchanged. `$TMPDIR/.oss` is unchanged. Each change has a writer outside this suite:
  - `current-project` (now `/Users/ysl/dev`), `plugin-root` (now the installed cache `.../oss/2.0.83`; this worktree is 2.0.94), `oss-statusline.sh` and `session.log` were written together at 17:52:05-08, during run 4. The 134 bytes appended to session.log are exactly two live-session lines: `[17:50:49] [session] [END] project=ObsidianVaultNick` and `[17:52:08] [session] [START] project=dev branch=main`. This is the same pattern as in T15.
  - `update-state.json`: one write at 17:52:10 (`lastCheckedAt` 09:52:10Z, `lastPluginVersion` 2.0.83), which belongs to that same live start. One earlier write at 17:31:26 kept the same size. It came during run 1 while oss-value.test.sh was running. That file runs every hook with a sandbox `HOME`, and it cannot reach check-updates.sh or oss-changelog.sh, the only scripts that write this file. A live session had started at 17:30:00 (AgenticDevWorkflow-g21).
  - `workflow-state.json`: the heartbeat of `oss-daemon.js` (PID 2640). It was seen writing at 18:26:55 and 18:27:55, after the suite had finished.
  - `team-iron-laws.json`: only the mtime changed (18:10:07, 3657 s after 17:09:10, which matches the 1 h cache TTL). The content hash is unchanged.

## Integration (/oss:integration)
2026-10-29 18:54 CST, test-engineer. New file: `hooks/__tests__/oss-notify-analytics.real.integration.test.sh` (no product code changed).

- **Mocked boundary:** the analytics POST in `hooks/oss-notify.sh` (`--workflow <cmd> start`, `oss_api_curl ... -sS -m 5 -X POST .../api/v1/analytics/track`). `watcher/test/hooks/oss-notify-analytics-detach.test.ts` and `hooks/__tests__/oss-notify-api-url.test.sh` use a stub curl, so they assume that (a) the job is detached and the hook returns while the API holds the request, and (b) real curl's `-m 5` ends the job when the API never answers.
- **Real test:** real `/usr/bin/curl`, a python3 ThreadingHTTPServer on 127.0.0.1 (random port), temp HOME with a fake key and `apiUrl` = that server. Only node and oss-log.sh are stubbed. Event-driven: `received` fifo plus `release` file; a 60 s watchdog and the recorder's 120 s hold are hang backstops only, and no duration is asserted. Requires jq (without it the hook posts to production), otherwise SKIP.
  - S1: the hook runs without fd 3. Its `$(...)` returns, the server reports `received`, `release` is not yet created, and the hook's real curl is still running. After release, the curl exits and the log holds exactly one `POST /api/v1/analytics/track|Bearer <key>`. The hook prints nothing.
  - S2: the server never answers. The hook runs with `3>&1`, so `$(...)` returns only when the detached job and curl have exited. Checks: it returns before the watchdog, the server saw the request, and no curl to the sandbox port is left running.
- **Mutants** (scratch copies of hooks/ via `HOOKS_UNDER_TEST`):

| Mutant | Result |
|---|---|
| (i) `) </dev/null >/dev/null 2>&1 &` changed to `) &` (no detach) | **RED 8/9**: S1 "real curl was still waiting ... after the hook returned" fails. The hook was held until curl's own `-m 5` gave up. |
| (ii) `-m 5` removed | **RED 7/9**: S2 watchdog fired after 60 s, and a curl was left running (the watchdog stopped it). |

- **GREEN:** 3/3 runs at 9/9 under `/bin/bash` 3.2, plus 9/9 with `BASH_UNDER_TEST=/opt/homebrew/bin/bash`. `bash32-parse` 98/98. No curl or recorder process was left after any run, including the mutant runs.
- **Stub vs real:** no mismatch. Real curl behaves as the stubs assume. Note: without the detach, the hook is still bounded, but only by `-m 5`. A held API costs up to 5 s per `/oss:*` start. The `-m` and the detach are separate guards, and each mutant is caught by its own scenario.

## T17: session start never downgrades the shared ~/.oss/hooks
2026-10-29 19:32 CST, test-engineer. New file: `hooks/__tests__/session-start-no-hook-downgrade.test.sh` (11 assertions, sandbox HOME, no config so no key and no network, `3>&1` in `$(...)`, `HOOKS_UNDER_TEST` for mutants). Fake plugin roots 2.0.83 / 2.0.95 / 2.0.100 / 2.1.0 / no plugin.json / non-numeric version, each with distinguishable data copies of every `HOOKS_TO_COPY` name (read from the hook under test). Runtime about 1.8 s.

- **Rule as implemented** (`hooks/oss-session-start.sh`): session start copies `HOOKS_TO_COPY` and the legacy `~/.oss/oss-statusline.sh` only when there is no recorded version in `~/.oss/hooks/.installed-version`, or when its own version (`$PLUGIN_ROOT/.claude-plugin/plugin.json` "version") is the same or newer. After it copies, it writes its version there. Compare: numeric per dot part, bash 3.2, no `sort -V`. A version that is not `^[0-9]+(\.[0-9]+)*$` counts as unreadable (a record like that counts as no record). If its own version is unreadable and a record exists, it does not overwrite. If there is no record, it copies as before and writes none. The legacy statusline is under the same rule, because it comes from the same root in the same step and would be downgraded the same way.
- **RED** (HEAD hook): 3/11, 8 failed: the 2.0.83-over-2.0.94 incident, 2.0.95-over-2.0.100, unreadable version, non-numeric version, and every "record written" control. The 3 that passed are the cases where today's behaviour is already correct (same version copies; no record and no version copies; nothing is evaluated).
- **Mutants** (scratch copies of hooks/):

| Mutant | Result |
|---|---|
| m1 drop the check (`if true`) | RED 7/11: incident, numeric, unreadable, non-numeric version |
| m2 always refuse (`if false`) | RED 5/11: all 6 install controls |
| m3 text compare (`[[ ! $1 < $2 ]]`) | RED 9/11: 2.0.95 vs 2.0.100 both directions |
| m4 no version validation | RED 10/11: `0+a[$(touch pwned)]` in the record ran `touch` (bash arithmetic evaluates array subscripts) |
| m5 record never written | RED 7/11: 4 record controls |
| m6 legacy statusline copied outside the guard | RED 7/11: the 4 refuse cases (the snapshot includes `~/.oss/oss-statusline.sh`) |

- **GREEN:** 11/11 three times under `/bin/bash` 3.2. `bash32-parse` 99/99. `session-start-copy` 9/9, `session-start-iron-laws` 4/4, `session-start-timeout-fallback` 1/1. `cd watcher && npx vitest run test/hooks`: 39 files, 204 tests passed.
- **Provenance (IRON LAW #1b), `grep -rn '\.oss/hooks' hooks/*.sh`:**

| Site | Writes plugin files into ~/.oss/hooks? | Verdict |
|---|---|---|
| oss-session-start.sh | yes (HOOKS_TO_COPY + legacy statusline) | guarded (this task) |
| oss-session-start-new.sh | yes, same loop | not registered: `.claude-plugin/hooks.json` names only oss-session-start.sh, and nothing else refers to it. Left as is |
| oss-session-start-test.sh | yes, same loop | not registered, same as above. Left as is |
| oss-setup-permissions.sh | no: `~/.oss/hooks/...` strings are permission allowlist entries | fine |
| ensure-decrypt-cli.sh | no: comments only (usage path, where it runs from) | fine |
| verify-decrypt-setup.sh | no: usage comment | fine |
| oss-value.sh | no: comment naming the allowed call prefix | fine |

## Ship gate round 1 fix round (T18-T27, 2026-10-30)
Every task RED-first with oss-log phases, plus anti-vacuity mutants on scratch copies (all killed).
| Task | Tests | Result | Mutants |
|---|---|---|---|
| T18 version record | session-start-no-hook-downgrade (11 → 26), health-check-detach (2 → 3) | 26/26, 3/3 | 16 |
| T19 config overrides | setup-isolation (+3), 12 shell files unset OSS_CONFIG_DIR/OSS_MANIFEST_URL | 10/10; sentinel key leak shown before in 9 files | 3 |
| T20 loopback opt-in | oss-api-url 54, oss-api-url-cases 192, oss-notify-api-url 24, subscription-url | all pass | 7 |
| T21 unreadable config | oss-api-url, oss-api-url-cases (176), oss-api-curl, oss-api-config-dir | all pass | 7 |
| T22 login/worktree | oss-value 340, worktree-hooks 8, value-file-wrappers-run 59 | all pass | 6 |
| T23 broken install | session-start-copy (+2) | 11/11 | 1 |
| T24 JSON/TEAM_ID | oss-fetch-team-iron-laws (+cases), session-start-notify-payload (new, 7) | all pass | 7 |
| T25 cache/backoff | oss-fetch-team-iron-laws 20, iron-laws-sync-safety 59, iron-laws-sync 8 | all pass | 9 |
| T26 flaky/unbounded | metrics-collector (fake timers, exact), complete-bounds case 7 | 10/10 ×11 under load, 9/9 | 6 |
| T27 esbuild | npm audit 1 moderate → 0; build output byte-identical | vitest 3585/3585 | n/a (RED = advisory) |

Known not-RED-first: T22's refused-apiUrl case (guarded by mutant M1); T27 (dependency bump, RED is the advisory).

### /oss:integration after the round-1 fixes (2026-10-30)
New `hooks/__tests__/oss-login-team-laws.real.integration.test.sh`: real curl against python3 recorders on loopback
(opt-in set), 22/22 on 3 runs, under /bin/bash 3.2 and bash 5. Login: one keyed GET /api/v1/subscription/status,
key never in argv, config written to OSS_CONFIG_DIR keeping apiUrl, 401 writes nothing, no-opt-in loopback sends
nothing and prints the switch line. Team fetch: 200 caches body + .src, 500 serves same-API stale cache and writes
backoff, next run sends nothing; connection refused → default + backoff; server A's cache never served for B.
Mutants killed: key on argv, no backoff, .src ignored, 401 accepted, no switch line, no .src written.
Stub vs reality: no behaviour mismatch (trailing newline and doubled 000 on refused connection are read with tail).
Untested assumption: login reads the plan with `head -1` (compact JSON from the API today).

## Last Updated: 2026-10-30 by /oss:build (ship round 1 fix round T18-T27)

## Ship gate round 2 fix round (2026-10-30, T28–T33)

| Task | New / changed tests | RED | GREEN | Mutants |
|------|---------------------|-----|-------|---------|
| T28 | #213's own tests (decision-record, hooks-registration, watcher redaction) | n/a (upstream merge) | 3/3, 101/101, 25/25, 31/31 | n/a |
| T29 | tests-hermetic-env.test.sh (new); unsets in 43 test files | sentinel got 2 POSTs; guard 41 files flagged | 0 sentinel hits; guard 65/65+ | 2 killed |
| T30 | oss-config-one-object.test.sh (new); oss-api-url*, config-dir, sync-safety updated | 52/90 | 126/126 | 10 killed |
| T31 | session-start-no-hook-downgrade.test.sh | 29/36 | 36/36 | 9 killed; -O checks unguarded (no sudo) |
| T32 | oss-state-files-nofollow.test.sh (new) | 1/19 | 20/20 (×4) | 6 killed |
| T33 | oss-login-plan-text, oss-claude-md-template, login-config-dir (new); watcher session-start-hooks-copy (every hook a command runs is copied) | control codes reached terminal; 8/12; 6/7; copy guard named the new hook | 4/4, 12/12, 7/7, 5/5 | 13 killed |

Orchestrator fixes found by existing tests: no-model-text-in-failed caught a T33 placeholder in login.md (fixed, 34/34);
iron-laws-single-writer checked JSON parsing in the sync hook, which T30 moved to the shared reader (check now follows
the reader; mutant without oss_api_key fails 5/6).

Full suites after the round: watcher 268 files / 3606 tests pass. Shell 72/76 files pass (after the iron-laws-single-writer fix):
referenced-hooks-tracked and watcher-dist-fresh fail only because #213's and T33's new files are untracked (both pass
against a temp index with them added); ideate-template and no-telegram-command fail on origin/main too.
session-start-notify-payload: 10/10 consecutive runs 7/7 (the earlier mixed results came while T31 was editing the hook).

### /oss:integration after round 2 (real curl, local server)
New `hooks/__tests__/iron-laws-sync.real.integration.test.sh` 15/15 (3 runs): the key from the shared reader (jq and
node-only PATH, nested models/webhook objects) arrives as `Authorization: Bearer`, never in argv (`ps` while the request
is held); a two-document config sends nothing; the stamp is a regular file holding the apiUrl and a refresh within 24h
sends nothing (stale-stamp control); symlinked stamp and backoff leave their victims unchanged.
`oss-login-team-laws.real.integration.test.sh` Scenario 1c (23/23): plan control codes sent as JSON escapes never reach
the terminal (od over the output). 8 mutants killed. Mock vs reality: no mismatch. Notes: `--install` ignores the stamp
(the 24h skip is refresh mode only); NUL is dropped by bash `$(...)`, not by the filter.

## Ship gate round 3 fix round (2026-10-30, T34–T48, resumed after a Mac crash)

New test files: oss-config-read-safety (T35), oss-config-dash-path (T39), oss-config-one-read (T37),
oss-login-dash-path (T44), oss-config-dash-hooks (T47), session-start-outside-kill (T42/T48) and
lib/session-start-alias.sh. Extended: oss-json-field and oss-login-plan-text (T38), oss-claude-md-template (T34 case 9c,
T45 case 12), oss-login-key-argv (T40 case 3, T41), packages/cli-decrypt/test/strip-control.test.ts (T45, including the
bash ↔ TS full-code-point parity test), and 8 session-start test files routed through the alias (T48).

Each task went RED first. Mutants were run in private copies only: T35 4, T39 2, T37 15, T38 7/8 (the survivor was removed as
redundant, T46/D9), T41 1, T44 5, T45 9, T47 15, T42 5, T34 12 (1 survivor closed by case 9c), T40 6 (2 survivors
closed, 1 equivalent), T48 via the outside-kill guard (RED 6/14).

### Final runs (orchestrator, 2026-10-30 21:50 CST)
- watcher: 268/268 files, 3606 tests.
- shell: 80/84 files, run one at a time with /bin/bash. The 4 that fail: referenced-hooks-tracked and watcher-dist-fresh fail only
  on untracked files (cleared by the commit); ideate-template and no-telegram-command fail at 0fcb96f too.
- cli-decrypt: 26 files, 316 tests (from a scratch copy with node_modules linked; this worktree has none).
- No orphan processes after the runs.

### Unguarded (stated, not hidden)
- The real-curl integration test cannot see jq. Only the unit test's recording jq checks that the key is in no jq argv (T40).
- `chmod -- 600` in login is equivalent today (mktemp 0600 + umask 077). The 4 chmod `--` mutants in T47 and the T44 one
  are killed only by the GNU-coreutils pass, which reports SKIPPED where coreutils is missing.
- A test that starts session start in a new process group would escape the outside-kill guard (none does today).
- The shipped oss-decrypt binary (cli-decrypt-v1.2.4) and the tracked dist bundle do not have T45's stripping set; no
  test checks bundle against source.

## Last Updated: 2026-10-30 21:50 CST by /oss:build (ship round 3 fix round T34–T48)
