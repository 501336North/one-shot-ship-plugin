# Handoff: tool-gates (R-253, Sprint D #1)

## Paused At
- **Phase:** ship (`/oss:ship --merge`), fix-until-clean mode (fix round 4), between part K1 (done) and part K2 (not started)
- **Time:** 2026-11-10 08:43 CST
- **Branch:** `feat/tool-gates/build` (worktree `/Users/ysl/dev/oss-plugin-tool-gates`). Last commit 767a862. About 67 uncommitted changes = all ship fix rounds 1-4 (by design: the ship makes ONE commit after the loop). Nothing staged, committed, pushed or stashed.

## Hard rules for this ship (user)
- PR `--base feat/determinism-sprint/build`, never main. Never merge to main. No plugin version bump.
- `--merge` consent covers only the ship's own merge step, into the sprint branch, and only after PR #221 is merged to main and main is merged into the sprint branch. #221 is still OPEN (checked 2026-11-10 08:43). The user merges #221 themself.
- No silent security deferrals: every open security gap goes to the user by name before it is deferred. A fix agent's "Known Limits / left open" list counts as a deferral.
- Ask the user before any refusal-behaviour choice (over-refusal or loosening) that wasn't in the brief.
- Never put chosen values into shell commands; write them with the Write tool (timeline, FOLLOWUPS, commit and PR text).
- No orphan processes: `pgrep -fl tool-gate.cjs; pgrep -fl vitest` after every agent.
- Never stage CLAUDE.md or any ndjson file.

## User decisions so far
- Round 1: fix-now set, defer the rest (18 FOLLOWUPS lines "from: tool-gates (round 1)").
- "Loosen to real writes": only real writes to protected files are refused.
- "Keep protected, move Figma data": `.oss/workflow-state.json` stays protected for writes and reads are allowed. A separate small API PR (AgenticDevWorkflow) moves the Figma write to its own file (ideate-figma.md:320; reads in ship.md:843, visual-qa.md:44, build.ts:659). FOLLOWUPS round-2 line filed.
- ADR-010 "Refuse only when risky" (unreadable shell parts).
- "Allow the safe ones": GIT_AUTHOR_*/GIT_COMMITTER_*/GIT_TRACE* on commit and push, and `cd "$(git rev-parse --show-toplevel)"` read as the project root.
- After round 3: **"keep fixing until clean"**.
- **"Fix all 8 this round"**: the 8 gaps R2b had parked in Known Limits (items 11-17 plus item 12 in the plan).
- **K1 choices (asked 2026-11-10 on resume):** keep refusing when the 1.2 s git budget runs out; keep refusing `git clean -f` whose dry run lists more than 2048 paths; **fix all three K1 security gaps in K2** (planted `.git` file decides `currentBranch`; `:(glob)` magic pathspecs in `git clean`; best-effort process-group kill). Step 1 below is done.
- **"Re-run pen-test in re-check"**: the penetration-tester joins the narrow re-check, framed as sandboxed testing of our own gate through hook JSON. If a safety classifier stops it again, go back to the user before anything else. (In round 3 it was stopped and reported nothing, so the pen-test line was fail.)

