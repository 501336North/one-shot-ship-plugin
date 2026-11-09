# Testing: tool-gates (R-253)

## Strategy
- **Hermetic only:** hook JSON goes to `runToolGate` (in-process) or to `node dist/cli/tool-gate.cjs` / `hooks/oss-tool-gate.sh` (subprocess), inside a throwaway git repo with a temp HOME. No network, no real Claude session, `CLAUDE_PROJECT_DIR` unset.
- **Pure modules tested for real:** tokenizer, command reader, matchers, rule-file merge, rule decisions.
- **Mocked at their interface (London):** GitReader, StateStore and WorkflowState, in rule, recorder and adoption tests.
- **Integration tests use the real thing:** temp git repo, temp dirs (atomic write, symlink refusal), wrapper script, bundle.
- **Speed:**
  - In-process decision under 100 ms (design target).
  - End-to-end subprocess median under 300 ms. This is a generous bound that covers Node start-up; the measured median is recorded below.
- **Timeout tests** use fake timers and a never-resolving mock. They never wait 2 s for real.

## Test files (planned)
| File | Covers |
|---|---|
| `watcher/test/cli/tool-gate.acceptance.test.ts` | One scenario per US-001…US-011 |
| `watcher/test/tool-gate/tokenize.test.ts` | Quotes, operators, redirects, heredoc, unreadable |
| `watcher/test/tool-gate/command-reader.test.ts` | Parts, cd / -C, git subcommand, targets, hosts, pipe / `|| true` |
| `watcher/test/tool-gate/patterns.test.ts` | Path globs, command patterns |
| `watcher/test/tool-gate/rule-file.test.ts`, `provenance.test.ts` | US-009, no duplicated lists |
| `watcher/test/tool-gate/rules/*.test.ts` | US-001, 002, 003, 004, 006, 007, 008 |
| `watcher/test/tool-gate/git-reader.integration.test.ts` | Branch / detached / not a repo |
| `watcher/test/cli/update-workflow-state-command-started.test.ts` | Build start stamp |
| `watcher/test/tool-gate/state-store.integration.test.ts` | Atomic cycle.json, events, symlink refusal |
| `watcher/test/tool-gate/recorder.test.ts`, `runner-adoption.test.ts` | US-005, AC-004.9–11 |
| `watcher/test/tool-gate/failure.test.ts` | US-010, output contract |
| `watcher/test/hooks/tool-gate-dist.test.ts`, `oss-tool-gate.test.ts`, `hooks-json-tool-gate.test.ts` | Bundle current, wrapper, registration |
| `watcher/test/cli/tool-gate.speed.test.ts` | Speed |

## Results
- 2026-11-09 `/oss:acceptance`: `watcher/test/cli/tool-gate.acceptance.test.ts` has 14 tests (12 scenarios; scenarios 7 and 12 are 2 tests each). `Tests 14 failed (14)`, all with `Error: not implemented` from the `runToolGate` stub, as expected for RED. tsc clean.

- 2026-11-09 after T3c: `watcher/test/tool-gate/` has 193 tests (tokenizer 33, reader 160), all passing. The whole suite: 4242 tests, 17 failed. These are the 14 RED acceptance tests plus the 3 failures already on the base branch (fixed separately in PR #221). tsc is clean.

## Last Updated: 2026-11-09 16:55 CST by /oss:build
