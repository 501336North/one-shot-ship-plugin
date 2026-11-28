# Design: merged-hints-flake

Test-only fix for a load-dependent test (IRON LAW #2: flaky = broken; fix the root cause, never retry).

The merged-ready check spends one wall-clock budget (9 s, D85 info e) across all of its git and gh calls. The test runs the real
CLI `main()` in process, so on a loaded machine real time spends that budget and the stub gh is killed. The behaviour under test
is "each merged-path refusal prints only its own cause's hint" (D88), not timing. So the test pins the clock it hands to the
product; the product budget and its own deadline tests stay as they are.

Last Updated: 2026-11-28 10:00 +07 by orchestrator
