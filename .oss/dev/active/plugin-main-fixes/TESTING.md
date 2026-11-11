# Testing: plugin-main-fixes

- Targeted shell tests only; never the watcher's full suite (it pkills OSS processes machine-wide). macOS has no `timeout` (use perl alarm).

## Results (2026-11-11)
- Task 1 RED: new test 2 failed on fixture copies (hook call removed; inline "# Project Development Guide" added). GREEN: ideate-template 4/4, oss-claude-md-template 27/27.
- Task 2 RED: old broad grep failed the cleanup cases (11/15). GREEN: no-telegram-command 15/15; no-telegram-hook 3/3, oss-settings-telegram-cleanup 22/22, oss-stop-telegram-style 2/2.
- Task 3 RED: no-metrics-push 0/2 while the hook existed; after D4 2/4 while the analyzer existed. GREEN: no-metrics-push 4/4, oss-config-one-object 109/109, body-cap 55/55, oss-config-one-read 18/18, oss-api-curl 24/24, referenced-hooks-tracked 48/48.
- Task 4: session-start-no-hook-downgrade 41/41, changelog 14/14, check-updates 18/18, oss-config-dash-hooks 17/17.
- Regression: every file in hooks/__tests__ and commands/__tests__ run alone: 121/121 files pass (tests-hermetic-env caught a missing unset in the Task 1 test, fixed in f15451d; watcher-dist-fresh/typecheck needed `npm ci` in watcher/ in this new worktree; session-start-outside-kill needs > 300 s).
