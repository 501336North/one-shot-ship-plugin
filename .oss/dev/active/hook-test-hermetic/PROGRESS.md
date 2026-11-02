# Progress: hook-test-hermetic

## Current Phase: build (ship keep-fixing round after the cap)

## Tasks
- [x] T1: Analytics POST on workflow start is detached and time-limited (completed 2026-10-29)
- [x] T2: A pending update notice never holds session events (completed 2026-10-29)
- [x] T3: Session start launches notify detached (completed 2026-10-29)
- [x] T4: Provenance sweep of background jobs and unbounded curls in hooks/ (completed 2026-10-29: 4a oss-log agent, 4b health check, 4c log fallback, 4d login -m; 4e pipefail jq exits moved to FOLLOWUPS by user decision)
- [x] T5: setup.ts sandboxes HOME and kills nothing it did not start (completed 2026-10-29)
- [x] T6: Fix the tests that break under the sandboxed HOME (completed 2026-10-29: 6.a .oss in sandbox HOME, 6.b session-context-local, 6.b2 restore test, 6.c = T11; plus 4a-2 agent-status-line race)
- [x] T7: Warm-stub helpers in TS and bash (completed 2026-10-29)
- [x] T8: oss-notify-telegram.test.ts: stubs made once and warm (completed 2026-10-29)
- [x] T9: hook-error-adoption.test.ts: one env-driven curl stub (completed 2026-10-29)
- [x] T10: oss-notify-project.test.ts made hermetic (completed 2026-10-29)
- [x] T11: oss-session-logging.test.ts made hermetic, live session safe (completed 2026-10-29 as T6.c)
- [x] T12: oss-log-error-recovery.test.ts writes only in its sandbox (completed 2026-10-29)
- [x] T4f: keyed calls use the configured apiUrl and its key (completed 2026-10-29: session start 478b804, T4f-2 a12e1d6, T4g 256f262 49bd0fc 3cfeaf9 e06d4d3)
- [x] T4h: optional-helper-source and oss-notify-api-url wait for the detached analytics POST (regression from T1) (done 2026-10-29, test-engineer, not via a /oss:build invocation; e70b389, 9e1a0da)
- [x] T4i: fetch-iron-laws.sh's curl gets a time limit (found in T4g) (done 2026-10-29, test-engineer, not via a /oss:build invocation; e70b389, 9e1a0da)
- [x] T13: complete-bounds.test.sh checks boundedness, not wall-clock (completed 2026-10-29)
- [x] T13b: complete-bounds parses under /bin/bash 3.2 (completed 2026-10-29)
- [x] T14: api-curl.real.integration.test.sh is event-driven (completed 2026-10-29)
- [x] T15: Stability proof: 5 runs each, plus a run under load (completed 2026-10-29: watcher 5/5 + load before T15b; shell 5/5 + load after T15b/T15c, test-engineer)
- [x] T15b: oss-notification-style (and stop-telegram-style) wait for the popup, not a 2 s window (completed 2026-10-29, test-engineer)
- [x] T15c: negative checks after background jobs wait for the job, not sleep 1 (completed 2026-10-29, test-engineer)
- [x] T16: Version bump to 2.0.95 and the server analytics follow-up (completed 2026-10-29: plugin.json 2.0.95, the only pin; FOLLOWUPS analytics item)
- [x] T17: session start never downgrades the shared ~/.oss/hooks (completed 2026-10-29, test-engineer, via /oss:build)
- [x] T18: harden the T17 version record (completed 2026-10-30, security-auditor: atomic record after all copies, regular-file only, record names its root, plugin-root only on copy, anchored parse + prerelease + 9-digit cap, bounded health check; 26/26, mutants caught)
- [x] T19: test setup clears every config override (completed 2026-10-30, test-engineer: setup.ts deletes OSS_CONFIG_DIR, CLAUDE_PLUGIN_ROOT, OSS_MANIFEST_URL + 3 isolation asserts; 12 shell tests unset OSS_CONFIG_DIR/OSS_MANIFEST_URL (9 showed the sentinel key or URL leaking before); mutants caught)
- [x] T20: plain http to a loopback API only with an explicit opt-in (completed 2026-10-30, security-auditor: oss_api_url rc 2 without OSS_ALLOW_HTTP_LOOPBACK=1; session start prints one line naming the switch; opt-in set per test; 7 mutants caught; login message moved to T22)
- [x] T21: an unreadable config refuses instead of falling back to production (completed 2026-10-30, security-auditor: jq parse failure → no URL; jq-less strict apiUrl reader (refuses nested/duplicate/escaped); 38/38, 176/176, 7 mutants caught)
- [x] T22: login and worktree-create use the hooks' config file and API (completed 2026-10-30, security-auditor: login validates against oss_api_url and writes oss_config_file keeping apiUrl; shared oss_loopback_refused line; worktree-create copies oss_config_file; 3 more tests made hermetic (value-file-wrappers-run overwrote OSS_CONFIG_DIR); 6 mutants caught; refused-apiUrl case not RED-first, guarded by M1)
- [x] T23: session start reports a broken install, not "Not logged in" (completed 2026-10-30, debugger: session-start-copy 11/11, mutant caught)
- [x] T24: escaped JSON, TEAM_ID checked (completed 2026-10-30, security-auditor: TEAM_ID refused + no request; session-start notify JSON via jq or charset check, plus the `0\n0` count bug; oss-notify analytics already guarded by oss_valid_workflow_name; mutants caught)
- [x] T25: team IRON LAWS cache tied to its API; failed fetch backs off (completed 2026-10-30, performance-engineer: cache sidecar = request URL, used by fresh and stale paths; 1 h failure backoff; sync TTL stamp holds the apiUrl; 20/20, 59/59, 8/8, 9 mutants caught)
- [x] T26: flaky metrics-collector test and unbounded stub loop (completed 2026-10-30, test-engineer: 3 real-timer duration asserts → fake timers, exact values; 3 uncapped stub waits capped, new case 7; mutants caught)
- [x] T27: esbuild CVE GHSA-67mh-4wv8-2f99 (completed 2026-10-30, dependency-analyzer: esbuild ^0.21.5 → ^0.28.2; npm audit 1 moderate → 0; no invalid peer; build output byte-identical; tsc 0; vitest 265/265 files, 3585 tests)
- [x] T28: origin/main #213 into the tree, version 2.0.96 (completed 2026-10-30). Applied e8b1fa8's diff to the working tree (no commit), merged its 6 LEARNINGS entries, plugin.json 2.0.96. A merge of upstream code, not new code, so no RED of its own: #213's tests pass in this tree (decision-record acceptance 3/3, oss-decision-record 101/101, hooks-registration 25/25, bash32-parse 104/104, watcher redaction/redact-decision/is-main-module/symlink 31/31).
- [x] T29: no test reaches the configured config or API, plus a guard test (completed 2026-10-30). RED with a local sentinel listener named by OSS_CONFIG_DIR: curl integration 9/15 with 2 POSTs reaching the sentinel, iron-laws-sync 7/8; GREEN 15/15 and 8/8 with 0 hits. New guard tests-hermetic-env.test.sh (every test that runs a hook unsets OSS_CONFIG_DIR and OSS_MANIFEST_URL): RED 41 files flagged, all fixed; 2 mutants killed. Under the hostile env 0 sentinel hits across 44 files. Open: session-start-notify-payload showed varying results in clean runs (to investigate after T30).
- [x] T30: one config reader for key and URL (completed 2026-10-30). `oss_config_strings` in oss-api-curl.sh: exactly one JSON object, string fields of printable ASCII; jq -s (length 1, object) or node JSON.parse (argv, no interpolation); neither → refuse. oss_api_key, oss_api_url (+ oss_api_url_check), team-laws (one call for key/URL/teamId), session start key, fetch-iron-laws, push-metrics, iron-laws-sync (python3/bash readers deleted) all routed through it; T21 grep/sed reader removed. RED 52/90 (nested configs refused without jq; concatenated docs split key and URL) → GREEN 126/126; 10 mutants killed. Team-laws warm path ~6 → ~4 forks. Also fixed a T33 regression caught by no-model-text-in-failed (login.md placeholder text), 34/34.
- [x] T31: the version record's plugin root must be real (completed 2026-10-30). `oss_record_trusted` in oss-session-start.sh: root a user-owned non-symlink dir, plugin.json a regular user-owned non-symlink file whose version equals the record, installed hooks cmp-identical to the root's (first mismatch stops). Runs only when the record is newer. RED 29/36 → GREEN 36/36; 9 mutants killed; the -O ownership checks are unguarded (needs another user's dir, no sudo). Session-start shell tests and 41/41 watcher hook tests pass.
- [x] T32: files in ~/.oss read only when regular, written atomically (completed 2026-10-30). `oss_is_regular` and `oss_write_atomic` (mktemp in the same dir, unlink a symlink, mv -f, clean up on failure) in oss-api-curl.sh; team-laws cache, .src, backoff and the sync stamp and sync backoff routed through them. RED 1/19 (FIFOs opened or hung, writes through symlinks, set -e abort on a directory) → GREEN 20/20 (4 runs); 6 mutants killed (M6 by the chflags case, macOS only). No new forks on the warm path. Files now 0600.
- [x] T33: login prints a filtered plan, template step uses the configured API (completed 2026-10-30). oss-login.sh prints the plan via oss_json_field; new hooks/oss-claude-md-template.sh (URL from oss_api_url, key via stdin, rc 2 prints the switch, no stdout on failure) replaces login.md's hardcoded GET; login.md Config line and credentials.enc follow oss_config_file. RED: control codes reached the terminal; template 8/12; login.md 6/7. GREEN 4/4, 12/12, 7/7; 13 mutants killed. Orchestrator added the hook to HOOKS_TO_COPY with a new general guard (every ~/.oss/hooks/*.sh a command runs is copied; RED named the new hook, GREEN 5/5).
- [x] T34: template hook accepts only a complete, bounded, clean template (completed 2026-10-30; code from the pre-crash agent, mutation check by test-engineer after the crash: 11/12 killed, the `--max-filesize` survivor closed by new case 9c (announced over-cap length + stall; RED 23/24 → 24/24))
- [x] T35: config read only when a regular file (completed 2026-10-30, security-auditor: `[[ -f ]]` in oss_config_strings; RED 16/28 → GREEN 28/28; 4 mutants killed; the earlier `-e` checks kept on purpose (with `-f` a FIFO config would get the production URL); test cap now kills the whole process group, since orphaned jq readers of /dev/zero from earlier runs had piled up, a plausible cause of the crash)
- [x] T36: a trusted record root must hold every hook (completed 2026-10-30). oss_record_trusted: every HOOKS_TO_COPY entry must be a regular non-symlink file on both sides and cmp-identical; the skip is gone. RED 37/39 (one-hook planted root and a root missing the last hook were trusted) → GREEN 39/39; mutant (continue restored) killed 36/39; 38/38 watcher session-start tests. Trade-off: a future plugin that drops a hook from the list loses downgrade protection against older sessions.
- [x] T37: key and URL from one read at every site (completed 2026-10-30, security-auditor: `oss_api_creds` (one oss_config_strings read; sets OSS_KEY/OSS_URL/OSS_URL_RC; call directly, never in `$(...)`); template, iron-laws-sync, fetch-iron-laws, push-metrics, session start (3 reads → 1), oss-notify analytics routed through it; new oss-config-one-read.test.sh swaps the config after the first read: RED 12/14 → GREEN 18/18; 15 mutants killed; provenance: login (new key) and sync stamp (no key) read the URL only, correct; oss_api_key now used by tests only)
- [x] T38: login prints exactly one plan line (completed 2026-10-30, security-auditor: oss_json_field `jq -rs`, exactly one object, strips `\p{Cf}` + U+2028/2029; RED 7/10 and 4/6 → 10/10 and 6/6; 7/8 mutants killed, object-type check unguarded → T46; other strip sets now disagree → T45)
- [x] T39: config path and names never options to node or jq (completed 2026-10-30, security-auditor: a config dir named `--eval=CODE` ran code via node when jq was absent; `--` for jq and node; new oss-config-dash-path.test.sh RED 0/6 → GREEN 6/6; 2 mutants killed; same class open in oss-login.sh:25 → T44)
- [x] T40: /oss:login never puts the key on a command line (completed 2026-10-30; code from the pre-crash agent, mutation check by test-engineer: `--arg` mutants killed by the unit test; both in-place-write mutants survived → fixed fixture mode carry-over and new hard-link case 3 (RED → 8/8). Unguarded: the real-integration test cannot see jq (only the unit test's recording jq does); `chmod -- 600` is equivalent today (mktemp 0600 + umask 077))
- [x] T41: T40 test reads permissions GNU-stat first (completed 2026-10-30, security-auditor: stat-order RED 2/3 → 3/3; key-argv 7/7; chmod-644 mutant killed with native and GNU stat)
- [x] T42: session-start tests flaky under load (completed 2026-10-30, debugger. Cause: not load. 17 of 18 worktrees (and origin/main) have `pkill -f "oss-session-start"` machine-wide in watcher/test/setup.ts beforeAll; any vitest run from those checkouts SIGTERMs a hook test running the hook by its real name. Load alone: 0/15 failures; load + a scoped kill loop: 10/15 before, 0/15 after. Hook unchanged, no customer impact. Fix: hooks/__tests__/lib/session-start-alias.sh runs the hook through a symlink the pattern does not match; 3 test files use it; new deterministic guard session-start-outside-kill.test.sh (RED 2/5 → 5/5); 5 mutants killed. Unproven: that the original failures came from an actual concurrent run.)
- [x] T43: session-start-notify-payload results vary (completed 2026-10-30 with T42: same cause, `payload=` empty when killed; 7/7)
- [x] T48: the other 8 test files that run session start by its real name use the alias helper (completed 2026-10-30, test-engineer, test-only: all 8 routed; outside-kill guard covers 11 files incl. a BASH_ENV kill for files that set their own PATH (RED 6/14 → 14/14); timeout-fallback was vacuous (passed while killed), now requires exit 0; no-hook-downgrade's failure message could hang on a FIFO record, fixed; "nested config has a key" now requires exit 0 + "OSS: Ready". Unguarded: a file that starts session start in a new process group would escape the guard (none does today))
- [x] T44: login's config jq call takes `--` (completed 2026-10-30, security-auditor: also mkdir, mktemp, chmod, mv; new oss-login-dash-path.test.sh RED 0/2 → 5/5 incl. a GNU-coreutils pass (SKIPPED, not passed, without coreutils); 5 mutants killed, chmod's only under GNU getopt; grep found the same class in 3 more hooks → T47)
- [x] T45: one stripping set at all three sites (completed 2026-10-30, security-auditor: shared `OSS_JQ_INVISIBLE` def in oss-api-curl.sh used by oss_json_field and the template; stripControl gets `\p{Cf}` + U+2028/2029 (`u` flag); RED template 22/23, cli-decrypt 2/7 → 23/23, 7/7; new full-code-point parity test bash ↔ TS (236 code points stripped by both); 9 mutants killed. SHIPPED BINARY NOT UPDATED: users run the released oss-decrypt (cli-decrypt-v1.2.4); the tracked dist bundle is stale and no test checks bundle vs source → needs a cli-decrypt release, user decision)
- [x] T46: oss_json_field object-type check guarded or removed (completed 2026-10-30, security-auditor: removed in REFACTOR as redundant (stdout identical over the corpus, only the unread exit status differed); D9; tests green before and after)
- [x] T47: check-updates, changelog, worktree-create take `--` on config paths (completed 2026-10-30, security-auditor: new oss-config-dash-hooks.test.sh, native + GNU pass, empty-stderr asserts; RED 1/11 → 11/11; real bug: without `--` check-updates read a dash-named state as missing and overwrote it; 15 mutants killed, the 4 chmod ones only in the GNU pass)
- [x] T49: no test can leave orphan processes (completed 2026-10-31, test-engineer, test-only. Requested by the user: "we need to make sure not to do this again".
  - New `hooks/__tests__/lib/run-capped.sh`: perl fork + setpgrp; KILL to the whole group on the cap (rc 124); after every run it checks the group and kills survivors (rc 125). No timeout, gtimeout, setsid or pkill.
  - Self-test run-capped.test.sh: RED (missing) → 21/21. Covers /dev/zero, a TERM-ignoring child and background grandchildren. 4 mutants killed. The m4 settle-wait code was written before its test; the missing case was added after the mutant survived.
  - Guard no-hand-capped-tests.test.sh: RED named 13 files → 19/19. Its allowlist is file + exact line, and stale entries fail. 4 mutants killed.
  - 13 files routed through run_capped, assertions unchanged.
  - Correction to the plan's list: config-change-guard has no cap (it only matched on "false alarms"), and oss-decision-record was missing. Its timeout/gtimeout cap on /dev/zero ran an empty command on stock macOS.
  - Unguarded: a leak is killed, but it fails the test only where the call's status is checked; a hook that leaves its process group; background helpers that tests start without the cap.)

### Open after T45/T47 (not started; need a decision)
- cli-decrypt release so users get T45's stripControl (version bump, tag, OSS_DECRYPT_TAG, MINIMUM_VERSION, checksums, rebuilt dist) and a test that the tracked bundle matches the source. Outward-facing: user decision.
- watcher/src/services/redaction.ts:184 `UNSAFE_CHARS` is a fourth stripping set (mirrors the API's cleanText in AgenticDevWorkflow); lacks U+2028/2029 and Cf. Cross-repo.
- commands/login.md Step 3: `dirname`/`rm "$CREDS"` without `--` (fails closed: cached credentials not cleared for a dash-named config dir).

### Phase H (T50-T57): PAUSED 2026-10-31 14:28 CST by the user until Monday (token budget)
The branch was pushed at f3f897b, and no PR exists yet. /oss:ship's narrow re-check of T34-T49 had these results:
- pen-test: FAIL. r3 #1-3, #5 and #6 are closed; #4 reopened as N1 (T50). N2, N3 and N4 are new.
- security-auditor: PASS. One new LOW (T53).
- code-reviewer: PASS. 72/72 shell files, 14/14 mutants killed. 4 LOW + 1 INFO.

The user chose "keep fixing until clean", following the rule that LOW security findings get fixed, done properly once tokens are back. Do not cut scope.
- [x] T50: done 2026-11-02 (security-auditor verified Friday's code, no changes): RED 39/41 with the guard removed →
  GREEN 41/41; mutants per half (hooks only, .claude-plugin only) each killed by its own case; full shell 84/86 (baseline
  2). Provenance: plugin-root readers follow a symlinked hooks/ but need write to ~/.oss (D10 limit).
  Friday's note, kept for history: in progress, stopped mid-task. The agent added a 3-line guard in hooks/oss-session-start.sh (refuses a symlinked `$r/hooks` / `$r/.claude-plugin`), a case in session-start-no-hook-downgrade.test.sh, and a D-entry in DECISIONS.md.
  - None of this is verified: no RED/GREEN record, no mutation check.
  - Snapshot ref: refs/wip/hook-test-hermetic-20261031-pause (5a78792).
  - Monday: show RED by reverting the guard, then GREEN, then the mutants. Or redo it from the snapshot.
- [x] T56: done 2026-11-02 (security-auditor). The unwired oss-session-start-new.sh and -test.sh are deleted (nothing referenced them). New guard hooks/__tests__/no-grep-api-key.test.sh: RED 4/5 named exactly the two copies → GREEN 5/5. 2 mutants (sed and awk parse) killed. tests-hermetic-env 75/75. oss_api_key (oss-api-curl.sh:69) prints the key and has no production callers; it is left as is.
- [x] T58: done 2026-11-02 (security-auditor). 99 agents and skills moved to oss-decrypt (42 agents, 38+6+13 skills); ideate template now goes through the hook; status and workflows use oss_api_curl. New no-key-in-request.test.sh: RED named 103 lines in 101 files → 9/9. served-prompt-names.txt has 197 pairs from origin/main 16e2e23. 13 mutants killed. Follow-ups a-e became T60-T62 (user: fix now).
- [x] T62: done 2026-11-02 (typescript-pro). The 3rd-violation prompt in iron-law-log-parser.ts:111 now points to ~/.oss/hooks/fetch-iron-laws.sh, with no key, Bearer, curl or host. RED 35/36 → 36/36. Mutant killed. Watcher 3606/3606, tsc 0. Provenance: the other Bearer hits are real HTTP headers in code, not prompt text.
- Merge order (user, 2026-11-02): API #404 deploys first, then plugin #214 (dev-15, 2.0.96), then THIS branch. Before T59, merge origin/main in (no force-push), resolve the 6 shared files (plugin.json, oss-api-curl.sh, oss-session-start.sh, oss-decision-record.sh, commands/login.md, redact-decision.ts), bump to 2.0.97, then run T59 on the combined plugin against the new API. dev-15 messages when #214 has merged.
  - #214 merged 2026-11-02 (91c808e8; main is 2.0.96). NEXT: once T60 finishes, make a local WIP commit, merge origin/main, keep #214's oss_settings_update, lock helpers (oss_lock_id/oss_take_stale/oss_release_lock) and push-off marker, bump to 2.0.97, then re-run decision-push 89 / record 111 / policy 77 / api-curl 18 / login-gate 7 / telegram-cleanup 18.
  - Rate limits (user 2026-11-02: trial limits exist to stop scraping; never hurt paying users). (1) T58 add-on: when oss-decrypt fails (429 or anything else), the agent carries on with its local text, the same as today; needs a test. (2) API change approved by the user: authenticated PRO/TEAM requests are exempt from the global per-IP limiter (index.ts:82, 100 per 15 min); trial and anonymous traffic is unchanged. Owned by dev-15 in AgenticDevWorkflow as its own PR with a security review; the user must also confirm in dev-15's session. It must deploy before this plugin merges. T59 measures the calls per agent run and the peak per 15 min, and runs a burst test.
  - API #404 is merged (8041b35) and deployed to Render on 2026-11-02 at 10:09:53 local. It adds GET /decisions/policy {"pushEnabled","team"} and a per-account limiter of 60 requests per 60 s. For T59: (a) find which routes the limiter covers; if it covers /prompts, the ~100 checks must be paced, and check that a customer's normal agent burst stays under it; (b) re-check commands/__tests__/served-prompt-names.txt (built from 16e2e23) against the new origin/main.
- [x] T60: done 2026-11-02 (security-auditor). New oss-value.sh verbs `status`, `workflows` and `workflow` (shared `_ov_api`: oss_api_creds, then oss_api_curl; `workflow` reads its name from workflow.txt; uses the /editor route, confirmed at routes/workflows.ts:248-251, returns plain config). Allowlisted oss-claude-md-template.sh (takes no arguments, read-only). New bash-blocks-allowlisted.test.sh (RED 7/20 → 8/8; 594 exemptions that existed before, each with a reason) and oss-value-api.test.sh (2/16 → 16/16). Wrappers 45/45, wrappers-run 61/61, auto-permissions 16/16. 9 mutants killed. Its risks became T64 (jq, mid-session update) and T65 (rc=125 under load). Watcher dist rebuilt for T62 (only iron-law-log-parser.js and .map; extra tsc output removed); dist-fresh passes.
- [ ] T61, T63, T64, T65, T51-T55: next, after the merge of main (#214) (T60 allowlisted entry points + workflow /editor; T61 honest text; T62 watcher prompt).
- Old T58 note: next. Brief: scratchpad t58-brief.md. The research found that the agents/skills/workflows routes return ciphertext, so these Step 2s never worked; all names are served. skills/ideate.md's claude-md URL 404s.
- [ ] T59: release gate (after T51-T55).
- [ ] T51-T55: not started.
- [x] T57: done 2026-11-02 (test-engineer). New guard commands/__tests__/no-key-printing.test.sh scans all 170 shipped
  prompt .md (commands/, agents/ incl. _shared, skills/). RED 4/5, named 152 lines (57 commands, 44 agents, 51 skills) →
  GREEN 5/5 after a one-line swap to the quiet check in each (152 files, +152/-152). 7 mutants killed (one revert per dir,
  jq and grep "apiKey" variants, classifier 2>/dev/null, broken glob). Open: 42 agents + 51 skills + workflows.md still
  say WebFetch with `Bearer {apiKey}` (WebFetch takes no headers; pre-existing, follow-up); hooks oss_api_key prints the key
  but has no caller.
- Deferred by the user to a follow-up PR, not this one:
  - cli-decrypt config.ts (FIFO read; production-URL fallback)
  - watcher api-credentials.ts (no regular-file check; different URL rules)
- Monday order: start a fresh /oss:build with T50 (finish), then T57, T56, T51, T52, T53, T54, T55, one agent at a time. Rules for the agents: scratchpad phase-h-rules.md; recreate it if /private/tmp was cleared.
- Then: a narrow /oss:ship re-check (pen-test, security-auditor, code-reviewer), a commit, a PR (no merge), then /oss:integration.
- The decrypted ship and build prompts in the scratchpad may be gone; re-decrypt them.
- Leftover: /private/tmp/claude-501/secaudit-56977, a re-check sandbox (FIFO + repo copy, no keys). The agent's rm was denied. Delete it after confirming with the user.

## Crash recovery (2026-10-30 ~17:05)
The Mac crashed during the round-3 /oss:build (started 16:56, 4 security-auditor agents). Only T36 was recorded done.
The tree was snapshotted to the local ref refs/wip/hook-test-hermetic-20261030-crash (1c9e688). A resumed
/oss:build started at 17:2x; its agents were stopped before any edit (tree byte-identical to the snapshot).
Baseline on that tree: watcher 268/268 files, 3606 tests; shell 71/79 (T35 RED; 2 untracked-file; 2 pre-existing at
0fcb96f: ideate-template, no-telegram-command; T41; T42 flakes). Order from here, one agent at a time on shared
files: T35 → T39 → T37 → T38 → T41 → T42/T43 → T34/T40 mutation checks, then a commit on this branch (no push).
The earlier round's banner landed in another worktree's build.log because ~/.oss/current-project points there (not changed).

## Blockers
- None

## Last Updated: 2026-11-02 08:40 CST by /oss:build (T57 done)
