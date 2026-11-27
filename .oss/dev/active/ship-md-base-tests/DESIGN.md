# Design: ship-md-base-tests (Sprint D fix PR)

Goal: make three tests pass that fail on the Sprint D base (a88f7d91). They come from #241's commands/ship.md change. The fix weakens no test and does not change the customer allowlist.

Owner picks:
- 2026-11-26 "Separate fix PR". Gate-discipline ships after this PR merges.
- 2026-11-27 "Accept the prompt". The Override-path `sleep 1` gets a test exemption with a reason, and customers see one approval prompt per wait (at most 5) on that rare path.

See PLAN.md for the three changes and TESTING.md for the results.
