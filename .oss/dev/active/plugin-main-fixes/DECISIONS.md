# Decisions: plugin-main-fixes

- D1: next version 2.1.1 (owner numbering after 2.0.99). Updated 2026-11-11: 2.1.1 (#222) and 2.1.2 (#223) shipped first, so this release is 2.1.3.
- D2 (owner, 2026-11-10, AskUserQuestion): delete the metrics push (option B). The G1-G4 timeline already gives the dashboard its data; the hook is never called.
- D3: test changes in Tasks 1-2 are marked ⚠ changes existing test and quote the spec they replace.
- D4 (owner, 2026-11-11, AskUserQuestion): also delete hooks/oss-log-analyzer.sh. It only fed the push and had no other caller; no-metrics-push.test.sh guards both.
