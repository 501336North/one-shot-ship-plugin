# Feature: least-privilege-tools (R-266)

Status: COMMITTED

Sprint D card #11 (oss-lab ROADMAP R-266). Branch from `feat/determinism-sprint/build`, PR into it, never `main`. Merges to `main` only with the whole sprint after the R-267 DeepBlue benchmark and the user's go.

## Problem

None of the plugin's 46 agent files sets `tools:`, so every `oss:*` agent has every tool. The gate agents (code-reviewer, security-auditor, penetration-tester, performance-auditor) can edit the code they judge: the unguarded-fix pattern IRON LAW #1 measured (8 of 9 fixes unguarded, 2026-09-06). Three more ways around a tool list exist today:
- Bash can write files (`sed -i`, `echo >`).
- The model-routing offload hands the work to a local model that "can read and edit files in the current repo".
- `agents/_shared/model-routing.md` is a shared snippet that Claude Code loads as an agent (`oss:_shared:model-routing`) with every tool.

Checked 2026-11-09 (Claude Code 2.1.319): an agent's `tools:` restricts; a command's `allowed-tools` only pre-approves and does not restrict.

## Solution

Two layers, as R-266 states: tool names are the coarse layer, R-253's rule file the fine one.

1. **Two tiers of `tools:` lists (Q3).**
   - *Gate tier* (4 agents): Read, Grep, Glob, Bash, Write, plus what review needs (WebFetch/WebSearch where the agent uses them). No Edit, MultiEdit or NotebookEdit. Write stays only for the offload prompt file (Q6).
   - *Builder tier* (the other 41 agents): an explicit list matching what each can do today, including any MCP tools it uses by name (figma-design-agent, n8n-automation-specialist). No behavior change for builders.
2. **Gates review only (Q1).** The four gate descriptions say they review and report, never fix. Fixes go to the stack's builder agent. The served ship prompt already has the main agent fix findings, so ship needs no change.
3. **New R-253 rule: gate agents don't write the repo (Q2, Q6).** When the calling agent is a gate agent, its Write, Edit or Bash write to a path inside the repo is refused. Writes to private temp folders (the offload prompt file, the pen tester's sandbox) pass. It reuses R-253's path resolver and Bash-writer detection.
4. **Offload stays read-only for gates (Q6).** A gate agent's offload launch passes a read-only flag so the local model can't edit the repo. If the offload runner can't enforce that, gate agents don't offload.
5. **Move `agents/_shared/model-routing.md` out of `agents/` (Q4)** and update its 2 references (`watcher/test/integration/agent-model-routing.test.ts`, `commands/__tests__/bash-allowlist-exempt.txt`), plus every agent that includes it.
6. **Served delegation text (Q5).** A PR into the API's `feat/determinism-sprint/build` splits "Security → security-auditor" into "Security review → security-auditor" and "Security fixes → the stack's builder agent" in `packages/api/src/prompts/shared/iron-laws.md`, `commands/build.md` and `build.ts`. The plugin's `CLAUDE.md` copy is refreshed from the live API, so it follows once the sprint merges (not hand-edited; plan finding). R-267 gets a recorded requirement: the candidate run serves the API Sprint D prompts.
7. **Before/after tree check on review-agent runs (added at plan, 2026-11-11, ADR-007).** The known-writer rule (item 3) only knows certain write commands; a script (`python -c`, `node -e`, a test that writes files) gets past it. When a PreToolUse `Agent`/`Task` call names a gate agent, a snapshot of the repo tree is taken (temporary index, as ship's `oss-gate` snapshot does); when the call ends, the tree is compared. Any change voids that review, tells the main agent which files changed, and stops the ship for the user. It needs only the `Agent` tool's own `subagent_type`, not P1. Limit: gitignored files aren't in the snapshot.
8. **Served agent headers lose their `tools:` lines (FOLLOWUPS #168, ADR-008).** 18 served agent prompts carry unenforced `tools:` text (often not tools at all, like `npm`); the local agent file is the only tool list.
9. **`allowed-tools`:** no change in this card. It widens rather than narrows. Pre-approving the prompt fetch is a separate decision.

## Probe first (before any build task; record results in NOTES.md)

Run in a real headless session, settings and plugins off, throwaway project, as on 2026-11-09:
- **P1:** Does PreToolUse hook input name the subagent (for example `agent_type`)? **If not, STOP and ask the user** (Q2). The gate rule (item 3) depends on it.
- **P2:** With `tools:` set, does the agent still reach an MCP tool named in the list? Is a wildcard (`mcp__server__*`) accepted?
- **P3:** Is there a "all tools" value for `tools:` (`*`)? If there is, the builder tier uses it, so new built-in tools aren't silently cut off.
- **P4:** Can the offload runner start the local model read-only (item 4)?

## Components

- `agents/*.md`: `tools:` on all 45 real agents; gate descriptions reworded.
- `config/tool-gates.json` + `watcher/src/tool-gate/rules/`: new gate-agent rule.
- Moved shared snippet + references.
- API PR (sprint branch): three delegation rows.
- Plugin `CLAUDE.md`: delegation row.
- oss-lab ROADMAP: R-266 card result + R-267 requirement.

## Success Criteria

- [ ] Every file Claude Code loads as a plugin agent has a `tools:` list; a test fails on any that doesn't.
- [ ] No gate agent lists Edit, MultiEdit or NotebookEdit; a test fails if one does.
- [ ] Hermetic row: a gate agent's Edit of a repo file is refused (by `tools:`), and its Bash or Write into the repo is refused (by the gate rule).
- [ ] Positive control: a builder agent's Edit of a repo file passes.
- [ ] A gate agent's Write to its private temp prompt file passes.
- [ ] `oss:_shared:model-routing` no longer appears as an agent.
- [ ] Served delegation rows in the API sprint branch name builders for security fixes.

## TDD Test Plan

- [ ] Frontmatter test: every agent file has `tools:`; gate agents have no Edit/MultiEdit/NotebookEdit; listed tool names are known names.
- [ ] Rule tests: a gate agent's Write/Edit/Bash write inside the repo is refused; temp-folder write passes; a builder's same call passes; unknown agent → treated as non-gate (no lockout).
- [ ] Hermetic acceptance row (headless session): gate Edit refused, builder Edit passes.
- [ ] Move test: no file under `agents/` lacks frontmatter `name:`.
- [ ] API prompt test: delegation rows split.

## Stress Test (2026-11-11, committed as designed)

- **Feasibility 1:** the gate rule depends on P1. Mitigation: stop and ask if P1 fails.
- **Feasibility 2:** read-only offload depends on P4. Mitigation: gates don't offload (frontier model) if P4 fails.
- **UX 3:** until the sprint merges, the live API sends security fixes to the read-only auditor; the call is refused and the main agent picks a builder. Accepted (Q5); R-267 counts it.
- **Tech debt 4:** explicit builder lists freeze today's tools. Mitigation: P3 decides whether builders use an "all tools" value; a test rejects unknown tool names.
- **Tech debt 5:** the gate set lives in agent `tools:` lists and in the R-253 rule. Mitigation: the rule reads the gate set from one source, and a test checks that agent lists and rule agree.

No dissent records.

## Out of Scope

- `allowed-tools` changes (pre-approving the prompt fetch).
- Per-agent tailored tool lists beyond the two tiers.
- An advisor read-only tier (architects, analyzers, docs).
- A new writable security-engineer agent.
- Running the R-267 benchmark.

## Last Updated: 2026-11-11 14:32 CST by /oss:ideate
