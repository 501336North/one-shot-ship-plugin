# Decisions: hook-test-hermetic

## D1: Ship before log-rounds, on its own branch (user, 2026-10-28)
The log-rounds gate found the flaky suite. The user ruled that flaky tests do not ship to paying customers. This fix ships first. log-rounds is then rebased on it and shipped.

## D2: What RED means for a test-only task (T7–T14)
These tasks change no production code, so "the test fails on current code" alone would be vacuous or impossible. RED is therefore:
1. a new assertion that fails against the defect it guards (for example, it observes a network call, a real-HOME write, or the live session id); and
2. an anti-vacuity mutant of the production guard the file protects, shown RED.

GREEN means it passes on the real code, with the flaky dependency removed.
**Why:** this matches the repo's measured lesson (2026-09-06): only a guard that kills its own mutant counts as guarded.

## D3: The opt-in session-start health check is detached; its summary goes to its log (T4)
Its echoed summary only reached the user because Claude Code waited for EOF, which means startup blocked for the whole test run. That contradicts the feature's own comment, "Run in background to not block session start". The summary is appended to `health-check.log`, which the hook already writes.

## D4: The root fix lives in setup.ts, not in 16 separate files (T5, T6)
Redirecting `HOME` once covers every `os.homedir()` user. Files that break under it are fixed one by one (T6). This is not a rewrite of all 16.

## D5: Repo-scaffolding steps of /oss:plan Step 0 not applied
That step would overwrite `.gitignore`, add ci.yml and an ecosystem config, and change branch protection on main. All of it is out of scope for this fix, and changing main is forbidden (IRON LAW #4).

## Last Updated: 2026-10-28 by /oss:plan
