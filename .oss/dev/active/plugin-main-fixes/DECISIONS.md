# Decisions: plugin-main-fixes

- D1: next version 2.1.1 (owner numbering after 2.0.99). Updated 2026-11-11: 2.1.1 (#222) and 2.1.2 (#223) shipped first, so this release is 2.1.3.
- D2 (owner, 2026-11-10, AskUserQuestion): delete the metrics push (option B). The G1-G4 timeline already gives the dashboard its data; the hook is never called.
- D3: test changes in Tasks 1-2 are marked ⚠ changes existing test and quote the spec they replace.
- D4 (owner, 2026-11-11, AskUserQuestion): also delete hooks/oss-log-analyzer.sh. It only fed the push and had no other caller; no-metrics-push.test.sh guards both.
- D5 (owner, 2026-11-11, AskUserQuestion, after a heads-up that Task 9 ran in auto mode): pre-approve the served merge step for normal-mode users, exactly `Bash(~/.oss/hooks/oss-merge-test.sh --v2)` (no :* rule). --merge is the consent; the prompt added a click, not protection.
- D6 (owner, 2026-11-11, in chat): give the plugin repo a root package.json (private, no dependencies, with lockfile) whose `npm test` installs the watcher's dependencies and runs every `__tests__/*.test.sh` file alone (scripts/run-shell-tests.sh), so /oss:ship --merge can test and merge plugin PRs. The watcher vitest suite stays out of it (its setup kills OSS processes machine-wide).
