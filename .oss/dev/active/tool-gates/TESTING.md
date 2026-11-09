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

## Speed (T18, measured 2026-11-09 17:58 CST, Mac, in isolation)
- **In-process decision** (`git push origin feat/speed` on a feature branch, which includes a real git branch read): median 12.1 ms, max 13.4 ms over 20 calls. The test asserts a median under 100 ms and a max under 1000 ms. That is looser than the plan's "max under 100 ms", per the flakiness law.
- **End to end** (`node dist/cli/tool-gate.cjs pre`, `git status`): median **57.0 ms**, max 63.4 ms over 10 spawns. The test asserts a median under 300 ms.
- **Bundle size:** 57,308 bytes.

## Final results (T20)

Run 2026-11-09 18:14 CST, on `feat/tool-gates/build` after T19 (commit 5d81560).

**Full suite** (`cd watcher && npx vitest run`): 313 files, 4716 tests, 3 failed. All 3 already fail on `main` and are fixed in PR #221 (`fix/main-test-drift/build`, not merged):
- `test/agents/model-frontmatter.test.ts`
- `test/agents/offload-step-safety.test.ts`
- `test/commands/chain-step-contract.test.ts`

**Other checks:**
- Hooks with `CLAUDE_PROJECT_DIR` unset (`env -u CLAUDE_PROJECT_DIR npx vitest run test/hooks`): 217 of 217 passed.
- `tsc --noEmit`: clean.
- `.skip` / `.only` / `.todo`: no calls in the code. The only matches are inside string literals used as test data.

**Tool-gate areas** (`cd watcher && npx vitest run test/tool-gate test/cli/tool-gate.acceptance.test.ts test/cli/tool-gate.cli.test.ts test/cli/tool-gate.speed.test.ts test/hooks/oss-tool-gate.test.ts test/hooks/hooks-json-tool-gate.test.ts`): 27 files, 678 tests, 678 passed.

| Area | File | Tests |
|---|---|---|
| Tokenizer | `test/tool-gate/tokenize.test.ts` | 33 |
| Command reader | `test/tool-gate/command-reader.test.ts` | 200 |
| Edit-call reader | `test/tool-gate/edit-call.test.ts` | 29 |
| Pattern matchers | `test/tool-gate/patterns.test.ts` | 23 |
| Rule file | `test/tool-gate/rule-file.test.ts` | 39 |
| Provenance | `test/tool-gate/provenance.test.ts` | 2 |
| Rule: protected branch | `test/tool-gate/rules/protected-branch.test.ts` | 46 |
| Push words | `test/tool-gate/rules/push-words.test.ts` | 23 |
| Rule: force push | `test/tool-gate/rules/force-push.test.ts` | 26 |
| Rule: tags | `test/tool-gate/rules/tags.test.ts` | 77 |
| Rule: production host | `test/tool-gate/rules/production-host.test.ts` | 11 |
| Rule: focused tests | `test/tool-gate/rules/focused-tests.test.ts` | 15 |
| Rule: protected path | `test/tool-gate/rules/protected-path.test.ts` | 71 |
| Rule: protected path (integration) | `test/tool-gate/rules/protected-path.integration.test.ts` | 4 |
| Rule: RED cycle | `test/tool-gate/rules/red-cycle.test.ts` | 7 |
| Recorder | `test/tool-gate/recorder.test.ts` | 7 |
| Runner adoption | `test/tool-gate/runner-adoption.test.ts` | 8 |
| State store (integration) | `test/tool-gate/state-store.integration.test.ts` | 7 |
| Git reader (integration) | `test/tool-gate/git-reader.integration.test.ts` | 6 |
| Path resolver (integration) | `test/tool-gate/path-resolver.integration.test.ts` | 8 |
| Failure handling | `test/tool-gate/failure.test.ts` | 6 |
| Project folder | `test/tool-gate/project-dir.test.ts` | 4 |
| Acceptance | `test/cli/tool-gate.acceptance.test.ts` | 14 |
| CLI | `test/cli/tool-gate.cli.test.ts` | 3 |
| Speed | `test/cli/tool-gate.speed.test.ts` | 2 |
| Wrapper | `test/hooks/oss-tool-gate.test.ts` | 5 |
| hooks.json entries | `test/hooks/hooks-json-tool-gate.test.ts` | 2 |

**Speed** (T18 measurement, 2026-11-09 17:58 CST, Mac, in isolation; not re-measured at T20):
- In-process decision: median 12.1 ms, max 13.4 ms over 20 calls.
- End to end (`node dist/cli/tool-gate.cjs pre`): median 57.0 ms, max 63.4 ms over 10 spawns.
- Bundle: 57,308 bytes.
- Naming gap closed (refactor, 2026-11-09): the in-process test was titled "(max of 20 calls)" while it asserts median under 100 ms and max under 1000 ms. It is now "(median of 20 calls)", matching what it asserts.

## Integration (/oss:integration, 2026-11-09 18:28 CST)
Every mocked collaborator is now checked against its real version:

| Collaborator | Test against the real version |
|---|---|
| GitReader | `git-reader.integration.test.ts` |
| StateStore | `state-store.integration.test.ts` |
| PathResolver | `path-resolver.integration.test.ts` and `rules/protected-path.integration.test.ts` |
| Rule-file reader | runs on the real `config/tool-gates.json` |
| WorkflowState | `workflow-state.integration.test.ts` (5 tests, added 7f978b6) |

The workflow-state tests drive the real `dist/cli/update-workflow-state.js` (the writer `oss-notify.sh` uses), then the real `fileWorkflowState` and `runToolGate`. They cover:
- the build stamp reaching the gate
- the stamp kept when the same command is set again
- a new stamp for a new build
- a refused source edit before red, allowed after red
- the RED rule off once the build ends

No mock/reality mismatch was found.

**Note:** `clearCurrentCommand` leaves the old `currentCommandStartedAt` in place. It does no harm today, because the gate checks `currentCommand` first.

## Last Updated: 2026-11-09 18:28 CST by /oss:integration
