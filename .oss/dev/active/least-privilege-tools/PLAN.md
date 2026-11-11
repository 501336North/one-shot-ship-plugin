# Implementation Plan: least-privilege-tools (R-266)

## Summary
Every plugin agent gets an explicit `tools:` list. The four review agents (code-reviewer, security-auditor, penetration-tester, performance-auditor) lose Edit/MultiEdit/NotebookEdit. Three more checks stop them changing the repo another way: a tool-gate rule refuses their known writes, a before/after tree check catches any other change (scripts, offload), and their offload runs without edit tools. The shared snippet leaves `agents/`. The served delegation text and served agent headers change on the API's Sprint D branch.

## Design Reference
- `.oss/dev/active/least-privilege-tools/DESIGN.md` (COMMITTED 2026-11-11), ADR-001..008 in `DECISIONS.md`
- `docs/requirements/least-privilege-tools.md` (US-001..US-008)

## Branches and PRs (Sprint D rule)
- Plugin: `feat/least-privilege-tools/build` from `origin/feat/determinism-sprint/build`; PR into it. Tasks 1-13, 16.
- API: `feat/least-privilege-tools/build` in the API repo from its `feat/determinism-sprint/build`; PR into it. Tasks 14-15.
- oss-lab: ROADMAP update on its Sprint D branch; PR into it. Task 17.
- Never `main`. Nothing merges without the user.

## Test commands (targeted only)
- Shell: `bash agents/__tests__/<file>.test.sh`, `bash hooks/__tests__/<file>.test.sh`
- Watcher: `cd watcher && npx vitest run <path>` for the files a task touches. **Never the watcher full suite** (its setup kills every OSS process on the machine).
- API: `cd packages/api && npx vitest run <path>`

---

## Phase 0: Probes (blocking)

### Task 1: Probes P1-P4 in a real headless session
**Objective:** confirm the Claude Code behavior the design rests on (US-001).

**How:** a throwaway project with settings and plugins off, Claude Code `claude -p`, the same method as the 2026-11-09 check. Record each result, with the Claude Code version and the command used, in `NOTES.md`.
- P1: a PreToolUse hook that dumps its stdin, called from a subagent's Bash call. Does the input name the subagent? Field name?
- P2: an agent with `tools:` naming one MCP tool: can it reach it? Is `mcp__server__*` accepted?
- P3: does `tools:` accept an "all tools" value (`*` or similar)?
- P4: `claude -p --disallowedTools Edit Write MultiEdit NotebookEdit` asked to edit a file: refused?

**Stop rule:** if P1 finds no subagent name, STOP before Task 7 and ask the user (ADR-002). Tasks 2-6 and 10-17 don't depend on P1.

**Acceptance:** NOTES.md has all four results with evidence.

---

## Phase 1: Acceptance tests at the boundaries (RED)

### Task 2: Acceptance tests
**Objective:** outside-in tests at the three boundaries, all RED at first.
- [ ] `agents/__tests__/agent-tools.test.sh`
  - should fail when any `agents/**/*.md` has no frontmatter `name:` (AC-006.2)
  - should fail when any agent file has no `tools:` (AC-002.1)
  - should fail when a gate agent lists Edit, MultiEdit or NotebookEdit (AC-003.1)
  - should fail on a `tools:` entry that isn't a known tool name or `mcp__` name (AC-002.2)
- [ ] `watcher/test/cli/tool-gate.acceptance.test.ts` (new cases, hook JSON in, decision out)
  - should refuse a gate agent's Write into the repo (AC-004.1)
  - should allow a gate agent's Write into its private mktemp folder (AC-004.3)
  - should allow the same Write from a builder agent and from the main agent (AC-004.4, AC-004.5)
- [ ] `watcher/test/cli/gate-run-check.acceptance.test.ts` (real temp git repo)
  - should tell the main agent which files changed when a review agent's run changed the repo (AC-008.1)
  - should say nothing when a review agent's run changed nothing, and nothing for builder agents (AC-008.2, AC-008.3)

**Acceptance:** each test fails for the stated reason (`not implemented` / missing rule / missing list), not a setup error.

---

## Phase 2: Agent files

### Task 3: Gate set in one place
**Tests (RED):** `watcher/test/tool-gate/rule-file.test.ts`
- should read `gateAgents` from `config/tool-gates.json`
- should only add gate agents from a repo rule file, never remove one (add-only merge, as for other lists)

**GREEN:** `config/tool-gates.json` gets `"gateAgents": ["code-reviewer", "security-auditor", "penetration-tester", "performance-auditor"]`; `rule-file.ts` reads it.

