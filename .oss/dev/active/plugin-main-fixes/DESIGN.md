# Design: plugin-main-fixes

No ideate phase: this is a small Radical Observability wrap-up (owner picks 2026-11-10), planned directly.

## Scope
- Two shell tests that failed on main: ideate-template (stale wording after #161) and no-telegram-command (settings.md's retired-key cleanup tripped a "never mentions" check).
- The dormant metrics push: delete it (D2), plus the log analyzer that only fed it (D4).
- Release as plugin 2.1.3 (D1).

## Success criteria
- Both tests pass on main's files and still fail on the behaviour they guard (fixtures prove it).
- No hook, command, skill or hooks.json entry ships or references the metrics push or the analyzer (no-metrics-push.test.sh).
- Every plugin shell test file passes when run alone.

## Out of scope
- Wiring metrics anywhere (the G1-G4 timeline covers the dashboard's data).
- The served merge step for repos without a root package.json (oss-test-command feature).
