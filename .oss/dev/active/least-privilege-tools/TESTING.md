# Testing: least-privilege-tools (R-266)

## Strategy
- **Acceptance (Task 2):** `agents/__tests__/agent-tools.test.sh`; new cases in `watcher/test/cli/tool-gate.acceptance.test.ts`; `watcher/test/cli/gate-run-check.acceptance.test.ts`.
- **Unit:** rule file `gateAgents`, hook input agent field, `gate-agent-write` rule, offload arguments.
- **Integration (real git repos, real symlinks):** `gate-agent-write.integration.test.ts`, `gate-run/snapshot` and `gate-run/compare`.
- **API (sprint branch):** delegation rows, no `tools:` in served agent headers.
- **Live, by hand:** `agents/__tests__/agent-tools.live.sh` (gate Edit refused, builder Edit applies), result recorded below.

## How to run (targeted only)
- Never the watcher full suite: its setup kills every OSS process on the machine. Run `cd watcher && npx vitest run <files>`.
- Shell tests: `bash <path>.test.sh`.

## Results (2026-11-11, build)
- **Acceptance, RED first (8b40258):** agent-tools 4 of 7 failing for the stated reasons; tool-gate R-266 refusals 4 failing with exit 0 instead of 2; gate-run file failing on the missing module. All now pass.
- **Plugin, watcher targeted run** (test/tool-gate, test/gate-run, test/hooks, test/agents, tool-gate acceptance/cli/speed, gate-run acceptance, agent-offload, models-offload-warning, utils/gate-agents, integration/agent-model-routing): **109 files, 4,431 tests, all pass.** `tsc --noEmit` clean.
- **Plugin, shell:** agent-tools 7/7, agent-frontmatter 5/5, code-simplifier 6/6, agent-offload-step 5/5, bash-blocks-allowlisted 8/8, oss-gate-run 9/9, hooks-registration 33/33, referenced-hooks-tracked 50/50, watcher-dist-fresh PASS (122 tracked .js).
- **Speed (Task 9):** gate in-process median 16.4 ms (max 18.6; bound 100); end-to-end median 81.4 ms (max 92.5; bound 300). Tree check on this repo (1,814 files): start ~240 ms (545 ms cold), stop ~238 ms; hook timeout 10 s.
- **Three pinned tests updated (5d145b2)**, each keeping its purpose: hooks-json-tool-gate (pre-existing entries still pinned; gate-run entries pinned separately), offload-step-safety (identity kept apart from the review/builder sentence), provenance (gateAgents in base settings).
- **API (sprint branch worktree):** security-delegation-rows + agent-headers-no-tools 6/6; prompt tests reading these files (no DB) 145/145 after the manifest re-sign; `manifest:verify` 138 prompts match. DB-backed `test/prompts.test.ts` not run.
- **Live row (`agents/__tests__/agent-tools.live.sh`, Claude Code 2.1.322, this branch via `--plugin-dir`): 5/5.** Review agent's Edit refused; builder's Edit applied; review agent's `echo > target.txt` refused and the refusal names `gate-agent-write`; review agent's `python3 -c` write voided the review. Separately: the pen tester lists WebFetch and WebSearch with its narrow `tools:` (the fetch stopped only at the headless permission prompt).
- **No `.skip`/`.only`/`.todo`** added (the hits in tool-gate tests are test strings the focused-test rule checks).