### Task 4: Move the shared snippet out of `agents/`
**Tests (RED):** `agent-tools.test.sh` "every agents/**/*.md has `name:`" (from Task 2) fails on `agents/_shared/model-routing.md`.

**GREEN:** move to `docs/agents/model-routing.md`; update `watcher/test/integration/agent-model-routing.test.ts`, `watcher/test/agents/model-frontmatter.test.ts` (its `_shared` exclusion), `commands/__tests__/bash-allowlist-exempt.txt` (paths only). ⚠ changes existing tests' paths only, as AC-006.1 requires; no expectation changes.

### Task 5: Gate agents: tool lists and descriptions
**Tests (RED):** Task 2's gate check; plus `agent-tools.test.sh`
- should fail when the set of agents without Edit differs from `gateAgents` (AC-004.6)
- should fail when a gate description lacks "review" wording and the builder hand-off (AC-003.4)

**GREEN:** `tools: Read, Grep, Glob, Bash, Write` (plus WebFetch/WebSearch where the agent uses them today: penetration-tester); descriptions say the agent reviews and reports, and that fixes go to the stack's builder agent. security-auditor's "implement… fixes" wording goes.

### Task 6: Builder agents: tool lists
**Tests:** Task 2's "every agent has tools:" and known-names checks.

**GREEN:** 41 builder agents get either the "all tools" value (if P3 found one) or an explicit list of today's capabilities, naming MCP tools by P2's form (figma-design-agent, n8n-automation-specialist). Known tool names live in one list in the test.

---

## Phase 3: Gate rule (needs P1)

### Task 7: Read the calling agent from hook input
**Tests (RED):** `watcher/test/tool-gate/hook-input.test.ts`
- should read the subagent name from the field P1 found
- should treat a missing or non-string field as "main agent"
- should strip the `oss:` plugin prefix when comparing with `gateAgents`

**GREEN:** extend `GateRequest`/`HookCall` in `gate.ts` with `agent?: string`.

### Task 8: `gate-agent-write` rule
**Tests (RED):** `watcher/test/tool-gate/rules/gate-agent-write.test.ts`
- should refuse a gate agent's Write/Edit/MultiEdit/NotebookEdit to a path inside the repo (AC-004.1)
- should refuse a gate agent's Bash write the reader recognizes (redirect, rm, mv, cp, tee, sed -i) inside the repo (AC-004.2)
- should allow writes to the system temp folder and `mktemp` folders (AC-004.3)
- should refuse a temp-looking path that resolves into the repo through a symlink or `..` (AC-004.7)
- should not refuse builders, the main agent or unknown names (AC-004.4, AC-004.5)

**GREEN:** `watcher/src/tool-gate/rules/gate-agent-write.ts`, reusing `path-resolver.ts`, `edit-call.ts` and the command reader's write targets; wired into `gate.ts` after protected-path. Refusal text names the rule and says fixes go to a builder.

**Integration:** `watcher/test/tool-gate/rules/gate-agent-write.integration.test.ts` with real symlinks.

### Task 9: Speed
**Test:** extend the existing in-process speed test: the gate with the new rule stays within R-253's bound.

---

## Phase 4: Before/after tree check (US-008)

