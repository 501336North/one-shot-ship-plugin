# Decisions: tool-gates (R-253)

Source: DESIGN.md (COMMITTED 2026-11-09) and IDEATE_QA.md. Deciders: the user, through the `/oss:ideate` Q&A on 2026-11-09.

---

# ADR-001: Block mode on the sprint branch, no warn mode

**Date:** 2026-11-09
**Status:** Accepted

## Context
R-253 originally proposed (2026-10-29) a first release in warn mode: with no staging channel, a wrong rule would refuse customers' real work. On 2026-11-08 the user put all Sprint D work on its own sprint branch, merged to `main` only after the R-267 deepblue benchmark.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Block mode only | Simplest; the benchmark measures wrong refusals under real enforcement | A rule wrong only on customer repos would surface after merge | Best |
| Build a warn/block switch now | First customer release could start in warn mode | Extra mode, tests and config for a risk the benchmark already covers | Decent |
| Warn mode only | Zero risk of wrong refusals | Gates don't enforce anything; the sprint's point is lost | Poor |

## Decision
Rules refuse for real (exit 2). No warn mode is built unless R-267 shows wrong refusals.

## Consequences
- **Positive:** less code; the benchmark tests the real behaviour.
- **Negative:** if a rule is wrong only for repos unlike the benchmark's, it shows up after merge.
- **Neutral:** R-253's ROADMAP text "warn before block" is superseded by this ADR.

---

# ADR-002: Per-cycle RED rule without task ids

**Date:** 2026-11-09
**Status:** Accepted

## Context
"No production code without a failing test first" needs to know whether a test went red before a code edit. OSS has no per-task record yet (that's R-257); the hook only sees test runs and file edits.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Per cycle: red unlocks source edits; after green only the cycle's files | Enforces RED → GREEN → REFACTOR; no task ids | An agent can run a test it knows fails to unlock edits | Best |
| Any red since the build began | Trivial | After the first red, code without tests for the rest of the build | Poor |
| Defer to R-257 | Exact per-task check | No RED enforcement until R-257 | Decent |

## Decision
Per cycle, covering source files only (`sourceExtensions`); test files, Markdown, JSON, YAML and `.oss/dev/**` are never covered. Applies only while `currentCommand` is `build`.

## Consequences
- **Positive:** the TDD cycle is enforced now; refactors stay possible.
- **Negative:** the "deliberately failing test" loophole remains until R-257; the rule trusts the model-set `currentCommand` until R-254.

---

# ADR-003: Settings-only rule file, plugin base plus add-only repo file

**Date:** 2026-11-09
**Status:** Accepted

## Context
Some rules need per-repo facts (production hosts, whether the repo tags releases, extra protected paths). A rule file the agent or a repo can loosen turns a law back into a preference.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Plugin base + repo file that can only add or tighten | Per-repo facts without a plugin release; base laws can't be loosened | Merge validation to build and test | Best |
| Plugin rules only, facts from OSS config | Fewer files | Repo-specific rules need a plugin release | Decent |
| Repo file can override anything | Most flexible | A law a file can switch off is a preference | Poor |
| A rule language (match expressions in the file) | Rules without code changes | Untestable surface, parser to secure | Poor |

## Decision
The rules are code. The file holds settings only. The repo file `.oss/tool-gates.json` may add to lists and tighten (`tagsAllowed: false`); a loosening or malformed repo file is ignored as a whole and reported, and the base rules apply. The rule files are protected paths.

## Consequences
- **Positive:** every rule has hermetic tests; the values live in one place.
- **Negative:** a new kind of rule needs a plugin change.

---

# ADR-004: A bundled Node CLI, not bash + jq or built-in deny rules

**Date:** 2026-11-09
**Status:** Accepted

## Context
The hook must parse hook JSON, tokenize shell commands correctly (quotes, `&&`, `cd x && …`) and keep state (current branch, test cycle).

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Node CLI in `watcher/src/cli/`, bundled to one `.cjs` (like `chain-trigger`) | Node already required; real tokenizer; testable in vitest | ~50 ms process start per call | Best |
| Bash + jq (like most hooks) | Matches existing hooks | jq not guaranteed on customer machines; shell splitting in bash is fragile | Poor |
| Claude Code `permissions.deny` rules | No code | No state (branch, red/green); lives in settings the agent or user can edit | Poor |

## Decision
`watcher/src/cli/tool-gate.ts`, bundled to `watcher/dist/cli/tool-gate.cjs`, with `pre` and `post` modes, called from `hooks.json` entries for `PreToolUse`, `PostToolUse` and `PostToolUseFailure`.

## Consequences
- **Positive:** one tested program; no new runtime dependency for users.
- **Negative:** a Node start on every Bash/edit call (target under 100 ms).
- **Neutral:** tokenizer choice (npm package vs own) is left to `/oss:plan`.

---

# ADR-005: A crashed or slow gate allows the call and says so

**Date:** 2026-11-09
**Status:** Accepted

## Context
`tool-gate` runs on every Bash and edit call in every session with the plugin. A bug in it must not stop all work.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Allow + log `gate-error` + tell the agent | Sessions keep working; errors are visible and counted by R-267 | Rules unchecked while broken | Best |
| Refuse every call on error | Never lets a forbidden call through | One bug blocks every OSS session | Poor |

## Decision
On crash or a 2 s timeout, allow the call, log `gate-error`, and show the agent "tool-gate failed, rules not checked."

## Consequences
- **Positive:** a broken gate degrades to today's behaviour, never worse.
- **Negative:** a failure that repeats silently weakens enforcement; R-267 counts gate errors to catch it.

---

# ADR-006: Red/green from the hook event, not from parsing test output

**Date:** 2026-11-09
**Status:** Accepted

## Context
The recorder must know whether a test run passed. Checked in a real session (Claude Code 2.1.319, 2026-11-09): a Bash call exiting 0 fires `PostToolUse` with no exit code; a non-zero exit fires `PostToolUseFailure` with `error: "Exit code N…"`.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Event kind decides (PostToolUse = green, PostToolUseFailure = red) | Works for every test runner; no output parsing | Pipes and `|| true` hide the test's exit code | Best |
| Parse runner output (vitest/jest/pytest summaries) | Survives pipes | One parser per runner; breaks on format changes | Poor |

## Decision
The event kind decides. Piped runs, `|| true` / `|| :` and interrupted runs are recorded unknown and don't change the cycle.

## Consequences
- **Positive:** runner-independent.
- **Negative:** `npm test | tail` never counts; agents must run tests unpiped to unlock edits.