## Integration (2026-11-11, /oss:integration)
- Mocked boundaries checked against reality: hook input `agent_type`/`agent_id` (probe P1 + live gate refusals with real `oss:code-reviewer`), SubagentStart/SubagentStop/Agent PostToolUse shapes (probe + live foreground and background runs), offload `--disallowedTools` (probe P4). Everything else in the feature's tests already runs on real git repos and real symlinks.
- **Found:** a false void in a live background run: OSS's own hooks write `.oss/dev/timeline-unfiled.ndjson`, logs and workflow state during every run. Fixed by leaving out top-level `.oss/` (ADR-010, user's pick; 5c20f67), tests RED then GREEN.
- **Live row re-run: 8/8** (adds a clean-review control: not voided, no void record; and a background review run's script write voided at its real end).

## Build rewrites a tracked file (2026-11-11, after integration)
- Heads-up: ship's code-reviewer runs the plugin build, and the build rewrote tracked `watcher/dist/cli/oss-launch.cjs` (stale embedded version 2.0.97 vs plugin 2.1.2), which would void that review.
- First fix (614e547) rebuilt and committed the bundle with a freshness test; heads-up: that test fails on every version bump until rebuilt. Replaced (dcd0fc2): bundle untracked and gitignored (only the binary workflow ships it, built from source).
- `watcher/test/hooks/oss-launch-dist.test.ts` (untracked + ignored): RED 2/2 before, GREEN after. Bundle tests + oss-launch proxy test 5 files / 9 tests pass; watcher-dist-fresh PASS; referenced-hooks-tracked 50/50.
- Version-bump check: plugin.json set to 9.9.9, `npm run build`, snapshot (same temp-index `write-tree` the review check uses) before and after is identical; plugin.json restored.

## Ship round 1 (2026-11-12, /oss:ship)
- **Gates:** all four FAIL (code-review M2 L3 I2; performance H2 M2 L2 I1; security H2 M3 L6; pen-test H2 M4 L3 I1). Fixes per user picks: ADR-011 (only OSS run files left out of .oss/), ADR-012 (fail closed, notices to the model, git state + nested repos + node_modules in the fingerprint, 7 s budget, both repos), ADR-013 (read-only git, launchers, installs, ln, offload name, GIT_* vars for review agents). API dev-dependency advisory: user-chosen follow-up.
- **Tests, RED then GREEN** (two typescript-pro agents): new gate-run suites (fingerprint 38, run-store, messages; acceptance rewritten with a temp HOME), gate-agent-write unit + acceptance (~160 new cases), command-reader `backgrounded`/`wrappers`. Two bugs found on the way, each with a regression test: racy-git same-second edit missed with a copied index; `git add` failing when an exclude pathspec names a gitignored run file.
- **Targeted run:** 117 files / 4,846 tests pass; tsc clean; shell: agent-tools 7/7, oss-gate-run 16/16, watcher-dist-fresh PASS, hooks-registration 34/34, referenced-hooks-tracked 50/50, timeline.acceptance 8/8, agent-offload-step 5/5, agent-frontmatter 5/5. Tool-gate speed: in-process median ~15 ms, end to end ~78 ms.
- **Snapshot timing through the real hook:** this repo start ~420-440 ms, stop ~500-700 ms (with watcher/node_modules); synthetic 100k-file repo ~1-1.4 s (was 12-25 s).
- **Live probe:** SubagentStart/Stop, subagent PostToolUse and main-agent PostToolUse all carry the same session_id; main-agent calls have no agent_id.
- **Live row re-run: 9/9** (adds: a background review's void reaches the main agent on its next tool call; a review agent's `git commit` is refused, HEAD unchanged).

## Ship round 2 (2026-11-12, /oss:ship)

- **Gates:** all 4 FAIL (code review high=2 medium=1 low=4; security high=1 medium=4 low=4; pen test high=3 medium=4 low=4 info=1; performance high=2 medium=1 low=1). Fixed per ADR-012/013 round-2 notes; limits in FOLLOWUPS. FIX_BASE 9ea4867, FIX_HEAD 22a9d49.
- **Tests, RED then GREEN** (two typescript-pro agents): gate rule 114 new unit cases + 12 acceptance cases (8 sample attacks allowed by the old bundle, refused by the new one); review check: ledger, per-notice files, staged index, ctime/inode, new ignored paths, filters, private object store, user git config, FIFO (RED was a real hang), big files.
- **Targeted run:** 52 files, 4,383 tests passed (`cd watcher && npx vitest run test/tool-gate test/utils/gate-agents.test.ts test/cli/tool-gate.*.test.ts test/gate-run test/cli/gate-run-check.acceptance.test.ts test/hooks/{gate-run-dist,hooks-json-tool-gate,context-gate-removed,oss-launch-dist}.test.ts`); `npm run build` and `tsc --noEmit` clean; shell: oss-gate-run 19/19, hooks-registration 34/34, timeline acceptance pass.
- **Speed:** gate in-process median 15 ms, end-to-end 80 ms. Review check through the real hook: this repo start ~0.4-0.8 s / stop ~0.3-0.4 s; 100k tracked files ~0.7-1.3 s; 160k-file node_modules ~1.2-1.8 s (snapshot 2.6 MB); a 300 MB untracked file by stat, `.git/objects` unchanged.
- **Live row re-run: 9/9** (case 6 confirms live that the session-scoped main-post fast path delivers a background void).

## Ship round 3 (2026-11-12, report only)

- **Gates:** all 4 FAIL (code review medium=2 low=1 info=3; security high=1 medium=2 low=2 info=1; pen test medium=1 low=3 info=3; performance high=1 medium=1 low=1 info=3). Key: `xargs`/`find -exec` operands bypassed the gate (forged snapshot end to end); ~15 plain-shell bypasses; untracked files re-added into an empty object store (20k files → 8 s → unverified); 32-thread pool slowed parallel reviews. User pick: "Keep fixing: allowlist" (ADR-014).

## Fix round 4 (2026-11-12)

- **FIX_BASE** 22a9d49 → **FIX_HEAD** c5ef3d4 (29 files, +2868/−419).
- **Gate rule:** allowlist (~120 usual checks across all stacks allowed, ~50 write forms refused, table-tested); user additions from `~/.oss/config.json`; own setup steps matched line for line (each agent file's bash blocks sent as that agent: allowed); options before subcommands (`mvn -q test`, `black src --check`); pen-tester exception reads option values as paths; `~/.oss/**`, `~/.claude/**` off-limits; HOME= then `~` writes refused for every agent; extra session repos refused like the project repo.
- **Review check:** untracked files hashed without writing (20k untracked: start ~1 s, was 8 s); thread-pool override gone; no void on new ignored output; forged `unverified` never silent; session ledger; SendMessage continuation = new segment (live probe: SubagentStart/Stop fire again, same agent_id); stdin session id; symlinked node_modules walked; untracked nested repos by HEAD only (ADW start 2.1-3.8 s, was 4-5 s); `oss-value.sh review-repo` (364/364 oss-value shell tests).
- **Targeted run:** 52 files, 4,799 tests passed; `npm run build`, `tsc --noEmit` clean; shell: oss-gate-run, hooks-registration, timeline acceptance, oss-value, oss-value-api pass. After the options fix: tool-gate 42 files, 4,675 passed; speed median 17 ms in process, 83 ms end to end.
- **Live row: 11/11** (adds case 8: a review agent continued with SendMessage is checked again, no false tamper).
- **API:** ship prompt names extra repos (Step 1); manifest re-signed, verifies; ship-related prompt tests 2,016 passed (one file needs a Prisma client, not loadable here). First API run failed with ENOSPC (disk full, 228 MB free); cleared by `cargo clean` of idle ELI.IO and meshnet targets (~50 GB).

## Ship round 4 (2026-11-12, full re-check)

- **Gates:** code review FAIL (high=1 medium=3 low=3 info=1); performance PASS (low=1 info=3); security FAIL (high=2 medium=1 low=3 info=1); pen test FAIL (critical=2 medium=1 low=1). Key: allowlisted programs still write or exec (`sort -o`, `uniq IN OUT`, `xxd -r`, `rg --pre`), and runners (`npx`, `uv run`, `bundle exec`) hide their inner program's writes, so a review agent could write `~/.oss/config.json` and add its own allowed programs; entry match is a prefix (`mvn test deploy`); the code-reviewer's own `git symbolic-ref` step is refused. Fix round 5 from FIX_BASE c5ef3d4.
- **Known limit (performance LOW):** on a heavily loaded machine, a 150-200k-file dependency tree can push the review check past its 7 s budget. The run then reports "unverified" and the ship stops; it never passes silently or hangs. A larger thread pool measured slower, so this is recorded rather than fixed.

## Ship round 5 (2026-11-12, /oss:ship)

- **FIX_BASE** c5ef3d4 → **FIX_HEAD** 52fa248.
- **Gates:** code review FAIL (high=4 medium=6 low=4 info=3); performance FAIL (critical=1 high=1 low=1 info=2); security FAIL (high=7 medium=3 low=2 info=3); pen test PASS (info=1).
- **Fixed:**
  - call-variable fail-open;
  - `sort --out` prefix;
  - `go --exec`;
  - `find -exec`;
  - sandbox writes to `~/.oss`.
- **User picks applied:** layer 2 covers the user files; fix the gate holes in this ship; builder Step 0 offload fix in this ship.
- **API:** the served ship, ship-team and review-team perf gate now routes to performance-auditor. Manifest re-signed.

## Ship round 6 (2026-11-13, /oss:ship)

- **FIX_BASE** 52fa248 → **FIX_HEAD** 8520756.
- **Gates:** code review FAIL (medium=4 low=5 info=5); security FAIL (critical=1 high=1 medium=3 low=3 info=3); pen test FAIL (high=1 medium=1 low=1 info=2); performance FAIL (critical=2 medium=1 low=1 info=3).
- **Key findings:**
  - two new fail-opens in performance;
  - a PATH-shadowed `node` silenced both layers (security, critical);
  - layer 2 was too narrow for the pen test and security.
- **User pick:** layer 2 narrowed to "Only what steers the gate".
- **Verified before the re-check:** 55 files, 5,373 tests; build and tsc clean; all shell suites green.

## Ship round 7 (2026-11-13, /oss:ship)

- **FIX_BASE** 8520756 → **FIX_HEAD** 98e34cc.
- **Gates:** code review FAIL (high=2 medium=5 low=4 info=2); pen test PASS (info=1); security FAIL (critical=2 high=5 medium=3 low=2 info=3); performance FAIL (critical=1 medium=1 low=4 info=3).
- **Counts source:** these counts come from the memory note. Round 7 timeline lines were not written.
- **Key findings:** PATH git; node-path swap; SessionStart re-adopt; FIFO hang in the events log; repo `.claude/settings.local.json`; detached writer; node dylibs. Performance: the CDPATH regex was cubic (13.5 KB input put builder and main calls into fail-open).
- **Fixed:** gate rule, gate-run and API agent fixes. The oss-value review-repo path now also uses the fixed node.
- **Verified:** 57 files, 5,595 tests; build and tsc clean; shell suites green. `referenced-hooks-tracked` was 50/51 until `oss-node-path.sh` was staged.
- **User picks:**
  - node-path "Record on first use" (queued for round 8);
  - "OS sandbox for reviewers" (done in round 8).

## Ship round 8 (2026-11-13, /oss:ship)

- **FIX_BASE** 98e34cc → **FIX_HEAD** tree 24bdb4a.
- **Gate verdicts:** see "Ship round 8 results" below.
- **Part A (sandbox and tool gate):** 51 files, 5,516 vitest tests green. tsc clean.
- **Part B (gate run and hooks), shell suites:**
  - oss-gate-run 35/35;
  - oss-node-path 16/16;
  - oss-value 368/368;
  - oss-value-api 131/131;
  - timeline 8/8;
  - hooks-registration 35/35;
  - session-start suites green.
- **Monitor matcher:** added to `hooks.json` test-first. The tool-gate PreToolUse matcher is `Bash|Edit|Write|MultiEdit|NotebookEdit|Monitor`.
- **Fixed in part A:**
  - macOS: a review agent's Bash is wrapped in `sandbox-exec`, after a self-test of the profile on each call;
  - Monitor is refused for review agents;
  - the Linux fallback refuses inline interpreters and scripts from temp;
  - CRITICAL and LOW-2: a linear expansion scanner replaces the regex that ran without end;
  - MEDIUM-1: a write after cd/pushd/popd is refused unless joined by `&&`;
  - MEDIUM-2: long options such as `*output*` must name temp;
  - LOW-1: candidates are capped at 4096;
  - M4: when the gate cannot answer, a review agent is refused;
  - HIGH-2: the event log is never a pipe, with a 4 s watchdog;
  - the gate reads git from a fixed path.
- **Fixed in part B:**
  - the survivor check is dropped;
  - node is recorded on first use;
  - a changed node fails closed for review agents;
  - no node fails closed for review agents;
  - git and the core programs use fixed paths;
  - repo `.claude` settings are fingerprinted;
  - the log append is FIFO-safe;
  - bundles are keyed by content.
- **Known limits:**
  1. Docker and kubectl fail inside the sandbox. The docker socket is denied by design, and kubectl cannot read `~/.kube/config`.
  2. Wrapped calls run under `/bin/bash`, not zsh. zsh-only syntax fails.
  3. A review agent's own setup steps (decrypt, offload) are not sandboxed.
  4. The MEDIUM-1 rule is broad: it also refuses an absolute-path write after `cd x;`.
  5. Cargo needs a committed lockfile or `--locked`.
  6. Linux has no sandbox. Only the interpreter fallback applies.
- A full verification run is pending. No gate verdicts exist for round 8 yet.

## Ship round 8 results (2026-11-13, /oss:ship)

- **Pen test:** PASS (L1).
- **Code review:** FAIL (H2 M5 L3 I3).
- **Security:** FAIL (H3 M3 L2 I5).
- **Performance:** FAIL (C1 H1 M1 L1 I3).
- Fixed in round 9 (below). The round-8 "Known limits" 1 (docker and kubectl fail in the sandbox) is replaced by D-R9-5.

## Ship round 9 fixes (2026-11-13, /oss:ship)

- **FIX_BASE** 24bdb4a (round 8 FIX_HEAD).
- **Part B (parser, hooks, gate run):**
  - classEnds is linear. `echo ` + `[[:`×1000 + ` >/dev/null; git push --force origin main` was allowed unchecked after 2.6 s; it is now refused in 97 ms. `[`×25000 takes 105 ms. `git status` is unchanged at about 80 ms. A 300k-word random comparison of old and new showed 0 differences.
  - D-R9-4 in place: builders and main are refused on timeout (ADR-025).
  - expansion-scan treats an unterminated index longer than 256 characters as a set (fail closed).
  - is_review_agent: 3,000 keys went from 8.86 s to 64 ms. More than 4 matches means a review agent.
  - The watchdog trap kills its sleep (`exec /bin/sleep`).
  - oss-gate-run OUT_FILE moved to `~/.oss/run/gate-run/` and never falls back to TMPDIR.
  - timeLeft() bounds spawnSync calls.
  - Suites: oss-gate-run.test.sh 37/37.
- **Part A (sandbox, read gate, rules):**
  - SEC HIGH-1: a temp Unix socket is refused (allowlist, ADR-022).
  - SEC HIGH-2 and CR M4: credential files and env are hidden (ADR-022, ADR-023).
  - CR H1 and SEC M3: private per-session folder (ADR-022).
  - CR H2 and SEC H3: in the fallback, `node --test` gets an option allowlist (node's own reporters only, repo paths, output to temp).
  - SEC L2: tool output options are temp-only.
  - SEC M1: offload folder created directly in temp, 0700, owner-only, not a link; prompt.md is a regular file with one link.
  - CR M1: Claude Code sandbox detection (no nested wrap; fallback rules).
  - CR M2 and M3: CLANG_MODULE_CACHE_PATH and PYTEST_ADDOPTS in the cache env.
  - CR L2: the npm script refusal names the script.
  - CR L1: gh refused inside the sandbox with "ask the main agent"; still works in the fallback.
  - D-R9-2: Read, Grep and Glob gated for review agents (ADR-023).
  - D-R9-3 (ADR-024) and D-R9-5 (ADR-026) in place.
- **Stacks run inside the sandbox:** git, rg/grep, npx vitest, npm test, pytest (filterwarnings=error), ruff, go test, cargo test --locked, curl (`https://registry.npmjs.org` returns 200; a planted socket in /private/tmp is refused).
- **Suites:** review-round9 91/91; sandbox.integration 24/24; acceptance plus rules plus cli 4281/4281; failure plus cli 21/21.
- **Round-9 re-check:** next (`/oss:ship` round 9 gates).

## Accepted limits (round 9)

1. Swift, JVM/Gradle and .NET build or test: refused for review agents on macOS (D-R9-3, ADR-024). No review evidence for these stacks until the temp-copy card lands.
2. docker, docker-compose, podman, kubectl, helm and k9s: refused for review agents on macOS with a clear message (D-R9-5, ADR-026). Replaces round-8 limit 1.
3. Claude Code `excludedCommands` are not covered by the wrap.
4. A reviewer cannot run gh inside the sandbox (CR L1); the main agent does that work.
5. The `xcrun_db` warning from `/usr/bin/git` is harmless and printed only.
6. Round-8 limits 2 to 6 still stand (zsh-only syntax in wrapped calls, the review setup steps outside the gate, the broad MEDIUM-1 rule, cargo's lockfile need, Linux fallback only).

## Ship round 9 results (2026-11-13, /oss:ship)

| Gate | Verdict | Findings |
|---|---|---|
| pen-test | PASS | L1 (project .claude settings switch to fallback) |
| performance | PASS | M2 L1 I1 (protected-path speed; Read starting node for everyone; review-read depth; tick) |
| code review | FAIL | H1 M3 L3 I3 (nested-index CDPATH; flaky 300 ms test; read deny-list gaps; toolchain folders; stdout reporter; tsc message; TMPDIR out_file) |
| security | FAIL | H2 M3 L4 I5 (project folder = HOME or ~/dev readable in sandbox; firmlink Read bypass; Write/Edit anywhere in temp; clipboard; project settings → fallback; node --test profiles; launchctl print; detached processes; shared per-session folder; INFOs) |

## Ship round 10 fixes (2026-11-14, /oss:ship)

- **Part A (sandbox, read gate, rules):**
  - RED: 34/56 gate cases and 8/11 sandbox cases. Suites: 3063 run, then fixes, then green.
  - Real CLI, before → after: firmlink, other project, `~user`, `/.vol`, transcript and home-as-project reads 0 → 2 refused. Write to /tmp 0 → 2. `--cpu-prof` 0 → 2. The stdout reporter 2 → 0 (allowed). The tsc message now names `npx --no-install tsc --noEmit`.
  - Sandbox: clipboard empty (hash compare only), port 8473 bind denied, background job killed, project `.claude` settings ignored, transcripts denied.
  - Decisions: D-R10-1 (ADR-027), D-R10-2 (ADR-028), ADR-030.
- **Part B (parser, hooks, performance):**
  - Nested index: RED 9/22, now 22/22 (CR HIGH-1).
  - tick lookups 25,601 → under 102 (PERF INFO-1).
  - Protected-path speed, real CLI (main): `rm -f` of 1000 files 596 → 111 ms; `git add` of 1500 470 → 115 ms; `sed` with 1000 `-e` 605 → 108 ms; `git status` unchanged at about 84 ms.
  - Read fast path for main and builders: about 96 ms → 6 ms (PERF MEDIUM-2).
  - Old-vs-new equivalence on 16k paths: 4/4. Hook tests: 46/46.
- **Lost cd (ADR-029):** RED 4/15, now green. test/tool-gate plus acceptance: 5744/5744, run twice.

## Accepted limits (round 10)

1. `launchctl print` can show LaunchAgent environments. No profile rule blocks it; this Mac's agents hold no secrets today (SEC LOW-2).
2. A setsid-detached child survives the call (SEC LOW-3).
3. `D=src; cd "$D"` is refused (ADR-029). Follow-up LOW in FOLLOWUPS.
4. Bash writes in fallback mode still go to the temp roots. D-R10-2 covers only the Write and Edit tools.

## Round 10 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | PASS | 0 |
| Performance | PASS | L3 I3 |
| Code review | FAIL | C1 H3 M1 L3 I4 |
| Security | FAIL | C1 H1 M1 L3 I3 |

## Round 11 fixes

Each finding from the round-10 gates is fixed. Test file in brackets.

- **D-R11-1 (ADR-031):** narrow the lost-cd refusal and follow safe variables. Fixes CR CRITICAL-1 and CR HIGH-C [review-round11.test.ts (47), cd-variables, cwd-movers]. Served command blocks run as main agent and builder [served-commands.acceptance (3)].
- **SEC CRITICAL-1 (ADR-033):** symlink swap in the private folder. Fixed by the SYMLINK deny, the lstat check and the `node --test` limit [review-round11.test.ts (47), source-moves (42)].
- **SEC HIGH-1 (ADR-032):** firmlink in protected paths [firmlink-protected].
- **SEC MEDIUM-1 (ADR-032):** eval, alias, reassigned HOME, and `$(…)` or backticks in a write target [cwd-movers].
- **SEC LOW-1 and LOW-3 (ADR-033):** nested repos and other agents' review folders [review-round11.test.ts (47)].
- **SEC LOW-2 (ADR-033):** offload prompt.md bound to this agent's own mktemp folder [review-round11.test.ts (47)].
- **SEC INFO-2 (ADR-033):** NODE_V8_COVERAGE only in temp [review-round11.test.ts (47)].
- **CR HIGH-A (ADR-033):** worktree and submodule gitdirs readable, with sandbox integration cases [review-round11.test.ts (47)].
- **CR HIGH-B (ADR-032):** nested-index CDPATH and cdpath assignments fail closed [cwd-movers].
- **CR MEDIUM-A:** the saved-output refusal names the workaround [source-moves (42)].
- **CR LOW-A and LOW-B (ADR-033):** injectable homes and toolchain places [review-round11.test.ts (47)].
- **CR LOW-C:** protected-path-work counts clock reads only [review-round11.test.ts (47)].
- **CR INFO-2 and INFO-4:** privateDir passed to checkReviewRead; sandbox job orphans killed [review-round11.test.ts (47)].
- **ADR-034:** /oss:login status line written by a hook [hooks/__tests__/oss-statusline-settings.test.sh (12)], with auto-permissions (18) and session-start-copy (10).
- **PERF LOW-1, LOW-2, LOW-3, INFO-2:** protected-path speed, is_review_agent linear, Glob cap, and reviewed repo search [review-round11.test.ts (47)].

**Totals.** Targeted vitest: 61 files and 6171 tests green, run twice.

Full round-11 verify (2026-11-15, after the login hook):
- Build, bundle and tsc are clean.
- Targeted vitest: 77 files, 6,413 tests green.
- Shell suites green:
  - oss-gate-run 37/37, oss-node-path 16/16, oss-value 368/368, oss-value-api 131/131
  - timeline 8/8, hooks-registration 35/35
  - session-start-copy 10/10, session-start-no-hook-downgrade 41/41
  - oss-statusline-settings 12/12, auto-permissions 18/18
  - agent-tools 7/7, agent-frontmatter 5/5
  - watcher-dist-fresh
- referenced-hooks-tracked is 50/53 only because hooks/oss-node-path.sh, hooks/oss-statusline-settings.sh and its test are untracked until staged.
- commands ideate-template and no-telegram fail on the base too.

## Round 11 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | FAIL | C1 |
| Security | FAIL | C1 H1 L1 I1 |
| Code review | FAIL | H1 M3 L4 I3 |
| Performance | FAIL | M1 I1 |

## Round 12 fixes

One line per finding, with its test file.

Part A (sandbox, review places, login hook, test hygiene):
- SEC CRITICAL-A, disk image mount: DiskArbitration denied, hdiutil and mount paths denied (ADR-038). [sandbox-round12.integration.test.ts]
- Mount backstop after a review Bash call (ADR-038). [review-round12.test.ts]
- SEC INFO-A, Grep and Glob under the private folder: bounded lstat walk, links refused (ADR-038). [review-round12.test.ts]
- SEC LOW-A, CR M2, CR I2, login hook: HOME from the password database, fixed PATH, mode parsing, empty file as `{}` (ADR-039). [oss-statusline-settings.test.sh (16)]
- CR L2, tests read the real ~/.claude: injected homes in tool-gate.acceptance and the darwin cases of review-round9. [tool-gate.acceptance.test.ts, review-round9.test.ts]
- CR L3, API path in served-command-blocks.mjs: `OSS_API_REPO` env var, refuses to drop API entries when the checkout is missing, clear "API checkout missing" message. [served-command-blocks-script.test.ts]
- PERF MEDIUM-1, nested-repo scan: git-ignored folders skipped, cached, own timeout text (ADR-037). [nested-repos.integration.test.ts]
- PERF INFO-1, transcript rule: matches the transcript depth only (ADR-038). [review-round12.test.ts]

Part B (variables and write targets):
- D-R12-1, follow or refuse, covers pen CRITICAL-1, SEC HIGH-A, CR H1 and CR M3 (ADR-035). `tailMayBeProtected` fixed. [write-variables.test.ts, glob-match.test.ts]
- Bare unknown-variable writes stay allowed for main and builders, recorded as a limit (ADR-036). [write-variables.test.ts, "accepted limit"]
- CR M1, output options after an unknown cd: names match in any case, single-dash long options, `*dir` values as folders, prettier --write and eslint --fix (ADR-039). [write-variables.test.ts]
- CR L1, sourced plugin hooks: trusted only when the plugin root is outside a reviewed or writable repo. [source-moves.test.ts]
- CR L4, `follow` defaults to false, global grant removed, review agents never follow (ADR-039). [write-variables.test.ts]
- SEC LOW-A, gate side: HOME=, PATH= and env prefixes refused on `~/.oss/hooks/*` calls, for every agent (ADR-039). [oss-hook-env.test.ts]
- CR L2 for part B: cd-variables, cwd-movers and source-moves use a scratch HOME. [cd-variables.test.ts, cwd-movers.test.ts, source-moves.test.ts]

Part B final run: 70 files, 6,453 tests green. review-round12 passed 10 of 10 runs in a row.

### Watch
- One earlier one-off "could not finish checking" failure in review-round12 happened while parallel test runs loaded the CPU. It was not reproduced. It is not fixed. See FOLLOWUPS (round 12).

Full round-12 verify (2026-11-16):
- Build, bundle and tsc are clean. No new untracked dist files.
- Targeted vitest: 83 files, 6,680 tests green.
- Shell suites green:
  - oss-gate-run 37/37, oss-node-path 16/16, oss-value 368/368, oss-value-api 131/131;
  - timeline 8/8, hooks-registration 35/35, watcher-dist-fresh;
  - session-start-copy 10/10, session-start-no-hook-downgrade 41/41;
  - oss-statusline-settings 16/16, auto-permissions 18/18;
  - agent-tools 7/7, agent-frontmatter 5/5.
- referenced-hooks-tracked is 50/53, only because three new hook files are untracked until staged.
- commands ideate-template and no-telegram fail on the base too.

## Round 12 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | PASS | I2 |
| Performance | PASS | L2 I1 |
| Code review | FAIL | H1 M1 L4 I2 |
| Security | FAIL | L1 I2 |

## Round 13 fixes

One line per finding, with its test file. Each fix is test-first (RED, then GREEN).

Part A (nested repos, mounts, sandbox, gate.ts):
- D-R13-1, nested-repo cache removed; asked fresh on every call. Fixes SEC LOW (forgeable cache), CR L-b and PERF INFO-1 (stale cache) (ADR-040). [nested-repos.integration.test.ts, rules/review-round13a.test.ts]
- CR I-a, the index is streamed; only gitlinks (mode 160000) are kept. A 70k-entry index no longer fails closed (ADR-040). [nested-repos.integration.test.ts]
- PERF LOW-2, CR L-c and SEC INFO-2, mount backstop: the post call reads the mount table first, on its own cap; an unreadable table voids the run; a nested-repo check that uses up the post call's time still leaves the table read (ADR-041). [rules/review-round13a.test.ts]
- D-R13-2, only mounts new since the first pre call void the run; a mount exactly at the repo root voids the run; the baseline is write-once (ADR-041). [rules/review-round13a.test.ts]
- SEC INFO-1, `/Library/Filesystems` in the sandbox exec deny (ADR-041). [rules/review-round13a.test.ts, sandbox-round12.integration.test.ts]
- CR L-d, sourced plugin hooks trusted only under a protected path (ADR-042). [source-moves.test.ts]

Part B (command reader, variables, rules):
- CR H-1, zsh modifiers and subscripts (`$X:h`, `$X[…]`, `${X:…}`, `$dirstack[…]`) in write and cd targets fail closed under both shells (ADR-042). [zsh-forms.test.ts, write-variables.test.ts]
- CR M-1, arithmetic in harmless commands: `test -v`, `printf` with `--NAME`, and `plainMentions` after a dash (ADR-042). `printf` is dropped from HARMLESS_COMMANDS. [harmless-arithmetic.test.ts]
- CR L-a, oss-hook-env decides from parsed words: brace forms and `path=(…)` are refused; a comment that mentions HOME is allowed (ADR-042). [oss-hook-env.test.ts]
- CR M1 leftovers, output options: `--output_file`, `--outputPath`, `--report-dir`, `--coverage-dir`, `--declarationDir`, `prettier -w` (ADR-042). [write-variables.test.ts]

Pinned accepted limit:
- `X=$(echo .git/config); echo x > "$X[1,-1]"` counts as a bare target under ADR-036, so it is allowed. It is pinned as an accepted-limit case. [zsh-forms.test.ts]

Part A and part B runs: 78 files and 6,759 tests green after the rebuild.

### Round 13 open items

- PERF LOW-1 (parallel cold scans on huge untracked folders) is accepted under ADR-040.
- CR I-b (a user's own `cd` alias from the zsh snapshot) is noted only.

Full round-13 verify (2026-11-16):
- build, bundle and tsc are clean, with no new untracked dist files;
- targeted vitest: 86 files, 6,825 tests green;
- shell suites green as in round 12, including oss-statusline-settings 16/16;
- referenced-hooks-tracked is 50/53, only because three new hook files are untracked until staged;
- commands ideate-template and no-telegram fail on the base too;
- no orphan processes after the run.

## Round 13 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | PASS | I1 |
| Performance | PASS | L1 I3 |
| Code review | FAIL | H2 L4 I3 |
| Security | FAIL | C1 H3 L2 I2 |

## Round 14 fixes

One line per finding, with the test file that proves it. Each fix is test-first (RED, then GREEN).

Part A (sandbox, mounts, nested repos, hooks):
- SEC CRITICAL-1, the review sandbox denies `file-mount` and `file-unmount`. A direct mount(2) gets EPERM (ADR-043). [sandbox-round14.integration.test.ts]
- D-R14-1, the mount baseline is Linux-only. macOS voids on any mount at or under a watched place (ADR-043). [sandbox-round14.integration.test.ts, rules/review-round14a.test.ts]
- CR LOW-4 and SEC LOW-1, the Linux baseline compares (device, mount point) as a multiset. A baseline mount that disappears voids the run (ADR-043). [rules/review-round14a.test.ts]
- CR LOW-2, the mount table is read before the post deadline. A 1.2 s read is judged on the mounts, not voided for time (ADR-043). [rules/review-round14a.test.ts]
- CR LOW-3, the review-round13a test near line 277 now asserts that the slow seam is called. [rules/review-round13a.test.ts, rules/review-round14a.test.ts]
- CR INFO-1, watched places are repo top folders, git folders, the private folder and the protected places. `ctx.root` is no longer added by default (ADR-043). [rules/review-round14a.test.ts]
- SEC LOW-2 and PERF INFO-C, the hook writes the run's tamper mark when a review post call fails (kill 143, no answer, no node, crash). It uses the CLI's mark format (ADR-043). [test/hooks/oss-tool-gate.test.ts]
- D-R14-2, the two nested-repo git calls run side by side. Each gets the remaining decision time, at most 1000 ms. The timeout text is updated (ADR-044). [nested-repos.integration.test.ts]
- PERF INFO-D, the `160000 ` prefix is checked on the raw bytes before `toString` (ADR-044). [nested-repos.integration.test.ts]
- CR INFO-2, temp folders live under `$TMPDIR/oss-nested-<uid>`. Folders older than 10 minutes are removed at the start of a scan (ADR-044). [nested-repos.integration.test.ts]
- CR INFO-3, the orphan `sleep 300`. The token now sits in the sleeper's own arguments. The test also checks that the process group is gone. [tool-gate.cli]
- Flaky "same moment" K2 test (watch item): root cause was the test, not the CLI. Each test wrote a new fake git and ran it once inside its own 5 s limit; macOS checks a new program on first run (about 0.4 s, 3.1 s under load). The fake git is now written and warmed once in `beforeAll`. perl also read git's `-c` flags as its own switches, so the sleeper never ran; it is now `perl -e 'sleep 300' -- "$@"`. Both K2 tests fail when the CLI's `killGroup` is removed. 20/20 passes, 10 under 8x CPU load. [tool-gate.cli]

Part B (command reader, variables, rules):
- CR HIGH-1, zsh glob qualifiers and `${(` parameter flags are refused for the main agent and builders (ADR-046). [round14-shell-forms.test.ts]
- CR HIGH-2 and SEC HIGH-1, `~+`, `~-`, `~N`, `~+N`, `~-N` and `~[…]` make the head unknown (ADR-046). [round14-shell-forms.test.ts]
- SEC HIGH-2, a shell option the gate does not model makes the folder and variables unknown. An allowlist covers the options served blocks use (ADR-046). [round14-shell-forms.test.ts]
- SEC HIGH-3, a value with wildcard characters, used unquoted, is treated as a wildcard (ADR-046). [round14-shell-forms.test.ts]
- CR LOW-1, indirect names: `printf -v`, the `declare` family, `-n` namerefs and `${(P)…}` count as HOME or PATH setters (ADR-046). [round14-shell-forms.test.ts]
- SEC HIGH-2 follow-up: a nested `zsh`/`bash`/`sh` started with an option the gate does not model (`-o name`, `--name`, letters, bash `-O`, also through `env`) reads its `-c` script with the folder and variables unknown (ADR-046). [round14-shell-forms.test.ts]
- cp/mv/ln/install/ditto/rsync into a folder that holds protected files (`cp x .git/hooks`) is refused (ADR-046). [round14-shell-forms.test.ts]
- Protected-path speed: `placesOf` and `prefixForms` are deduped. The run makes 1530 clock reads, under the 2000 bound. [protected-path-work]

Part C (gate state folder, ADR-045):
- SEC INFO-1, gate run state moves from `~/.oss/run/gate-run/` to `~/.oss/gate-state/` (0700, a symlinked root is refused). Tamper marks and baselines are protected for the main agent and builders. [tool-gate.acceptance (round 14 C block), run-store.integration]
- The served /oss:plan clean-up still runs. served-commands.acceptance stays green. [served-commands.acceptance]

Type checks:
- The 14 test type errors are fixed, so `tsc -p tsconfig.test.json` is clean. Fixes are in test code only: `wouldClean` added to the GitReader test doubles, a null guard on `g`, an unused `@ts-expect-error` removed, and a tuple index and a `never` access fixed.

Full round-14 verify (2026-11-16):
- build, bundle, tsc and tsc -p tsconfig.test.json are clean, with no new untracked dist files;
- targeted vitest: 89 files, 7,018 tests green;
- shell suites green as in round 13;
- referenced-hooks-tracked is 50/53 (three new hook files are untracked until staged);
- commands ideate-template and no-telegram fail on the base too;
- no orphan processes and no mounts after the run.

## Round 14 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | PASS | L1 I1 |
| Performance | PASS | L1 I2 |
| Code review | FAIL | H2 M1 L4 I3 |
| Security | FAIL | H2 M1 I2 |

## Round 15 fixes

One line per finding, with the test that proves it. Each fix is test-first (RED, then GREEN).

Part B (tokenizer, command reader, variables, rules):
- SEC HIGH-A, a `trap` first operand is read as a nested script (ADR-051). [round15-shell-forms.test.ts]
- SEC HIGH-B, `emulate … -c '…'` is read as a nested script; `functions[…]=` and `sched` are unreadable, also with the `builtin`, `command` and `noglob` prefixes (ADR-051). [round15-shell-forms.test.ts]
- CR HIGH-1, `noglob`, `nocorrect` and `-` are cd prefixes; `repeat N`, `enable -n cd`, `disable cd` and `unfunction cd` make the folder unknown (ADR-051). [round15-shell-forms.test.ts]
- CR HIGH-2, an unknown variable next to a wildcard in the same segment is checked as `*<rest>` (ADR-051). [round15-shell-forms.test.ts]
- SEC MEDIUM-A, a literal-set variable is followed wherever it sits in the word; unquoted wildcards in an unknown tail stay patterns; a literal prefix with an unknown end counts as unknown when it could match a protected path (ADR-051). [round15-shell-forms.test.ts]
- CR MEDIUM-1, `${~X}`, `${=X}` and `${^X}` are unreadable (ADR-051). [round15-shell-forms.test.ts]
- PEN LOW-1, a setter value that starts with `$HOME`, `${HOME}` or `~` resolves to the home folder before the protected-path check (ADR-051). The served /oss:plan sweep stays allowed. [round15-shell-forms.test.ts]
- CR L1, `mapfile` and `readarray` with a name, zsh `set -A` and `set +A`, and arithmetic with a `$` count as HOME or PATH setters (ADR-051). [round15-shell-forms.test.ts]
- CR L2 (empty reason), `options[cdablevars]=on` is refused with a reason. [round15-shell-forms.test.ts]
- ADR-050, a double-quoted or unquoted `trap` string is expanded before it is read; an unknown value inside it is refused. [round15-shell-forms.test.ts]
- D-R14-4, bash extended patterns, extendedglob and the common shell options (ADR-047). [round15-shell-forms.test.ts]

Part A (gate.ts, mounts, nested repos, hooks):
- CR L3 and ADR-049, on Linux a mount above a watched place is compared with the baseline; on macOS there is no above-mount check. [rules/review-round15a.test.ts]
- CR L2 (message), the gate.ts message says `~/.oss/gate-state`. [rules/review-round15a.test.ts]
- CR I2, the CLI answer file moves under the protected `~/.oss/gate-state` through `oss_gate_state_dir`; the main-post fast path stays free of subprocesses. [test/hooks/oss-tool-gate.test.ts]
- CR I3 and PERF INFO-2, the mount-table read is capped at 1.2 s, under the 2.5 s hard limit. [rules/review-round15a.test.ts]
- PERF INFO-1, nested-repo git runs go through the tracked runner, each in its own process group. On TERM, every live git group is killed, and the `out` file is unlinked right after it is opened. [test/cli/tool-gate-nested-term.test.ts]

Flake fix:
- git-reader.integration, "should end git and every program it started when git runs past its time limit": the reader's 1 s limit started while the fake git was still starting up. The test now fakes only setTimeout and clearTimeout, checks that the child is alive at 999 ms, then gone 1 ms later. 20/20 runs pass, 10 of them under load.

PERF LOW-1, limit text: the cost grows with files times parallel calls. The text is in ADR-044 and FOLLOWUPS.md.

Newly refused and newly allowed (from ADR-047, ADR-050 and ADR-051):
- Newly allowed: `!(test)`, `!(node_modules)`, `set -o vi; echo x > out.txt`, `setopt extendedglob; echo x > out.txt`, and the `set -o`, `setopt -o` and `setopt +o` name forms.
- Newly refused: `!(tests)` and `!(esxs)` (qualifier-like); a qualifier list holding `+`, `:`, `#` or `(`; a double-quoted trap with an unknown value (use single quotes); `echo x > ".oss/$X"`; `${~X}`, `${=X}` and `${^X}`; `functions[…]=`, `sched`, `repeat N`, `enable -n cd` and `disable cd` (the folder becomes unknown).
- Still refused: `set -a; . .env; set +a; echo x > out.txt` (a file run with `.` or `source` makes the folder unknown, under the round-11 rule).

Full round-15 verify (2026-11-16, run after another session's CPU load loops ended):
- build, bundle, tsc and tsc -p tsconfig.test.json are clean, with no new untracked dist files;
- targeted vitest: 92 files, 7,253 tests green;
- shell suites green as in round 14;
- referenced-hooks-tracked is 50/53 (three new hook files are untracked until staged);
- commands ideate-template and no-telegram fail on the base too.
- Note: an earlier run under a load average of about 320 (110 orphaned perl loops from another session) failed 11 timing tests; it was discarded, not retried as a pass.

## Round 15 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | PASS | I1 |
| Performance | PASS | L1 I1 |
| Code review | FAIL | H1 M2 L1 I4 |
| Security | FAIL | H1 I2 |

Review-agent containment held in all four gates. Under ADR-048, the failures were bugs in round-15 code:
- security HIGH-1: trap, emulate, sched and functions[] scripts holding a `$` were not treated as risky;
- code-review HIGH-1: extendedglob `^` and `~` were read as `*`.

## Round 16 fixes

One line per finding, with the test that proves it. Each fix is test-first (RED, then GREEN).

- **Part B (watcher/test/tool-gate/round16-shell-forms.test.ts, 162 tests, main agent and builder):** SEC HIGH-1, CR MEDIUM-2, CR HIGH-1, the qualifier `[…]` rule, CR MEDIUM-1, CR LOW-1, PERF LOW-1, the function-definition forms, and the arithmetic, getopts and zparseopts setters. RED before the change: 112 of 150 failed.
- **Part A:** SEC INFO-1 (tty) in watcher/test/tool-gate/sandbox-round16.integration.test.ts. CR I-2 (clock) in watcher/test/tool-gate/rules/review-round16a.test.ts. CR I-1 is cosmetic: a stray blank line in nested-repos.ts, and a doc comment moved back above settingParts in command-reader.ts.
- Part A's targeted run: 12 files, 163 tests green.
- Part B's targeted run: 71 files, 7,062 tests green.
- Both tsc configs are clean.

Newly refused (from ADR-053 to ADR-055):
- Trap, emulate -c and sched strings with an unknown or followed value: `trap 'rm -rf $HOME/.oss/gate-state' EXIT`, `emulate zsh -c 'echo x > $HOME/.claude/settings.json'`, `trap 'echo x > $(echo .oss)/tool-gates.json' EXIT`, `sched +0 'echo x > $HOME/.oss/node-path'`, `F=.oss/tool-gates.json; trap 'rm -f $F' EXIT`, `trap 'rm -f .oss/$NAME' EXIT`.
- Shell-maintained names in a double-quoted trap: `trap "echo x > $PWD/.oss/tool-gates.json" EXIT`, and the same with `$OLDPWD`, `$_` and `$HOME[1,-1]`.
- Function definitions: `functions[f]='…'; f`, `functions+=(…)`, `functions=(…)`, `set -A functions f "…"`, `dis_functions[f]=…; enable -f f`.
- extendedglob `^` and `~`: `setopt extendedglob; rm -f .oss/^x`, `setopt extendedglob; rm -f .oss/*~x`, `setopt extendedglob; echo '{}' > ~/.claude/settings.js?n~x`.
- Qualifier brackets: `X='a[$(rm -f .oss/tool-gates.json)]'; ls *([X])`, `!([X])`, `*([1,X])`, and `ls src/!([ab]*)` (ADR-055).
- Literal head with two or more unknown parts: `echo x > ".oss/$X$Y"`, `".oss/$X-$Y"`, `".oss/${X}${Y}"`, `D=.oss; echo x > "$D/$X"`.
- Arithmetic `$` and a non-literal name for getopts or zparseopts before a hook call: `x=HOME; (( (0), $x = 1 )); ~/.oss/hooks/oss-statusline-settings.sh`, `getopts ab $x`, `zparseopts -A $x`.
- ADR-055 forms: `trap "rm -rf $TMPDIR/x" EXIT`, `functions[f]='echo hi'; f`, `ls src/!([ab]*)`.

Newly allowed (from ADR-053 and ADR-054):
- `repeat 3 echo hi; echo x > out.txt`.
- `trap 'popd' EXIT; echo x > out.txt`.
- `D=build; trap "rm -rf $D" EXIT; trap "rm -rf $D/x" INT`.

Still allowed (kept):
- ADR-050 forms: `tmp=$(mktemp -d); trap "rm -rf $tmp" EXIT`, `D=build; trap "rm -rf $D" EXIT`, `trap 'rm -f "$tmp"' EXIT`, `trap "kill -- -$$" INT TERM`.
- `trap 'rm -rf "$dir"' EXIT` (ADR-054).
- `"$X$Y"`, `"src/$X$Y"`, `"out/$X.log"`.
- `setopt extendedglob; ls **/*.ts` and `setopt extendedglob; rm -f build/^keep.txt`.

Full round-16 verify (2026-11-17, load average about 12-15):
- build, bundle, tsc and tsc -p tsconfig.test.json are clean, with no new untracked dist files;
- targeted vitest: 95 files, 7,432 tests green;
- shell suites green as in round 15 (referenced-hooks-tracked 50/53 for the three untracked new hooks; ideate-template and no-telegram fail on the base too).

## Round 16 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | PASS | L1 I1 |
| Performance | PASS | none |
| Code review | PASS | I4 |
| Security | FAIL | M1 L1 |

Review-agent containment held in all four gates.
- Security MEDIUM-1: a filled trap variable could be changed later by a hidden-name setter (`printf -v $(…)`).
- Security LOW-1 and pen LOW-1: the ADR-054 carve-out checked only protected leaves, not folders that hold them.

## Round 17 fixes

All in watcher/test/tool-gate/round17-shell-forms.test.ts (184 tests, main agent and builder):
- SEC MEDIUM-1, SEC/PEN LOW-1, code-review limits A and B, pen INFO (refusal text), CR INFO-1 and CR INFO-2, and D-R17-2 (ADR-057).
- RED: 90 of 152 cases failed before the first fix. 16 of 28 failed before D-R17-2.
- push-setup.test.ts: the `credential.helper=store (x)` case moved to its own test. It keeps the same refusal and reason.
- Targeted run: 7,615 of 7,616 green. The one not green is the stale-bundle check, which runs before the rebuild.
- Both tsc configs are clean.

Newly refused (on purpose):
- every RED case;
- `$CMD test` and other unknown command words after a filled trap;
- `set -- ../.oss` with a trap that reads `$1`;
- `trap 'rm -rf "/tmp/$X"' EXIT`, only when the repo itself is under /tmp.

Newly allowed: none.

Full round-17 verify (2026-11-17 12:10-12:16 CST, load average 6-8, swap 37.6 of 38.9 GB used):
- build, bundle, tsc and tsc -p tsconfig.test.json are clean, with no new untracked dist files;
- targeted vitest: 96 files, 7,616 tests green;
- shell suites as in round 16 (referenced-hooks-tracked 50/53 for the three untracked new hooks; ideate-template and no-telegram fail on the base too).
- Flake fixed first: an earlier full run (11:27-11:42) failed 5 tests in review-round11 and gate-run-check during a macOS memory-pressure window (11:31:52-11:34:14). Cause: under memory pressure `/sbin/mount` can stall past the gate's 1.2 s cap, so a review call is refused. A 1.3 s injected stall reproduced it (24 of 47 failed). Fix, tests only: review-round11 feeds a fixed mount table through the `mounts` seam (the sandbox stays real); gate-run-check sets a 30 s test timeout like the other spawning acceptance files. The verify script now keeps the full vitest output and logs load and swap.

## Round 17 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | FAIL | H1 |
| Performance | PASS | I2 |
| Code review | FAIL | M1 L1 I4 |
| Security | FAIL | M3 L2 I2 |

Review-agent containment held in all four gates.
- Pen HIGH-1: an unclosed glob group swallowed the rest of the line. This is a regression from round 17. The call was allowed.
- Code review MEDIUM-1: the round-17 allowlist after a filled trap refused ordinary clean-up scripts.
- Security MEDIUM-1: later-trap prefixes (`X=1 printf -v`) hid a setter.
- Security MEDIUM-2: `for` and `coproc` were exempt anywhere.
- Security MEDIUM-3: cp, mv and the other copy commands could write into folders that hold protected files (older code).
- Security LOW-1: escaped quotes inside a glob group were read wrong.
- Security LOW-2: a test clean-up could delete the real `~/dev` or `~/.ssh`.

## Round 18 fixes

Three parts. Each part is test-first (RED, then GREEN).

**Part A (watcher/test/tool-gate/round18-glob-groups.test.ts, 66 tests; RED 44 of 66).** Fixes pen HIGH-1, sec MEDIUM-2, sec LOW-1, CR limit 2 and perf INFO-1. See ADR-059.

**Part B (watcher/test/tool-gate/round18-filled-trap.test.ts, 118 tests; RED 54 of 114).** Fixes D-R18-1, sec MEDIUM-1, CR MEDIUM-1, the option rules and `$argv`. See ADR-058.

**Part C (destinations, scratch home and messages).**
- watcher/test/helpers/scratch-home.ts and scratch-home.test.ts. The guard deletes only paths strictly inside a HOME named `oss-test-home-*`. It is used in review-round10, 11, 12, 13a, 14a, 15a and 16a. Fixes sec LOW-2.
- watcher/test/tool-gate/round18c-destinations.test.ts (54 tests). Fixes sec MEDIUM-3 (D-R18-2, ADR-060).
- 6 new protected-path-mention tests for the trap message (CR I-2, SEC INFO-2).

Before and after checks:
- Each part ran a before and after comparison through an esbuild of the CLI (base ebb879d) over an ordinary sample of about 40 everyday commands.
- No ordinary command went from allowed to refused.
- Newly allowed: the 8 trap clean-ups that round 17 refused, and 14 more ordinary forms after a trap.

**Operator cap (from the round-18 verify).** expansion-scan "reads '(' x 1,000,000 in well under 1 s" took 1,033 ms. The cause was older code: operators did not count against the 2048 cap, so the reader walked the whole input. Fix: operators now count (ADR-059). New rows in watcher/test/tool-gate/expansion-scan.test.ts for `(`, `;` and newline x 1M expect a "too many operators" refusal in under 200 ms. RED: 937, 670 and 1263 ms, and `;` and newline were allowed. GREEN: 2, 2 and 6 ms, all refused. The 66-row ordinary sample (main agent and builder) is unchanged.

### Full round-18 verify (2026-11-17)
- Build, bundle and both tsc configs are clean.
- Targeted vitest: 99 files, 7,863 tests. 7,861 passed at load 39 with swap nearly full. The 2 failures and 2 hook timeouts were in three files round 18 didn't touch: nested-repos.integration, review-round12 and protected-path-equivalence. Another session was running a 24-CPU load test. Rerun on a quiet machine (load under 12): 3 files, 24 of 24 passed.
- Shell suites: oss-gate-run 37/37, oss-node-path 16/16, oss-value 368/368, oss-value-api 131/131, timeline 8/8, hooks-registration 35/35, watcher-dist-fresh pass, session-start-copy 10/10, session-start-no-hook-downgrade 41/41, oss-statusline-settings 16/16, auto-permissions 18/18, agent-tools 7/7, agent-frontmatter 5/5.
- Known: referenced-hooks-tracked is 50/53 until the three new hooks are staged. ideate-template and no-telegram fail on the base too.
- Round-18 snapshot: FIX_BASE tree ebb879d, FIX_HEAD tree 304e288.

## Round 18 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | FAIL | H1 M1 |
| Performance | FAIL | M1 L1 I1 |
| Code review | FAIL | M1 I2 + 1 counted limit |
| Security | FAIL | H1 M2 |

Review-agent containment held in all four gates. All findings were inside the round-18 diff.

- Pen HIGH-1: a glob group missed a redirect (`( noglob echo (a|b >.oss/tool-gates.json )`).
- Security HIGH-1: a newline inside a group hid later commands.
- Pen MEDIUM-1 and security MEDIUM-2: g-variants and attached `-C` or `-d`.
- Security MEDIUM-1: setters with the name in an option.
- Code review MEDIUM-1: trap-first lines refused.
- Code review LOW-A: `time F=.oss`.
- Performance MEDIUM-1: quadratic after-trap scan with no clock check.
- Performance LOW-1: quadratic group end.
- Performance INFO-1: a 601-character refusal text.

## Round 19 fixes

Three parts, each with its own new test file. Each part is test-first (RED, then GREEN). See ADR-061 to ADR-063.

**Part A (watcher/test/tool-gate/round19a-glob-groups.test.ts; D-R19-3).**
- 10 group forms are refused and 22 exempt forms are allowed.
- Covers the reason text and the work count.
- RED: 27. The round-18 tests `round18-glob-groups` and `round18-filled-trap` moved these to refused: `ls (a|b) && echo found`, `noglob echo (a)` and `${CLEAN_UP}noglob echo (a)`.
- `push-setup` accepts either refusal for `git -c 'credential.helper=store (x)' fetch`. It is still refused. (The acceptance row for the same command was missed here and fixed in the full verify below.)
- Performance LOW-1 and the group-end timing are part of this part.

**Part B (watcher/test/tool-gate/round19b-traps.test.ts, 114 tests; RED 56 of 112, plus a `${(` timing case).**
- Covers D-R19-1 (ADR-062), D-R19-2 (ADR-063), code review limit L-A, security MEDIUM-1, performance MEDIUM-1, the g-variant write targets and code review INFO-2.
- The 24 KB `a[` attack went from 1.1 to 3.3 s to 3 to 11 ms.

**Part C (watcher/test/tool-gate/round19c-destinations.test.ts, 54 tests).**
- Attached `-C` and `-d` options, and g-variants in the destination check (ADR-060, ADR-063).

**Before and after (esbuild of the CLI).**
- Base is tree 304e288. Head is the round-19 tree. Part B also shows tree ebb879d.
- The check covers the main agent and the builder over the ordinary sample (72+ lines), including trap-first lines, prefix words, `$?` and `$!`, attached options, g-variants and multi-line scripts.
- Allowed to refused: only the RED cases and the three ADR-061 forms.
- Refused to allowed: the seven trap-first lines, `tmp=build; tmp=out` after a trap, and `F=out` after `trap 'rm -rf $F' EXIT`.

**Not done.** Performance INFO-1 (the "can't list <path>" text in tree-finder.ts is not clipped) is filed in FOLLOWUPS.

**Full round-19 verify (2026-11-17 16:17–16:35 CST, quiet machine: load 3–6, swap 0.1 GB, first run after a Mac restart).**
- Build, bundle, `tsc` and the test `tsc` are clean.
- Targeted vitest: 102 files, 8,133 tests. 8,130 passed and 3 failed; the 3 are fixed (tests only) and re-run green:
  - `tool-gate.acceptance` US-001 item 12: `git -c 'credential.helper=store (x)' fetch` is still refused, but now with the ADR-061 glob-group reason (git runs the helper value through a shell). That row is now its own test expecting that reason; the other six rows still expect "hook folder or program". A probe confirmed quoted parentheses stay allowed: `git commit -m 'fix (scope)'`, `echo "a (b) c"`, `git log --format='%h (%an)'`, `printf '%s\n' '(a|b)'`.
  - `review-round11` SEC CRITICAL-1 setsid and setpgrp: a test bug. The restart emptied the user temp folder, so the xcrun cache (`xcrun_db`) was missing; the sandboxed `/usr/bin/python3` then printed "couldn't create cache file" on stderr, and the test read stdout+stderr as the pid (NaN). Reproduced by moving `xcrun_db` aside. The test now takes the pid from the all-digit line. No gate change.
  - Re-run of both files: 1,314/1,314 passed.
- review-round12, nested-repos.integration and protected-path-equivalence (round-18 load timeouts) passed on this quiet run.
- Shell suites unchanged from round 18: oss-gate-run 37/37, oss-node-path 16/16, oss-value 368/368, oss-value-api 131/131, timeline 8/8, hooks-registration 35/35, watcher-dist-fresh pass, session-start-copy 10/10, session-start-no-hook-downgrade 41/41, oss-statusline-settings 16/16, auto-permissions 18/18, agent-tools 7/7, agent-frontmatter 5/5. referenced-hooks-tracked 50/53 (three new hooks untracked until staged); commands ideate-template and no-telegram fail on the base too.

### Round 19 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | FAIL | H1 |
| Performance | PASS | LOW-1 (correctness), 2 INFO |
| Code review | FAIL | M1 M2 L1 + 3 INFO |
| Security | FAIL | H1 H2 + 2 INFO + 2 ADR-048 limits |

Notes: review-agent containment held in all four gates.
- Pen H1 is the same bug as security H1. A group after a wildcard (`*(a|b >.oss/tool-gates.json )`) still hid a redirect. This is the round-18 H1 shape. The code is not in the round-19 diff.
- Security H2: `x=(a|b` (newline) `#x) ; git push …` was read as an array.
- Code review M1: IFS regression on the later-value path. It was refused at 304e288 and allowed at ac774bd.
- Code review M2 and performance LOW-1: mktemp with options, the trap's own `rc=`, and `wait $pid` were refused.
- Code review L1: `-t` inside clusters, and `--targ`.
- Performance: hostile inputs stop in milliseconds. Ordinary commands take 0.3 to 2 ms.
- Not counted (filed in FOLLOWUPS):
  - `git -c 'user.name=A (B)'` is refused (code review I-3).
  - `zselect -aF` and `zstat -HF` (security INFO-2) need zmodload.
  - An EXIT trap is judged in the folder where it is set (security limit 1, ADR-048). It is already on the OS write-sandbox card.

### Round 20 fixes

**Part A (tokenize.ts; watcher/test/tool-gate/round20a-groups.test.ts, 166 tests; RED 82 failing before).**
- Pen HIGH-1 and security HIGH-1 (the round-18 H1 shape through wildcard groups). A group that holds a newline, `<`, `>`, `&`, `;`, a backtick, `$(`, a comment `#`, or no closing `)` is refused. `|` is still allowed.
- Security HIGH-2: `name=(` is an array only in an assignment, as in ADR-064.
- 18 RED rows are refused, on darwin and linux, for main and builder.
- Before and after, over 127 rows × main/builder × darwin/linux, against ac774bd and ebb879d: allowed changed to refused only for the RED rows, plus `builtin typeset x=(a)`. That one is correct: zsh and bash both reject it. Refused changed to allowed: none.

**Part B (command-reader.ts, call-variables.ts, rules/protected-path.ts; watcher/test/tool-gate/round20b-traps-targets.test.ts, 248 tests; RED 106 failing before).**
- Code review MEDIUM-1: the IFS check now also covers the later-value path.
- Code review MEDIUM-2 and performance LOW-1: `$(mktemp …)` and `` `mktemp …` `` with options are followed. The trap's own assignments and `wait $pid` no longer count as later changes.
- Code review LOW-1: `t` inside option clusters, and any prefix of `--target-directory`.
- Code review LOW-1 (g-names): one explicit list of GNU names, in `plainWriterName`.
- Code review INFO-2: `time { F=.oss; }` now names the real word.
- Refused changed to allowed:
  - the 12 trap-first ordinary rows (allowed at ebb879d too);
  - `time { F=.oss; }` and `time { cd .oss; }`, which are not writes;
  - `$(mktemp .oss/x.XXXX)`.
- Allowed changed to refused:
  - the RED rows;
  - real holes found on the way: `cd src && tar -xC../.oss`, `unzip -qd../.oss`, `tar xCf`, `ginstall -Dt"$D"/.claude`, `gchmod -R 777 "$D"/.claude/x`, `time { read F; }` after a trap, and `TMPDIR=.oss/tool-gates; … mktemp -d`.
- No ordinary command is newly refused.

**Rows left as they are on purpose.**
- Six `g…` single-file writes to `"$D"/.claude/x`. Their plain programs are allowed by ADR-036.
- `$(mktemp .oss/x.XXXX)`. It is not a protected path.

**Still refused (unchanged).**
- `print -l *(/)`. `print` names `*`, so it has been refused since round 17.
- `trap 'rm -rf $tmp' EXIT; tmp=$(mktemp -d); while IFS= read …`. The unquoted `$tmp` with IFS has been refused since round 18.

**Full round-20 verify (2026-11-17 17:12–17:20 CST, load 6–7, swap 1.1–1.3 of 2 GB).**
- Build, bundle, `tsc` and the test `tsc` are clean.
- Targeted vitest: 104 files, 8,547 tests, all passed (round20a 166, round20b 248 included).
- Shell suites unchanged from round 19 (all green; referenced-hooks-tracked 50/53 until the three new hooks are staged; commands ideate-template and no-telegram fail on the base too).
- Round-20 snapshot: FIX_BASE tree ac774bd → FIX_HEAD tree 80f6cd1 (tokenize.ts, command-reader.ts, call-variables.ts, rules/protected-path.ts and the two new test files).

### Round 20 gate results

| Gate | Verdict | Findings |
|---|---|---|
| Pen test | INCOMPLETE / FAIL | HIGH quoted `typeset` (a safety check stopped its live zsh probes; most coverage not run) |
| Performance | FAIL | M1 IFS check per name, no clock check (~2 s at 6,100 names, still refused); INFO mktemp template cost |
| Code review | FAIL | LOW-1 mktemp long options refused; INFO-1 `nocorrect arr=(a)` refused; INFO-2 unchanged; limits L-a L-b L-c |
| Security | FAIL | H1 quoted `typeset`/assignment before `x=(` (zsh wrote the file); H2 `gfind` missing; M1 tar `--cd`/`--dir`; INFO-1 mktemp attached `-p`; INFO-2 `print -l *(/)` |

Notes: review-agent containment held in all four. Folded into round 21: everything above except CR L-a (bash IFS set through a computed name, `declare "${n}S=/"`; ADR-048 limit, OS write-sandbox card) and CR INFO-2 (`(( n*(m+1) ))`, `print -l *(/)`; unchanged since round 17).

### Round 21 fixes

**Part A (tokenize.ts; watcher/test/tool-gate/round21a-arrays.test.ts, 118 tests; RED 86 failing before).**
- Before and after over 620 rows (main and builder, darwin and linux; ac774bd, 80f6cd1, head).
- Allowed changed to refused: only RED rows, plus pins (`\time …`, `A=$B …`, `disable -pr local`, `builtin disable -r export`, eval and subshell forms).
- Refused changed to allowed: `nocorrect arr=(a b)` and `nocorrect arr=(a)`.
- No ordinary row changed.

**Part B (command-reader.ts, rules/protected-path.ts, rules/protected-path-mention.ts; watcher/test/tool-gate/round21b-names-targets.test.ts, 104 RED failing before).**
- The 6,100-name IFS call went from ~2.2 s (refused for time) to ~0.4 s (refused as too many words).
- Allowed changed to refused: the brief's gfind, tar and mktemp RED rows, and the four `.git/hooks` and `.git/refs` folder commands (D-R21-1).
- Refused changed to allowed: `tar -xf t.tar --dir=build`, `--cd build`, and five trap-first rows with `mktemp --directory`, `--tmpdir x.XXXX`, `--tmpdir=/var/tmp -d`, `--suffix=.json` and `--quiet`.
- protected-path-equivalence.test.ts reference copy updated for D-R21-1 (4 tests).

**Choices.**
- `gxargs rm -rf < list` is allowed, like plain xargs.
- `f=$(mktemp .oss/tool-gates.XXXX); date > "$f"` is allowed. `.oss/tool-gates.<random>` is not a protected file.
- Plain `mktemp -t ../../.claude/plugins/p` with no trap stays allowed. Only the trap row is refused.

**Full round-21 verify (2026-11-17 19:08–19:16 CST, load 3–4).**
- Build, bundle, `tsc` and the test `tsc` are clean.
- Targeted vitest: 106 files, 8,901 tests, all passed (round21a and round21b included).
- Shell suites unchanged from round 20 (all green; referenced-hooks-tracked 50/53 until the three new hooks are staged; commands ideate-template and no-telegram fail on the base too).
- Round-21 snapshot: FIX_BASE tree 80f6cd1 → FIX_HEAD tree f37331b (tokenize.ts, command-reader.ts, rules/protected-path.ts, rules/protected-path-mention.ts, the two new test files and protected-path-equivalence.test.ts).

## Round 21 gate results (FIX_BASE 80f6cd1 → FIX_HEAD f37331b)

| Gate | Verdict | Notes |
|---|---|---|
| Performance | PASS | INFO: quadratic `disable` scan (sandbox card) |
| Pen test | PASS | limit: quoted `e` glob qualifier (sandbox card) |
| Security | FAIL | HIGH-1 wrappers, HIGH-2 `git stash -u/--all`, MEDIUM tar options and `disable $o`; LOW-1 mktemp `--tmpdir ../` = round-21 regression |
| Code review | FAIL | MEDIUM-1 mktemp; over-refusals (`${TMPDIR:-/tmp}` template, `A="x y" arr=(`, `rm -f .git/modules/sub/index.lock`) |

Decision ADR-066 ("Stop: ship + sandbox card"): only the round-21 regressions are fixed (Phase 8, Tasks 18-21, via /oss:build); every other finding is on the OS write-sandbox card in FOLLOWUPS.md. No further gate round.

## Round 22 build (/oss:build --phase 8, 2026-11-17/18)

| Task | RED | GREEN / REFACTOR | Before/after |
|---|---|---|---|
| 18 mktemp `${TMPDIR:-/tmp}` template | 12 failing | 630/630 targeted; tsc clean | 57 rows: 5 refused→allowed, 0 allowed→refused |
| 21 mktemp temp-folder template with `/` (security) | 20 failing (exact TMPDIR depth) | 1,953/1,953; refused like a bare `$(…)` | 72 rows: only the 5 RED rows allowed→refused |
| 19 quoted/expanded assignment before `arr=(` | 12 failing | 1,667/1,667; `A=$B${WRITE}` row moved to allowed after a real-zsh check; REFACTOR `NOT_PLAIN` | 80 rows, 0 allowed→refused |
| 20 D-R22-2 single files free | 8 failing; then 16 failing for `rm -f .git/hooks`-style rows the first GREEN let through | `deletesSingleFile`: non-recursive `rm` of an `lstat` regular file skips the folder check; `cd` forms checked; 2,233/2,233 | 178 cases: only the Task 20 rows refused→allowed |

- Code simplifier: `inTempFolder` constant and `writtenInTemp` helper in command-reader.ts; no behaviour change; 3,348 tests across 13 files, both tsc configs clean (re-checked: 1,824/1,824).
- Integration: `npm run build` (tsc + bundles) OK. Real-boundary files (protected-path / gate-agent-write / git-reader / nested-repos integration, oss-tool-gate hook, tool-gate CLI, sandbox acceptance): 157/157. The rebuilt `dist/cli/tool-gate.cjs` was probed through a scratch HOME and repo: `rm -f .git/modules/sub/index.lock` (file present) allowed; `rm -f .git/hooks`, `rm -f .git/refs`, `rm -f .git/modules/sub`, `cd .git/modules && rm -f sub`, `rm -rf .git/hooks`, `rm -f .git/hooks/pre-commit`, `mktemp --tmpdir ../x.XXXXXX` refused; `A="x y" arr=(a b)` and `mktemp "${TMPDIR:-/tmp}/x.XXXXXX"` allowed. Same for the main agent and a builder.
- Accepted over-refusal (sandbox card): `cd .git/modules/sub && rm -f index.lock`.

## ADR-067 one-shot review and Task 22 (2026-11-18)

- Security review of the Task 20 disk check only: FAIL, HIGH. An `rm` part's redirect targets also skipped the folder rule, so `touch "echo PWNED"; rm -v "echo PWNED" >> .git/modules/sub/hooks/pre-commit` and `rm -f x > .git/modules/sub/HEAD` were allowed; the check also allowed deleting submodule hooks/HEAD/refs. Clean: option spellings, wrappers, `cd`/`pushd`, case, links.
- Task 22 reverted Task 20: RED 32 failing (8 rows × 2 agents × 2 platforms); GREEN protected-path.ts and protected-path-mention.ts byte-identical to f37331b. The bundle refuses the review's commands; `rm -f .git/modules/sub/index.lock` is refused again (accepted over-refusal, sandbox card).
- Final targeted verify after the revert: 186 files, 9,869 tests, all pass; both tsc configs clean; `npm run build` OK.

## Last Updated: 2026-11-18 01:32 CST by /oss:build --phase 8 (Task 22 revert; round 22 complete)
