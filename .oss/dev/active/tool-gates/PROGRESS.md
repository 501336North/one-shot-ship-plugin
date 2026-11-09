# Progress: tool-gates (R-253)

## Current Phase: build (complete, ready for ship)

## Tasks
- [x] Ideate: design committed (completed 2026-11-09)
- [x] Requirements (11 stories) and ADRs (6) (completed 2026-11-09)
- [x] RED rule amended: wider runner list, no lockout (completed 2026-11-09)
- [x] No-lockout switch replaced by runner adoption (completed 2026-11-09)
- [x] Plan: 20 TDD tasks in 5 phases, ADR-007/008, `.oss/tool-gates/**` protected (completed 2026-11-09)
- [x] Build T1: acceptance tests at the gate boundary, 14 tests, all RED on `not implemented` (completed 2026-11-09, /oss:acceptance)
- [x] Build T2: shell tokenizer, 22 tests (completed 2026-11-09, 22d8f64/64d33d5)
- [x] Build T2b: ANSI-C quoting `$'…'`, 31 tokenizer tests (completed 2026-11-09, 0b3f4e0)
- [x] Build T3: command reader, 52 tests (completed 2026-11-09, 06351f2/61655cd)
- [x] Build T3b: nested `-c` scripts + wrappers, ADR-009, plus T3 gaps; 156 tests (completed 2026-11-09, 8166ea6/3b28384/3fe18e5)
- [x] Build T3c: keywords, special parameters, option clusters, cd variants; 160 reader tests (completed 2026-11-09, 4b73cce/c0be4c7/31e2786)
- [x] Build T4: pattern matchers, 23 tests (completed 2026-11-09, 532bf9c/3412453/ffa6ff0)
- [x] Build T5: rule file loader, add-only merge, provenance; 41 tests, `config/tool-gates.json` (completed 2026-11-09, b5ea44a/a6d13c8)
- [x] Build T6: git reader + protected-branch rule; 46 tests (completed 2026-11-09, 3d8b224/426f148)
- [x] Build T7: force-push rule; shared push-words helper (completed 2026-11-09, 7128b1f/488af28)
- [x] Build T7b: abbreviated git push long options; `--branches` refused (completed 2026-11-09, 9000d1f/2a0a968)
- [x] Build T8: tags rule; 77 tests (completed 2026-11-09, 5e9d8d0/d04e961)
- [x] Build T9: production-host rule; 11 tests + reader bare-host fix (completed 2026-11-09, c3c59c0/5ad71cf)
- [x] Build T10: skip/only/todo rule + edit-call reader; 41 tests (completed 2026-11-09, b03053d/fdab419)
- [x] Build T11: protected-path rule + path resolver, user-level tamper paths; 67 tests (completed 2026-11-09, e350946/3d5c146)
- [x] Build T11b: `..` after a symlink, plus common Bash writers; 59 tests (completed 2026-11-09, 5cb82a7/f6d628f)
- [x] Build T12: build start stamp `currentCommandStartedAt` in `.oss/workflow-state.json`; 2 tests (completed 2026-11-09, 9af1738/0689a31)
- [x] Build T13: state store and events, no reads or writes through file symlinks; 7 tests (completed 2026-11-09, 6b1af61/3c4f04c, b18b57a/1cb96ec)
- [x] Build T14: post-call recorder, red only when the test ran last; 7 tests (completed 2026-11-09, 6852ab8/537f710, 1e552dd/6e5a1b3)
- [x] Build T15: RED rule, `.oss/dev/**` code constant; 7 tests (completed 2026-11-09, 8c980bb/9b274e0, 68aece7/6e634e0)
- [x] Build T16: runner adoption, never adopt test/grep/git etc., one runner per build; 8 tests (completed 2026-11-09, 308a203/ef68f21/7527406, ca2808c/493b627)
- [x] Build T17: runToolGate + CLI + failure handling, async GitReader, workflow-state reader; project dir from CLAUDE_PROJECT_DIR; 14 acceptance + 6 failure + 4 project-dir + 3 CLI tests (completed 2026-11-09, 775da0b/cac6292, 6a98847/234cd1a)
- [x] Build T18: bundle `dist/cli/tool-gate.cjs` (57 KB), dist guard, speed (median 12 ms in-process, 57 ms end-to-end); 3 tests (completed 2026-11-09, 947d603/b0d2e93)
- [x] Build T19: hook wrapper `hooks/oss-tool-gate.sh` + root `hooks.json` entries (PreToolUse on Bash|Edit|Write|MultiEdit|NotebookEdit runs pre; PostToolUse and PostToolUseFailure on Bash run post; timeout 5); 7 tests (completed 2026-11-09, d72642c/5d81560)
- [x] Build T20: full suite + dev-docs close-out (completed 2026-11-09). Full run: 4716 tests, 3 failed, all 3 already failing on main (fix in PR #221, not merged; must merge before ship). Hooks with CLAUDE_PROJECT_DIR unset 217/217, tsc clean, no `.skip`/`.only`/`.todo`.

## Blockers
- None. All PRs target `feat/determinism-sprint/build`.

## Last Updated: 2026-11-09 18:17 CST by /oss:build
