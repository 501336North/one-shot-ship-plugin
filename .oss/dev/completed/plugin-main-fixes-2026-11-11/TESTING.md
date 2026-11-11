# Testing: plugin-main-fixes

- Targeted shell tests only; never the watcher's full suite (it pkills OSS processes machine-wide). macOS has no `timeout` (use perl alarm).

## Results (2026-11-11)
- Task 1 RED: new test 2 failed on fixture copies (hook call removed; inline "# Project Development Guide" added). GREEN: ideate-template 4/4, oss-claude-md-template 27/27.
- Task 2 RED: old broad grep failed the cleanup cases (11/15). GREEN: no-telegram-command 15/15; no-telegram-hook 3/3, oss-settings-telegram-cleanup 22/22, oss-stop-telegram-style 2/2.
- Task 3 RED: no-metrics-push 0/2 while the hook existed; after D4 2/4 while the analyzer existed. GREEN: no-metrics-push 4/4, oss-config-one-object 109/109, body-cap 55/55, oss-config-one-read 18/18, oss-api-curl 24/24, referenced-hooks-tracked 48/48.
- Task 4: session-start-no-hook-downgrade 41/41, changelog 14/14, check-updates 18/18, oss-config-dash-hooks 17/17.
- Regression: every file in hooks/__tests__ and commands/__tests__ run alone: 121/121 files pass (tests-hermetic-env caught a missing unset in the Task 1 test, fixed in f15451d; watcher-dist-fresh/typecheck needed `npm ci` in watcher/ in this new worktree; session-start-outside-kill needs > 300 s).
- D6: run-shell-tests 3/3 (passing fixture exit 0, node_modules skipped; a failing file exits non-zero and is named). Whole repo: all shell test files pass via scripts/run-shell-tests.sh.
- D5 revert: auto-permissions back to 16/16 with no merge-test entry.

## Ship gate rounds (2026-11-11, /oss:ship --merge; owner chose "keep fixing until clean" after round 3)
- Round 1-2 fixes: runner runs each file under `env -i` (allow-list), its own empty HOME, /bin/bash, no stdin, a time limit (RUN_SHELL_TESTS_TIMEOUT, default 1800 s) with a group kill (run_capped); fails on symlinks, empty finds and bad limits; whole body in main(). Full run after round 2: all 136 files pass (1916 s).
- Round 4 fixes: sorted list loaded before any test (a test killing `sort` can no longer cut the run short); SSH_AUTH_SOCK dropped; run_capped unblocks SIGALRM and kills the group on INT/TERM/HUP; leak and rewrite fixtures tightened; metrics guard skips only `*/__tests__/*.test.sh`. run-shell-tests 26/26, no-metrics-push 12/12, no-telegram-command 23/23.
- Round 5 fixes: run_capped unblocks SIGALRM and holds INT/TERM/HUP back before the fork (the command gets the caller's mask minus SIGALRM); the runner test's machine-wide `pkill -f '^sleep 300$'` replaced by a marked sleeper with a "nothing left" check. RED: under a caller blocking SIGALRM, a command's `read -t 1` ran to the 20 s cap (rc 124) on the old run_capped; GREEN: run-capped 24/24, no-hand-capped-tests 37/37, run-shell-tests 27/27.
- Round 6 fixes (code review of round 5): the Ctrl-C check resets SIGINT itself, so it passes when the suite runs in the background (it failed under `& wait` before); 30 s watchdog on checks 5a-5b (a no-unblock mutant now fails at 30 s instead of hanging); `# shellcheck shell=bash` in run-capped.sh. run-capped 24/24 foreground and background, no-hand-capped-tests 37/37, shellcheck clean. Round 6 code review and security: PASS.
- Known limits (owner): D7 keyword-guard evasion; D8 a test that SIGSTOPs run_capped hangs the run (outer timeout only).