### Task 10: Snapshot when a review agent starts
**Tests (RED):** `watcher/test/gate-run/snapshot.integration.test.ts` (real temp git repo)
- should record a tree id for a PreToolUse `Agent`/`Task` call whose `subagent_type` is a gate agent, keyed by `tool_use_id`
- should record nothing for builder agents
- should include untracked, non-ignored files and leave the real index untouched
- should not follow a symlinked git dir (same guard as ship's `oss-gate` snapshot)

**GREEN:** `watcher/src/gate-run/snapshot.ts` (temporary index, `git add -A`, `write-tree`), state under the git dir.

### Task 11: Compare when it ends
**Tests (RED):** `watcher/test/gate-run/compare.integration.test.ts`
- should list the changed paths when the tree differs (AC-008.1)
- should be silent when the tree is the same (AC-008.2)
- should void every overlapping review run when two ran at once and the tree changed (record which)
- should tell the main agent: the review's report is void, which files changed, and to stop the ship and ask the user
- should follow the gate's crash policy on error: allow, log, tell (AC-008.4)

**GREEN:** `watcher/src/gate-run/compare.ts`; output through PostToolUse `additionalContext`; a timeline event.

### Task 12: Wire the hooks
**Tests (RED):** `hooks/__tests__/oss-gate-run.test.sh`
- PreToolUse and PostToolUse on `Agent|Task` call the new CLI with `pre`/`post`
- the CLI with `CLAUDE_PROJECT_DIR` unset still finds the repo
- a dist guard: `watcher/dist/cli/gate-run.cjs` is built from source

**GREEN:** `watcher/src/cli/gate-run.ts`, bundle `watcher/dist/cli/gate-run.cjs`, `hooks/oss-gate-run.sh`, `hooks.json` entries (timeout 10; snapshot cost noted in NOTES.md).

---

## Phase 5: Offload

### Task 13: Gate offload without edit tools
**Tests (RED):** `watcher/test/cli/agent-offload.test.ts`
- should pass `--disallowedTools` with Edit, Write, MultiEdit and NotebookEdit for a gate agent (AC-005.1)
- should leave builder agents' arguments unchanged

**GREEN:** `watcher/src/cli/agent-offload.ts` reads `gateAgents`. Bash stays available to the offloaded model; the tree check (Phase 4) covers its writes, since the offload runs inside the review agent's run. If P4 failed: gate agents skip offload instead (AC-005.2), with the matching test.

---

## Phase 6: API Sprint D branch (separate PR)

### Task 14: Split the security delegation row
**Tests (RED):** `packages/api/test/prompts.test.ts`
- iron-laws.md, commands/build.md and build.ts route "Security review" to security-auditor and "Security fixes" to the stack's builder agent (AC-007.1)

**GREEN:** the three files.

### Task 15: Drop `tools:` lines from served agent headers (FOLLOWUPS #168)
**Tests (RED):** new API prompt test
- no file in `packages/api/src/prompts/agents/` has a `tools:` header line

**GREEN:** remove the lines (18 files today; they name things that aren't tools, like `npm` or `vite`, and contradict the enforced local lists). The local agent file is the only tool list.

---

## Phase 7: Records and integration

### Task 16: Integration and dev docs
- Hermetic live row (`agents/__tests__/agent-tools.live.sh`, run by hand and recorded, needs Claude Code): a gate agent's Edit is refused, a builder's Edit applies (AC-003.2, AC-003.3).
- Every mock checked against reality: hook input fields (P1), `Agent` tool input `subagent_type`/`tool_use_id`, offload arguments.
- Targeted suites green; `tsc` clean; no `.skip`/`.only`/`.todo`; TESTING.md and PROGRESS.md updated.
- Plugin `CLAUDE.md`: its IRON LAWS block is refreshed from the live API, so it isn't hand-edited here; it follows Task 14 once the sprint merges (recorded in NOTES.md).

### Task 17: oss-lab ROADMAP (separate PR on oss-lab's Sprint D branch)
- R-266: probe results, the Write narrowing (ADR-002), the tree check (ADR-007).
- R-267: the candidate run serves the API Sprint D prompts; count refused security-fix delegations and voided review runs.

---

## Testing Strategy
- **Unit:** rule file, hook input, gate-agent-write rule, offload arguments.
- **Integration (real git, real symlinks):** gate-agent-write paths, snapshot/compare.
- **Acceptance:** agent-tools contract, tool-gate CLI, gate-run CLI.
- **Live (by hand, recorded):** headless gate vs builder Edit.

## Edge Cases
- Review agent's tests write coverage inside the repo: ignored files aren't in the snapshot; tracked or unignored outputs void the run (record which gate runs hit it and ask before widening).
- Two review agents run in parallel: a change voids both.
- A review agent edits a gitignored file: not caught by the tree check (accepted limit, recorded in NOTES.md and the card).
- Hook input from an older Claude Code without the P1 field: the rule treats calls as the main agent; the tree check still works.

## Security Checklist
- [ ] No value written by the model reaches a shell command (paths go through files or argv, never interpolated)
- [ ] Snapshot state lives in the git dir, refuses symlinks, never follows a symlinked `oss-gate`-style dir
- [ ] Rule failure follows R-253's crash policy (allow + log + tell), never a silent allow
- [ ] Repo rule files can only add gate agents

## Performance Considerations
- [ ] Gate rule within R-253's speed bound (Task 9)
- [ ] Snapshot cost on a large repo measured and recorded; hook timeout 10 s

## Rollout Strategy
- Sprint branch only; reaches customers when the whole sprint passes R-267 and the user gives the go.
- Rollback: revert the R-266 PR on the sprint branch.

## Estimated Tasks: 17
## Estimated Test Cases: ~55

## Last Updated: 2026-11-11 by /oss:plan
