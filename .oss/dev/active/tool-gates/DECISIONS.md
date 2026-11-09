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

## Amendment (2026-11-09): no lockout on unknown test runners
A heads-up flagged that the rule only recognizes test commands from a fixed list, so a build whose tests run another way would have every code edit refused, and the agent can't add its command (the rule file is protected). The user chose: widen the default list (pnpm/yarn/bun, `npm run test*`, make, swift, gradle, mvn, dotnet, rspec, phpunit) and make the refusal name the fix.

The first fallback (rule off after 3 refused edits with no recognized run) was replaced the same day: a second heads-up showed it also frees an agent that runs no tests at all. **Decision:** adopt the runner. During a build, an unlisted command that names a test file or contains test/spec/check and exits non-zero becomes the build's test command (`runner-adopted`, counted by R-267). An agent that runs no tests stays refused; a runner with no test hint waits for the user to add it with `!`. Rejected: keeping the switch-off but requiring a test-looking run first (rule off for the whole build instead of working), and strict with no fallback (every unlisted runner waits for the user).

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

---

# ADR-007: Own shell tokenizer, no npm package

**Date:** 2026-11-09
**Status:** Accepted (user, `/oss:plan`)

## Context
ADR-004 left the tokenizer choice to the plan. `watcher/` has no runtime dependencies today.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Own tokenizer (~200 lines, own tests) | Zero dependencies; reads exactly what the rules need (quotes, operators, redirects, heredocs, `$(`/`eval` as unreadable) | Our code to get right | Best |
| `shell-quote` package | Established `parse()` | First runtime dependency; past CVE in `quote()`; still needs our code for heredocs, `-C`, redirect targets | Decent |

## Decision
Own tokenizer in `watcher/src/tool-gate/tokenize.ts`. Anything it can't read is `unreadable` (allowed and logged).

---

# ADR-008: "This build" is the build's start stamp

**Date:** 2026-11-09
**Status:** Accepted (`/oss:plan`)

## Context
The RED rule refuses source edits until a test goes red "in this build". `workflow-state.json` has `currentCommand` but no build identity, so a red from yesterday's build would still unlock edits.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| `update-workflow-state` writes `currentCommandStartedAt` when `currentCommand` changes; `cycle.json` stores the stamp it was made under | Deterministic; works for subagents | Touches one more file (new field only) | Best |
| Key the cycle by hook `session_id` | No change elsewhere | Subagents' payloads may carry different ids, so the parent's red wouldn't count for a subagent | Poor |
| Never reset | Trivial | An old red unlocks a new build | Poor |

## Decision
A cycle whose stamp doesn't match the current `currentCommandStartedAt` counts as "no run yet". If the field is absent (older state file), stamps are compared as absent = absent.

---

# Amendment to ADR-003 (2026-11-09, `/oss:plan`): state files are protected
The gate's state (`.oss/tool-gates/cycle.json`, `events.ndjson`) was not in `protectedPaths`, so an agent could write `cycle.json` to fake a red run or rewrite the events R-267 counts. The user chose to add `.oss/tool-gates/**` to the base `protectedPaths`. The gate writes these files through fs, not through tool calls, so this doesn't affect it.

---

# ADR-009: Read literal nested shells and look through wrappers

**Date:** 2026-11-09
**Status:** Accepted (user, `/oss:build`)

## Context
The design allowed any command the tokenizer can't read (logged `unreadable`). During T2, the tokenizer agent found that this made `bash -c 'git push --force'`, `sh -c 'git push origin main'` and wrapper forms (`env git push -f`, `sudo git push`) bypass every git rule.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Read literal `-c` scripts recursively + skip known wrappers | Closes the trivial bypasses; only dynamic scripts stay unreadable | One more task (T3b) | Best |
| Same + refuse any unreadable command mentioning `git` | Strictest | Wrong refusals on lines like `eval "$(ssh-agent)" && git push` | Decent |
| Keep as designed | No work | Trivial bypass of every git rule until a later card | Poor |

## Decision
- Literal `-c` scripts are read and checked recursively.
- The wrappers `env`, `sudo`, `command`, `nice`, `nohup`, `time` and `xargs` are skipped, along with their options. The `env` options include `VAR=value` assignments.
- Dynamic scripts stay unreadable: they are allowed and logged, and R-267 counts them.
- The tokenizer decodes `$'…'` (T2b).

## Consequences
- **Positive:** the git, host and protected-path rules can't be dodged with a one-word wrapper.
- **Negative:** `bash -c "$(…)"` and `eval "$X"` remain a known gap.

---

# Note (2026-11-09, `/oss:build`): the production-host rule stays in R-253
During T9 the user asked whether US-007 belongs in a determinism sprint.

**What US-007 guards:** it refuses an agent's Bash calls to the customer's own production hosts listed in `.oss/tool-gates.json`. An example is a `/oss:load` or `/oss:bench` agent curling the live API from the dev box. It is unrelated to model routing.

**Decision:** the user chose to keep it. It is a no-op unless a repo lists hosts.

**Matching:** the host must match exactly. A host that only shares a suffix doesn't match, and neither does one inside a multi-word commit message.

# Amendment to ADR-003 (2026-11-09, `/oss:build`, user pick): user-level tamper paths
`~/.claude/settings*.json` and `~/.claude/plugins/**` join the base `protectedPaths`. Without them, an agent could set `disableAllHooks: true`, or edit the installed plugin's `hooks.json` / `tool-gate.cjs`, and switch off every gate.