## Work Completed
- [x] Gate rounds 1-3 and fix rounds 1-2 (R2a, R2b, R2c). Timeline lines written for rounds 1, 2 and 3 (all 4 gates).
- [x] Fix round 4 FIX_BASE snapshot = `bc612db379c68c7e49d46cba2bfdbe422048c14f`, in `$(git rev-parse --git-path oss-gate)/fix-base`.
- [x] **K1 done** (items 1-4 of the plan): git clean NUL crash, per-call work budget (`watcher/src/tool-gate/budget.ts`), hardened git spawns (fsmonitor off, GIT_* scrubbed, process groups killed), duplicate focused-tests check removed. Suite 5593 pass + 3 allowed failures; tsc clean; bundle rebuilt; no processes left. Details: NOTES.md "Fix round 4 (K1, 2026-11-10 08:40 CST)".
- [x] **K2** (items 5-21) done 2026-11-10 10:07 CST: scoped 2656/2656, full 6052 + 3 allowed fails, tsc clean, bundle rebuilt, no orphans. Details: NOTES.md "Fix round 4 (K2, ...)".
- **K2 user decisions (2026-11-10):** item 6 residual → refuse only `rm -rf *` / `chmod -R *`-style wildcard deletes after a lost cd (single-file writes stay allowed; residual `rm cycle.json` → defer by name). Item 8 → sed script with a variable = unreadable under ADR-010 (refused only when risky); `sed -f`/`awk -f` stay allowed. rc-file dotglob → keep default, defer by name. History cmds on a protected branch → refuse merge/rebase/reset/cherry-pick/revert/am, allow pull/fetch.
- **K2 new gaps (user, 2026-11-10): fix all four in K3** — nested-repo `init --template`/`clone -c` config; `git branch -m X` on main; interpreter script from `<(…)`/`$S`; `rm -rf build` vs protected `build/.git`. (Nested `bash -c` dotglob inheritance is stricter than bash: no fix.)
- [x] **K3** (items 22-28) done 2026-11-10 11:20 CST: all 7 closed; scoped 2957/2957, full 6353 + 3 allowed fails, tsc clean, bundle rebuilt, no orphans. Details: NOTES.md "Fix round 4 (K3, ...)".
- **K3 user decisions (2026-11-10):** item 28 cap stays (trees >10000 folders refused as too complex). Fix in K4: `git -c core.hooksPath|core.fsmonitor` on any subcommand, and (user changed answer, re-asked) `python3 -I script.py` misread (item 30). **Deferred by the user, by name** (FOLLOWUPS + PR body): `mv`/`rsync --delete` over a folder holding a nested `.git`; `source "$F"`/`. "$F"`; `find -exec rm` after a lost cd. User signalled this is where the line is drawn: further new gaps → ask, recommending defer.
- [x] **K4** (items 29-30) done 2026-11-10 11:43 CST: full 6450 + 3 allowed fails, tsc clean, bundle test passes, no orphans.
- **K4 user decisions (2026-11-10):** `credential.helper` → refuse `!` values whose program is a relative path or a variable; PATH commands (`!gh auth git-credential`) allowed. Editor keys with a real command → keep refusing. `core.hooksPath=/dev/null` → keep refusing. Fix all 4 K4 new gaps in K5: GIT_SSH_COMMAND/GIT_EDITOR/GIT_SEQUENCE_EDITOR/GIT_EXTERNAL_DIFF/GIT_ASKPASS/GIT_PAGER vars; GIT_CONFIG_GLOBAL/SYSTEM/GIT_CONFIG/HOME/XDG_CONFIG_HOME pointing at agent config; --upload-pack/--receive-pack/-u and remote.*.uploadpack; script(1) fake-tty pager.
- [x] **K5** (items 31-35) done 2026-11-10 13:36 CST: scoped 3171/3171, full 6567 + 3 allowed fails, tsc clean, no orphans. Note: K5 acceptance tests were written after the code (unit tests did go RED first); K6 must show them fail with the K5 code disabled.
- **K5 user decisions (2026-11-10):** `GIT_SSH_COMMAND`/`core.sshCommand` → allow when the program word is `ssh` (or an absolute ssh path), refuse ProxyCommand/LocalCommand options and anything else. credential `!` helpers → refuse shell programs (`sh`, `bash`, `zsh`, `f()`) and absolute programs outside standard bin folders. Fix: unwrap `script`/`unbuffer`/`expect` (K6). **Deferred by the user, by name:** `git send-pack --receive-pack=…` and `git archive --remote … --exec=…`.
- [x] **K6** (items 36-38) done 2026-11-10 14:11 CST: acceptance tests RED-first; K5 acceptance proven (22/40 fail with K5 off); scoped 3302/3302, full 6698 + 3 allowed fails, tsc clean, no orphans.
- **K6 user decisions (2026-11-10):** fix all in K7: absolute ssh only from standard bin folders; strip quotes on helper program word; push lets a checked `GIT_SSH_COMMAND`/`core.sshCommand` through (user chose to loosen); script/flock file operand = write target; util-linux `-c` after the file; read `expect x.exp`/`-f` script files. **After K7: stop fixing, run the round-4 re-check; new non-blocking findings → FOLLOWUPS, ask the user only about blockers.**
- [x] **K7** (items 39-44 + Known Limits tidy) done 2026-11-10 15:15 CST: scoped 3402/3402, full 6798 + 3 allowed fails, tsc clean, no orphans. Open small choices to put to the user with the re-check results: `export GIT_SSH_COMMAND=…; git push` still refused (only the push's own carried value is loosened); `cp x *.exp && expect y.exp` reads y.exp (wildcard writes not counted as written).
- [x] FIX_HEAD snapshot `d9e85c58e59d4fdc3f7480e4b1fbe23dfb03ea57` (FIX_BASE bc612db…). Round diff saved: `/private/tmp/claude-501/-Users-ysl-dev-oss-plugin-tool-gates/ac0a5463-1408-4cbc-a165-5ef79dd9a6bc/scratchpad/round4.diff` (37 files). Context: `ship/round4-context.md`.
- **Round-4 pen-test: FAIL, partial** (a safety classifier stopped a later batch; not resent). Confirmed new-in-round-4 bypasses: macOS `script -F` read as taking a value (HIGH); util-linux `script -t` unattached (MED); `faketime -p` (MED, unverified flag); `expect` with a stdin script via pipe/here-string (HIGH); awk `print | "sh"` fed by stdin (HIGH); BSD sed `[/]` delimiter (MED). Older: wrapper value options missing (`env -P/-L`, `sudo -R/-c`, `doas -a`, `xargs -J/-R/-S`, `time -o` write), long-tail wrappers (`su -c`, `busybox sh -c`, `tmux`, `screen`, `at`, …). Intended-but-bypass: `sed -f`/`awk -f` from stdin, `<(…)` or a file written in the same call. **User (2026-11-10): run a NEW pen-test on the untested surfaces only, after the other 3 report** (gawk -l/@load, dotglob, lost cd, history moves, git -c/env program keys, ssh+credential allowlists, push loosening, repo-finder, budgets/timer).
- **INCIDENT 2026-11-10:** the round-4 code-reviewer's cleanup ran `rm -rf` on the parent of a mktemp dir = macOS `$TMPDIR` (/var/folders/zj/…/T) for ~120 s before it stopped. Repo, scratchpad and oss-gate snapshots verified intact. Unknown what was lost in `$TMPDIR`. Told the user; perf + security agents were warned to delete only their exact mktemp paths. **Every future agent brief must include that cleanup rule.**
- **Round-4 code review: FAIL** (scoped 3402/3402, tsc clean). HIGH security: awk `print | "sh"`; `echo` escape decoding (`\0151`) in piped scripts; expect Tcl `;`/`exec` inside a `send` quoted with `'`; expect with a stdin script; credential.helper non-`!` value with `;`; `!` helper deny-list gaps (`nohup`, `{ }`, `awk`, …); ssh `-I`/PKCS11Provider/SecurityKeyProvider/Include. MED security: more program-running keys (trailer.*.command/cmd, mergetool/difftool cmd, submodule.*.update=!, gpg.ssh.defaultKeyCommand, sendemail.smtpServer); `python3 -c"$C"` attached and `node -r "$M"`; `bash -O dotglob -c`, `BASHOPTS`, `zsh -o globdots`. MED correctness: `find . -name '*.log' -delete` at the root over-refused with a misleading reason. LOW: history-move reason after a same-call checkout; nestedRefusal path not resolved. INFO: thresholds 2048 and 10000 are code constants.
- **Round-4 perf: FAIL.** Ordinary calls 75-94 ms (OK). HIGH security (fail-open past the 2.5 s worker limit → allowed with gate-error, all rules skipped): expect script file re-read and re-tokenized per part with no byte or separator budget (`command-reader.ts:680-700`); `repoTrust` walks a long missing path with a `dirname` loop, uncached, per commit/push (`repo-finder.ts:133`, `gate.ts:240`). MED security: tree-finder deadline checked only between folders, so one huge `readdirSync` runs unbounded (`tree-finder.ts:45-48`). Recommended safety net: a deadline check inside the tokenizer/reader loops.
- **Round-4 security audit: FAIL.** CRITICAL: tree-finder fail-open (single huge `readdirSync`; same as perf F3). HIGH: `checkout -B`/`switch -C`/`fetch . +x:refs/heads/main` move main; case-variant `MAIN` refs (macOS case-insensitive; `ctx.caseInsensitive` unused in protected-branch); `script -F`; awk `| "sh"`. MED: ssh `-I`/PKCS11Provider/SecurityKeyProvider/XAuthLocation/`Proxy\Command`; more RUN_COMMAND_KEYS (difftool/mergetool/trailer/gpg.ssh/interactive.diffFilter/sendemail/browser/submodule.update/hook.*); `!` helper deny-list gaps (awk, xargs, command, osascript); `GIT_EXEC_PATH`/`--exec-path`, `GIT_DIR`/`--git-dir` with a planted config. LOW: tree-finder treats an unreadable folder as empty; TOCTOU on disk reads (expect file, repo-finder, tree search). INFO: listed known limits (`find -exec rm`, rimraf, perl rmtree, xargs rm). Its sandbox cleanup used a `tg-*` glob (under /private/tmp/claude-501 only).
- **Follow-up pen-test: FAIL, stopped again** (a classifier stopped it while it built surface 5; surfaces 5-9 untested; surfaces 1-4 done). HIGH: `CDPATH=.git cd hooks && …` (no CDPATH handling); dotglob gaps (`bash -O dotglob -c`, `BASHOPTS`, `zsh -o globdots`/`--globdots`, `builtin`/`command`/`eval shopt`, `setopt dotglob`); `gawk -f ip.awk <protected>` / `sed -f s.sed <protected>` (a script file can `@include "inplace"`), plus `gawk -i/-l/@load` of agent code. MED-HIGH: filter-branch, filter-repo, fast-import, subtree merge/pull, replace and reflog delete on main. MED: `git pull . feat` / `pull --rebase origin feat` merges a local branch into main (is that what "allow pull" meant?). LOW: `cd "$X" && mv hooks /tmp/h`. Cleanup used exact mktemp paths. **Standing rule: the pen-test was stopped again → asked the user before anything else.**
- [x] **Follow-up pen-test** (untested surfaces only, per the user) launched 2026-11-10 with the strict cleanup rule.
- **User decisions after the round-4 re-check (2026-11-10):** (1) **K8 = LAST fix part**: a fail-safe (per-call deadline in every hot loop, so over-time → refuse) plus all CRITICAL/HIGH findings; every MEDIUM/LOW deferred by name to FOLLOWUPS and the PR body; add an ADR: "the gate stops agent mistakes and shortcuts, not a determined adversary". Then ship. (2) Pen-test record: count the auditor's probes for surfaces 5-7 and 9; mark the pen-test PARTIAL in the timeline and the PR body (surfaces 5-9 not pen-tested). (3) Pull on a protected branch: only main's own upstream; refuse `pull .`, a local path, or another branch.
- [x] **K8** done 2026-11-10 16:49 CST: all 15 items closed; full 7112/7115 (3 allowed), tsc clean, bundle test passes, no orphans (verified by Claude 17:04). Details: NOTES.md "Fix round 4 (K8, …)".
- **K8 user decisions (2026-11-10):** exported CDPATH → every `cd <name>` lost: keep refusing. `cd "$X" && git pull origin main` refused: keep. **Deferred by the user, by name:** `git fast-import` from a feature branch writing `refs/heads/main` from stdin; a plain-name write under a multi-folder CDPATH (lost-cd single-file residual). Fix the timing-sensitive test `git-reader.integration.test.ts` "should end git and every program it started…" (test-engineer pass; delete if it can't be made reliable).
- [x] Timing test fixed 2026-11-10 (test-engineer). Root cause: macOS holds a newly written script's first run for a policy check, which ate the 1000 ms limit; the fake git is now warmed first, its pid is written whole, and a pid-0 false pass is closed. File alone 12/12 and 5/5 under load; scoped 3716/3716; tsc clean. Test-only change.
- [x] ADR-011 written in DECISIONS.md (the gate stops agent mistakes and shortcuts, not a determined adversary).
- **Severity miss (2026-11-10):** the code reviewer rated two findings HIGH, but I had them at the auditor's MEDIUM: ssh options that load programs (`-I`/PKCS11Provider/SecurityKeyProvider/Include/XAuthLocation/`Proxy\Command`), and `!` helper runner gaps (`nohup`, `{}`, `awk`, `xargs`, `command`, `osascript`). Told the user. **User: short K9 fix (allowlists for both)**, plan `ship/round4-k9.md`, then a narrow re-check by the code-reviewer and security-auditor on K9 only.
- [x] FOLLOWUPS: 24 round-4 lines appended 2026-11-10 via the guarded command (all MED/LOW/INFO plus the user-named deferrals; the K9 items were NOT appended). Never re-append them.
- [x] **K9** done 2026-11-10 18:38 CST: both items closed; full 7226/7229 (3 allowed), tsc clean, bundle test passes, no orphans (verified by Claude 18:45). Three tests changed ForwardAgent → BatchMode/IdentitiesOnly.
- **K9 user decisions (2026-11-10):** add harmless ssh `-o` keys to the allowlist (ForwardAgent, ConnectionAttempts, HostKeyAlgorithms, PubkeyAcceptedKeyTypes/Algorithms, KexAlgorithms, Ciphers, MACs). **Fix in K10:** `!` helper programs that run their arguments but aren't in the reader's tables: `git` with `-c`/`--config-env`, `op run` with a relative/variable program, `find -exec`, `watch`, `parallel`, `make`, `vim`/`ex`, `tclsh`, `lua`, `csh`/`tcsh`, `pwsh`. `!op plugin run -- gh` stays allowed.
- [x] **K10** done 2026-11-10 18:51 CST: full 7313/7316 (3 allowed), tsc clean, bundle test passes, no orphans (verified by Claude). `!git` with `-c`/`--config-env`/`--exec-path` refused; `op run` checks its `--` command; `find` always refused as a helper.
- **K10 user decision (2026-11-10):** the helper long tail (`rsync -e`, emacs, gdb, Rscript, julia, swift, `go run`, npx/`npm exec`, `!git <alias>`) is **deferred by name** as one HIGH FOLLOWUPS line (appended; 25 round-4 lines now) with the allowlist note.
- [x] **Timeline round 4 written** 2026-11-10 (all exit 0): code-review fail high=7 medium=4 low=2 info=1 / fixed high=7 medium=1; performance fail high=2 medium=1 / fixed all; security fail critical=1 high=4 medium=4 low=2 info=1 / fixed critical=1 high=4 medium=2; pen-test fail (PARTIAL, both runs combined) high=7 medium=7 low=1 / fixed high=7 medium=2. Never re-write them.
- **Round-5 perf: FAIL.**
  - HIGH security: the `STRING_LITERAL` regex in `protected-path-mention.ts:124` (used in `literalsOf` :285 and `literalCount` :327) is quadratic on an unclosed `"\"\"…` body. A 100 KB heredoc to `python3`, then a push to main, gets past the hard limit → ALLOWED with gate-error. Heredoc bodies don't count toward the 64 KB word cap. Fix: a linear regex `(?:"|$)` or a scanner with `tick()`; scan once; count heredoc bodies toward the call cap. Older code, but it breaks the K8 promise.
  - INFO: `findRepo` swallows OverBudget into `unsure` (still refused; wrong reason). INFO: a network automount stalling a single syscall (out of scope).
  - Round-4 repros all refused fast; ordinary calls take 78-103 ms.
- **Round-5 code review: FAIL.** All findings reproduced.
  - HIGH:
    1. `checkout -qB main`, `switch -qC`, and `--force-c` abbreviations (`forceCreated`/`FORCE_CREATE_ATTACHED`).
    2. Tcl backslash escapes `\151`/`\x69` in expect quoted words (`tclCommands`).
    3. `CDPATH+=` / `cdpath+=(…)` (`cdpathAfter`).
    4. dotglob in clusters `bash -eO dotglob` / `zsh -eo globdots` (`shellDots`).
  - MED:
    5. awk pipe target concatenation `| "s" "h"` (sed-awk.ts ~393).
    6. `!op --account a run -- ./x` (`helperCommandRuns`).
    7. filter-branch/filter-repo naming main through a range or glob (`feat/x..main`, `--glob=`) (`namedRewrite`).
  - LOW:
    8. pull `origin MAIN`, remote branch names case-folded (`ownUpstream`).
    9. util-linux `script --c=`/`--comm=` abbreviations.
    10. `-c remote.origin.fetch=…:refs/heads/main fetch`.
    11. bash `cdable_vars` (older).
- **Round-5 security: FAIL.**
  - MED:
    1. grouped `-qB/-fB/-tB` and `--force-c`;
    2. pull `x:main` from a feature branch, `--refmap`, `--stdin`, `-c remote.*.fetch`;
    3. `rebase feat/y main` from a feature branch, `worktree add -B main`;
    5. command strings run by git subcommands (`rebase -x`, `bisect run`, `submodule foreach`, `--tree-filter`);
    6. `git config credential.helper` writes skip all helper checks;
    7. `git clean -ffd` over a nested repo.
  - LOW:
    4. filter-branch globs, `replace`;
    8. dotglob clusters, `GLOBIGNORE=` prefix, zsh `options[]`;
    9. zsh `cdpath+=`, `typeset`, `cdpath[1]`;
    10. awk `"SH"`, `"s" "h"`, `\x00`;
    11. writable standard bin folders;
    12. `-c` on pull.
  - INFO: 13.
- **User decision after round 5 (2026-11-10): "K11 for 3 groups, then ship."**
  - (A) the time-limit allow plus the findRepo reason;
  - (B) the HIGH near-misses: grouped/abbreviated `-B/-C`, Tcl escapes, all CDPATH forms, all dotglob/GLOBIGNORE forms;
  - (C) plausible shortcuts: reversed rebase/worktree `-B` onto main, `git clean -ff` over a nested repo, `git config credential.helper` writes.
  - Every constructed chain is deferred by name: 12 FOLLOWUPS lines "(round 5)" appended.
  - The final re-check reports only failures of K11's own fixes; other variants go straight to FOLLOWUPS.
- [x] fix-base for round 6 = b77dcd6 (the round-5 head), written before K11.
- [x] **K11** done 2026-11-10 20:16 CST.
  - All 9 items closed, plus `zsh -4c` and 7 quadratic option-cluster regexes.
  - Tests: scoped 4186/4186; full 7582/7585 (only the 3 allowed failures); tsc clean; no orphans (verified by Claude).
  - New gaps → FOLLOWUPS (round 6) after the re-check: `export GIT_DIR+=…`, `emulate zsh -c`, `git config --global` writing `~/.gitconfig`, `rebase --update-refs`.
- [x] fix-head = f1a7c6e. Round-6 diff: scratchpad `round6.diff` (1685 lines, 16 files). Context: `ship/round6-context.md` (narrow scope rule).
- [x] Timeline round 5 written (code-review fail high=4 medium=3 low=4 / fixed high=4; performance fail high=1 info=2 / fixed high=1 info=1; security fail medium=6 low=6 info=1 / fixed medium=4 low=2).
- [x] **Round-6 re-check done: all 3 FAIL.**
  - Code review: HIGH K11 regression in `stringLiterals` (an apostrophe in a comment hides later literals, so `.git/config` writes in python/node heredocs are allowed; also over-refuses ordinary scripts over 4 KB). MED item 8 (`./sub`, no slash). LOW `cdpath[1]=(…)`, `zsh -eoglobdots`/`options+=`/`options[globdots]=$V`. Over-refusals: worktree `--reason main`; helper `store --file ~/…`.
  - The flaky test `tool-gate.cli.test.ts:186` fails whenever the whole file runs.
- **User decisions after round 6 (2026-11-11):**
  - K12 = both regressions + items 8/9 + 3 over-refusals + the flaky test; the low dotglob/cdpath spellings are deferred by name.
  - The final re-check covers only K12's diff (new variants → FOLLOWUPS unless they are a K12 regression or a time-out allow).
  - Deadline 1.0 s, checked every 256 steps.
- [x] fix-base for round 7 = f1a7c6e.
- [x] **K12** done 2026-11-11 07:41 CST.
  - 6 of 7 items closed; deadline now 1.0 s, checked every 256 steps; ADR-011 text updated.
  - Tests: full 7728/7731 (3 allowed failures); scoped 4332/4332; tsc clean; no orphans (verified by Claude).
- **K12 user decisions (2026-11-11):** `credential.helper 'store --file …'` → keep refusing, deferred. Scanner gaps (apostrophes far apart pair up; apostrophes more than 4 KB apart over-refused) → deferred. 3 FOLLOWUPS lines appended (round 6 now 9).
- [x] fix-head = fc49d9d (base f1a7c6e). Diff: scratchpad `round7.diff` (1158 lines, 18 files). Context: `ship/round7-context.md`.
- [x] Timeline round 6 written (code-review fail high=1 medium=1 low=4 / fixed high=1 medium=1 low=1; performance fail high=1 low=1 / fixed both; security fail medium=3 low=3 info=2 / fixed medium=2 info=1).
- **Round-7 security: PASS.** Items 2, 3, 4 and 5a close their class (about 240 cases); no regressions; no deadline fail-open (116 round-6 repros replayed, quiet and at load about 110; the slowest refusal took about 1.22 s).
  - Out of scope → FOLLOWUPS:
    - MED: `git config rename-section <x> core` checks only the old section name (`push-setup.ts` ~282). Older; plants `core.hooksPath`.
    - LOW-MED: `\'` inside a `'…'` literal ends it (`stringLiterals` ~301). Older.
    - LOW: a stray `"` pairs with a later literal (deferred class).
  - INFO: 5b still refused; `git clean -fd` at the root refused when `.oss/` is untracked.
- **Round-7 perf: PASS.**
  - No fail-open: the CDPATH repro is refused in about 222 ms; 56-80 copies in parallel and CPU burners all refused, max 1.86 s.
  - Ordinary calls: 82-119 ms idle; under load up to 1.31 s, none refused.
  - LOW (not security): `git clean -ffd` over 9000 folders (item 5c) is allowed or refused depending on machine load, fails closed (`gate.ts:90/:96`).
  - INFO: near-2048-path cleans are refused under load.
  - Out of scope LOW: `namedBelow` re-walks cached entries with no tick (`tree-finder.ts:82-90`).
  - The agent left 48 CPU burners running, then killed them about 09:42.
- **Round-7 code review: FAIL (narrow).** All items close their classes except 5c: it has no effect in production (the 1.0 s deadline also covers git's dry run), and its acceptance test froze the clock. LOW, not security, fails closed.
- **User decision (2026-11-11): accept 5c as fail-closed, fix the misleading test, ship.** A test-engineer is replacing or removing the frozen-clock test (test-only, no re-check needed).
- [x] Timeline round 7 written (code-review fail low=1 info=2; performance pass low=2 info=1; security pass medium=2 low=1 info=2).
- [x] FOLLOWUPS round 7: 6 lines (rename-section MED, `\'` in single quotes MED, stray-quote pairing LOW, 5c over-refusal LOW, namedBelow tick LOW, `.oss` clean INFO).
- [x] Frozen-clock test removed (test-only; scoped 4331/4331, tsc clean). The tree-clock unit test already pins K12's change.
- [x] Snapshot cleanup done (oss-gate index/fix-base/fix-head removed).
- [x] **Step 2 final review** FAIL 2026-11-11: no CRITICAL/HIGH, no security. 3 MEDIUM (refusal advice points at a repo-file key the gate rejects; runners like `python3 -m pytest`/`pnpm vitest`/piped runs not recorded; `rm -rf "$d"` refused as too complex via the DYN placeholder) + 4 LOW.
- **User decision (2026-11-11): small K13 for MEDIUM 1-3, then PR.** LOW 4-7 appended to FOLLOWUPS as "(final review)" (75 tool-gates lines now). Never re-append.
- [x] **K13** done 2026-11-11 (plan `ship/final-k13.md`; NOTES "Fix part K13"): verified tsc clean, scoped 4375/4375, bundle rebuilt, no orphans.
- [x] **K13 narrow re-check** 2026-11-11: code-review PASS, security PASS. Both found an older gap: a variable inside a recursive glob (`rm -rf .${d}*`, `chmod -R 777 ${d}*`) allowed.
- **User decisions (2026-11-11):** tiny **K14** fixes the glob+variable gap, then PR. Deferred by name (FOLLOWUPS "(K13 re-check)", 3 lines; 78 tool-gates lines now): unchecked recursive writers chgrp -R / find -exec / cp -r / rsync --delete to a variable (security LOW), extra runner spellings, `rm -rf "$TMPDIR/x"` refused.
- [x] **K14** done 2026-11-11: `protected-path.ts:277` checks `pattern.includes(UNKNOWN)` (whole glob). Verified tsc clean, scoped 4390/4390, bundle rebuilt, no orphans.
- [x] **K14 re-check** 2026-11-11: security PASS, code-review PASS.
- **User decision (2026-11-11): defer by name, open the PR.** 3 security LOW lines "(K14 re-check)" appended (find -exec rm -rf to a variable, chgrp -R not a recursive writer, cp/mv into a variable glob); 81 tool-gates lines now.
- [x] Preflight 2026-11-11 (manual, in watcher/: build ok, no lint script, no console.log; full suite 7786/7789, 3 known #221 failures). `npm run build`'s tsc emitted 156 untracked dist files; removed with `git clean -f -d -- watcher/dist` after checking all were new.
- [x] Commit a5191ce pushed; **PR #224** → feat/determinism-sprint/build (https://github.com/501336North/one-shot-ship-plugin/pull/224).
- [x] 2026-11-11 (user's message): #221 re-tested on current main (all green; the one statusline failure was the detached temp worktree, passes on a branch) → **#221 merged to main (368e074)** → **#224 merged into feat/determinism-sprint/build (c008d9a)**. Main NOT yet merged into the sprint branch (user did not ask).
- [x] 2026-11-11 (user: "do all the items"): main brought into the Sprint D branch (PR #225, merge commit ab9e782; FOLLOWUPS conflict kept both blocks; full suite 7790/7790). API Figma PR **#439** opened against the NEW API Sprint D branch `feat/determinism-sprint/build` (created from API main a774a57), NOT merged. Dev docs archived to .oss/dev/completed/ on branch chore/tool-gates/archive (PR into the Sprint D branch).
- **User rule (2026-11-11): ALL Sprint D work, both repos, branches from and PRs into feat/determinism-sprint/build; main only after DeepBlue testing of the whole sprint.**
- (old) K14 launched 2026-11-11 (oss:typescript-pro), plan `ship/final-k14.md`. Then verify → quick re-check of K14 only (code-reviewer + security-auditor) → preflight → commit → push → PR.
- (old) K13 launched 2026-11-11 (oss:typescript-pro), plan `ship/final-k13.md`. Then: verify (tests, tsc, pgrep) → narrow re-check of K13 (code-reviewer + security-auditor) → preflight → commit → push → PR.
- (old) Step 2 final review (code-reviewer, whole branch since 71514cd) launched 2026-11-11. Context: `ship/final-review-context.md`. Per the ship rules, a CRITICAL/HIGH or new security finding at LOW or above blocks → fix + narrow re-check (code-reviewer + security-auditor), or ask the user. Then preflight → commit → push → PR.
- [x] **Round-7 final re-check** launched (code-reviewer, performance-engineer, security-auditor). Then: timeline rounds 6 + 7 → snapshot cleanup → final review → preflight → commit → push → PR.
- (old) **K12** launched 2026-11-11 (oss:typescript-pro), plan `ship/round6-k12.md`. Then: verify → fix-head → round-7 re-check (3 agents, scope K12) → timeline round 6 + 7 → FOLLOWUPS round 6 → final review → preflight → commit → push → PR.
- **Round-6 perf: FAIL, class (c).**
  - HIGH security, new in K11: `cdpathAfter` (command-reader.ts:1425-1441) appends with join and split per `CDPATH+=` word, with no `tick()`. It is called twice for an assignment-only segment (:594, :599). Input: `CDPATH=` + 44k colons + 2000 × `CDPATH+=:` + `; git push origin HEAD:main` (64 KB). Takes about 2.35-2.9 s; ALLOWED with gate-error under load, sometimes alone too.
  - Also: separate segments are refused at 1.6-2.5 s wall, past the 1.5 s deadline (thin margin to the 2.5 s hard limit under load).
  - LOW: `git clean -ff` over a big untracked tree (about 9000 folders, no nested repo) is over-refused at about 1.08 s, because the dry run uses up the 1000 ms tree budget.
  - Everything else is cleared; ordinary calls take 78-119 ms.
- **Round-6 security: FAIL** (7 of 9 items close their class; no regressions, no deadline fail-open).
  - MED, item 8 not closed: `git-clean.ts:211` treats an entry as a folder only by a trailing `/`. When the cwd is inside an untracked or ignored folder, the dry run lists `./name` with no slash, so `cd u2/w && git clean -ffd` (nested repo below) is allowed.
  - MED, item 9 not closed: `push-setup.ts:61` `CONFIG_VALUE_OPTIONS` uses exact names only. `git config -t bool-or-str credential.helper '!sh …'`, `-zt`, `--ty`, `--comm x`, `set --val x` misparse key and value (git 2.54 confirmed). This also hits `core.hooksPath`/`alias`/`sshCommand` writes (older).
  - LOW-MED, item 6 borderline: `shopt -qs dotglob` (cluster), `command-reader.ts:509` `args.includes('-s')`; zsh `unsetopt +4` (:517).
  - Out of scope → FOLLOWUPS:
    - CDPATH via `set -A`/`read`/`printf -v`/`eval`/`${:=}`;
    - zsh `options+=(globdots on)`, `(*|.*)`;
    - expect over-refusal of `\[ \] \$ \{` in quoted words (`TCL_UNREAD_QUOTED`, :894/:972);
    - `find -delete` at the root (already listed).
  - INFO: `tool-gate.cli.test.ts:186` "should end the whole process group…(K2)" is flaky under parallel load (passes 10/10 alone). Same macOS first-exec cause as the earlier git-reader test?
- (old) **K11** launched 2026-11-10 (oss:typescript-pro), plan `ship/round5-k11.md`. Then: verify → fix-head snapshot → round-6 narrow re-check (code-reviewer, performance-engineer, security-auditor; scope = K11's own fixes) → timeline round 5 (3 gates, fixed counts after K11) and round 6 → final review → preflight → commit → push → PR.
- [ ] **Round-5 narrow re-check** launched 2026-11-10 (code-reviewer, performance-engineer, security-auditor; background). fix-base = d9e85c5 (round-4 head, written by Claude), fix-head = b77dcd6. Diff: scratchpad `round5.diff` (3344 lines, 24 files). Context: `ship/round5-context.md`. The pen-tester is not re-run: per the user, the round-4 pen-test is recorded PARTIAL and the auditor covers it. Then: timeline lines for round 4 (4 gates) and round 5 (3 gates).
- (old) **K9** launched 2026-11-10 (oss:typescript-pro). After K9: verify → snapshot `fix-head` → narrow re-check (code-reviewer + security-auditor, K9 only, round 5) → timeline lines for round 4 (4 gates) and round 5 → snapshot cleanup → final review → preflight → commit → push → PR.
- [ ] (old line) **K8** launched 2026-11-10 (oss:typescript-pro, fresh agent). Plan: `ship/round4-k8.md` (items 1-15). After K8: verify; write the ADR (DECISIONS.md, ADR-011, Claude writes it); write the timeline round-4 lines (code-review fail, performance fail, security fail, pen-test fail/partial, with fixed counts after K8); append every MEDIUM/LOW deferral to FOLLOWUPS via the guarded command; final code review → preflight → commit → push → PR (`--base feat/determinism-sprint/build`). Merge only after #221. Then: consolidated blocker list → user (recommend one fix part K8 for CRITICAL/HIGH + cheap MED, defer the rest by name), timeline round-4 lines, FOLLOWUPS appends.
- [x] **Round-4 narrow re-check** (4 agents) launched 2026-11-10 (code-reviewer, performance-engineer, security-auditor, penetration-tester, background). Then: timeline round-4 gate lines (4 agents), FOLLOWUPS appends for every deferral named by the user in round 4, blockers → user.

## Suggested Next Steps
1. **First, ask the user about K1's unasked choices** (AskUserQuestion, one picker each):
   - (a) K1 added a 1.2 s total git-time budget per call: real git that runs out of time is now refused, not allowed.
   - (b) `git clean -f` whose dry run would list more than 2048 paths is now refused, with a hint to clean a narrower folder.
   - (c) **New security gaps K1 found:** `currentBranch` still runs in a folder with a planted `.git` file, so a planted gitdir's HEAD decides the branch that commit/push checks read there; `git clean -fdx ':(glob).o*'` magic pathspecs are not checked against the text fallback; the process-group kill is best effort at the exact moment of worker termination. Fix in K2 or defer? Ask by name.
2. Launch **K2** (`oss:typescript-pro`) with `.oss/dev/active/tool-gates/ship/round4-fixes.md` Part K2 (items 5-18) and `ship/fix-rules.md`, plus whatever the user picks for 1(c). Brief: no silent deferrals; report trade-offs as "needs the user's decision".
3. pgrep for orphans. Take the FIX_HEAD snapshot (ship prompt step 3: the snapshot command with `snap=fix-head`), then save the round diff.
4. **Narrow re-check** (round 4): code-reviewer, performance-engineer, security-auditor, penetration-tester. Context file: `ship/round3-context.md` (update the round number, and point at the round-4 diff). Timeline round 4 lines via the Write tool (`~/.oss/hooks/oss-value.sh dir`, 6 files, `oss-value.sh timeline gate`). Non-blocking findings go to FOLLOWUPS via the guarded append. Never re-append a finding.
5. If a re-check reports a new blocker, or the same finding survives 2 fix rounds, ask the user again ("keep fixing until clean" / "stop here").
6. When clean: snapshot cleanup command → final code review → preflight → Step 3 commit (branch check; message file; no CLAUDE.md/ndjson) → push → `gh pr create --base feat/determinism-sprint/build` with title/body files. List every security finding, deferral, and the pen-test history in the body. Then `oss-notify.sh` quality_passed / pr_created.
7. Merge only after #221 is merged and main is merged into the sprint branch. The ship's merge scripts hardcode main: adapt them to the sprint branch, or stop and tell the user. Then archive the dev docs (run the symlink guard first), build report, learnings, memory update (`project_tool-gates.md`: phase shipped, PR #), and `complete` exactly once.
8. After the ship: the separate API PR moving the Figma context out of `.oss/workflow-state.json`.

## Context for Resumption
- The decrypted ship workflow was saved by the old session at `/Users/ysl/.claude/projects/-Users-ysl-dev-oss-plugin-tool-gates/2dd4ade3-c8f4-4ee8-a00a-c9b7978a8f6b/tool-results/bjzcih2e5.txt`. Re-fetch it with `~/.oss/bin/oss-decrypt --type workflows --name ship` if that path is gone. Key parts: Step 1.5 round rule and cap, snapshot and round-diff commands, timeline, FOLLOWUPS path and append commands.
- Ship plan copies are in `.oss/dev/active/tool-gates/ship/`: `round4-fixes.md` (K1/K2 items + re-check note), `fix-rules.md`, `round3-context.md`.
- Round-3 reproduction harnesses (in the old scratchpad, survive until reboot): `/private/tmp/claude-501/-Users-ysl-dev-oss-plugin-tool-gates/2dd4ade3-c8f4-4ee8-a00a-c9b7978a8f6b/scratchpad/`, folders `perf/` (`run.js`), `r3sec/` (`gate.sh`), `h/`, `pt/`. Round diffs: `round1.diff` and `round2.diff` in the same folder.
- Timeline value folder: `/Users/ysl/.oss/run/da67a580e9f4b87e`. FOLLOWUPS scratch: `/Users/ysl/.oss/run/c73629ac791f23f2/followup.txt`.
- Tests: `cd watcher && npx vitest run test/tool-gate test/cli test/hooks` (scoped), and `npx vitest run` (full). Only model-frontmatter, offload-step-safety and chain-step-contract may fail (fixed by #221). This branch's `watcher/test/setup.ts` uses a temp HOME and kills nothing (checked 2026-11-10), so the full suite is safe here. Type check: `./node_modules/.bin/tsc --noEmit -p .`. Bundle: `npm run build:cli-bundle`, then restore `watcher/dist/cli/oss-launch.cjs` with `git checkout --`.
- The `.oss/session-context.md` written at 08:33 by another session did not know about the ship and is replaced by this handoff.
