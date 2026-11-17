# Feature: least-privilege-tools (R-266)

## Overview
Every plugin agent gets an explicit `tools:` list. The four gate agents (code-reviewer, security-auditor, penetration-tester, performance-auditor) review and report but can't change the repo they judge: `tools:` removes Edit/MultiEdit/NotebookEdit, and a new R-253 rule refuses their Write, Edit and Bash writes inside the repo. Builders keep what they have today. Design: `.oss/dev/active/least-privilege-tools/DESIGN.md` (COMMITTED 2026-11-11).

Sprint D: branch from and PR into `feat/determinism-sprint/build` (plugin and API), never `main`.

## Actors
| Actor | Description |
|-------|-------------|
| Main agent | The session running an `/oss:*` command; spawns agents |
| Gate agent | code-reviewer, security-auditor, penetration-tester, performance-auditor |
| Builder agent | Any other plugin agent (typescript-pro, python-pro, debugger, ...) |
| Tool gate | R-253's PreToolUse hook and rule file |
| Plugin maintainer | Adds or edits agent files |
| R-267 benchmark | Runs the sprint branch against `main` on DeepBlue |

## User Stories

### US-001: Probes before building
**As a** plugin maintainer **I want** P1-P4 checked in a real headless session **so that** the design rests on observed Claude Code behavior, not assumptions.
**Priority:** Must · **Estimate:** Small

- **AC-001.1:** Given a throwaway project with settings and plugins off, when a subagent makes a tool call, then NOTES.md records whether PreToolUse hook input names the subagent, and the field name (P1).
- **AC-001.2:** If P1 shows no subagent name, then work stops and the user is asked before any gate-rule task starts.
- **AC-001.3:** NOTES.md records whether an MCP tool named in `tools:` is reachable and whether a wildcard is accepted (P2), whether an "all tools" value exists (P3), and whether the offload runner can start the local model read-only (P4).

### US-002: Every agent declares its tools
**As a** plugin maintainer **I want** a test that fails on any agent without `tools:` **so that** no new agent silently gets every tool.
**Priority:** Must · **Estimate:** Small

- **AC-002.1:** Given an agent file under `agents/` with no `tools:` line, when the agent tests run, then a test fails naming the file.
- **AC-002.2:** Given a `tools:` entry that isn't a known Claude Code tool name or an `mcp__` name, when the tests run, then a test fails naming the entry.
- **AC-002.3:** Every builder agent's list covers what it can do today, including the MCP tools it uses (figma-design-agent, n8n-automation-specialist), or uses the "all tools" value if P3 finds one.

### US-003: Gate agents can't edit what they judge (coarse layer)
**As a** user shipping a change **I want** the review gates unable to edit code **so that** a fix never lands without the main agent's RED-GREEN cycle.
**Priority:** Must · **Estimate:** Small

- **AC-003.1:** Given any gate agent file, when the tests run, then a test fails if its `tools:` contains Edit, MultiEdit or NotebookEdit.
- **AC-003.2:** Given a gate agent in a headless session, when it calls Edit on a repo file, then the call is refused and the file is unchanged (hermetic row).
- **AC-003.3 (positive control):** Given a builder agent in the same setup, when it calls Edit on a repo file, then the edit applies.
- **AC-003.4:** Each gate agent's description says it reviews and reports, and that fixes go to the stack's builder agent.

### US-004: Gate agents can't write the repo another way (fine layer)
**As a** user **I want** the tool gate to refuse a gate agent's Write, Edit or Bash write inside the repo **so that** Bash and Write aren't a way around the tool list.
**Priority:** Must · **Estimate:** Medium · **Depends on:** AC-001.1

- **AC-004.1:** Given a call from a gate agent, when it is Write or Edit to a path inside the repo, then the gate refuses it with a message naming the rule.
- **AC-004.2:** Given a call from a gate agent, when it is a Bash command that writes inside the repo (as R-253's Bash-writer detection reads it), then the gate refuses it.
- **AC-004.3:** Given a call from a gate agent, when it writes to its private temp folder (offload `prompt.md`, the pen tester's sandbox), then the gate allows it.
- **AC-004.4:** Given the same calls from a builder agent, when they run, then the rule doesn't refuse them.
- **AC-004.5:** Given a call with no subagent name (the main agent) or an unknown name, then this rule doesn't refuse it (no lockout).
- **AC-004.6:** The rule reads the gate set from one source; a test fails if that set and the agents' `tools:` lists disagree.
- **AC-004.7:** Path resolution reuses R-253's resolver, so symlinks and `..` can't place a repo write outside the repo.

### US-005: Offloaded gate work stays read-only
**As a** user with model routing on **I want** a gate's offloaded local model unable to edit the repo **so that** offload isn't a way around the gate.
**Priority:** Must · **Estimate:** Small–Medium · **Depends on:** AC-001.3 (P4)

- **AC-005.1:** If P4 shows the runner can run read-only, then a gate agent's offload launch runs read-only, and a test proves an edit attempt by the offloaded model leaves the repo unchanged.
- **AC-005.2:** If P4 shows it can't, then gate agents skip the offload step and run on the frontier model; a test proves the gate's offload step is skipped.

### US-006: The shared snippet stops being an agent
**As a** user **I want** `oss:_shared:model-routing` gone from the agent list **so that** no all-tools pseudo-agent can be spawned.
**Priority:** Must · **Estimate:** Small

- **AC-006.1:** `agents/_shared/model-routing.md` is moved outside `agents/`; every reference (agents that include it, `watcher/test/integration/agent-model-routing.test.ts`, `commands/__tests__/bash-allowlist-exempt.txt`) points to the new path.
- **AC-006.2:** A test fails if any `.md` under `agents/` lacks frontmatter `name:`.

### US-007: Served delegation text matches
**As a** main agent following IRON LAW #5 **I want** security fixes routed to a builder **so that** I don't delegate a fix to a read-only agent.
**Priority:** Must · **Estimate:** Small

- **AC-007.1:** On the API's `feat/determinism-sprint/build`, `packages/api/src/prompts/shared/iron-laws.md`, `commands/build.md` and `build.ts` have "Security review → security-auditor" and "Security fixes → the stack's builder agent"; an API prompt test checks it.
- **AC-007.2:** The plugin `CLAUDE.md` copy is not hand-edited: its IRON LAWS block is refreshed from the live API, so it says the same once the sprint merges (plan finding, 2026-11-11).
- **AC-007.3:** The oss-lab ROADMAP R-267 card records that the candidate run serves the API Sprint D prompts; R-266 records the probe results and the Write narrowing (Q6).

### US-008: Any repo change during a review voids it (added at plan, 2026-11-11)
**As a** user **I want** a review agent's run checked for any repo change **so that** a script the gate rule doesn't recognize can't change code unseen.
**Priority:** Must · **Estimate:** Medium

- **AC-008.1:** Given a review agent's run that changed, added or deleted a non-ignored repo file, when the run ends, then the main agent is told the review is void, which files changed, and to stop the ship and ask the user.
- **AC-008.2:** Given a review agent's run that changed nothing, then nothing is said.
- **AC-008.3:** Given a builder agent's run, then no snapshot is taken.
- **AC-008.4:** Given an error in the check, then it follows R-253's crash policy (allow, log, tell).
- **AC-008.5:** Served agent headers carry no `tools:` lines (FOLLOWUPS #168).

## Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| Gate agent writes inside the repo through a symlinked temp path | Refused: the resolver follows the link to the repo |
| Gate agent writes to `/tmp` or `mktemp -d` folder | Allowed |
| Gate agent runs tests that write coverage/build output inside the repo | Refused by AC-004.2; record in NOTES.md which gate test runs this breaks and ask before widening |
| Builder agent spawned with the main agent's name missing | No refusal (AC-004.5) |
| New agent added without `tools:` | AC-002.1 test fails |
| `tools:` typo (e.g. `Edti`) | AC-002.2 test fails |
| Live API still routes security fixes to security-auditor during the sprint | Edit refused; main agent picks a builder; R-267 counts it (accepted, Q5) |
| Gate agent spawned by a user directly (not via ship) | Same restrictions apply |

## Non-Functional Requirements
- **Performance:** the new rule adds no measurable latency to R-253's gate (stays within R-253's speed test bound).
- **Security:** a gate agent can't change repo files by any of Edit, Write, Bash or offload; failures in the rule follow R-253's crash policy (allow + log + tell).
- **Compatibility:** builders' behavior is unchanged (R-267 "nothing that works today breaks").

## Out of Scope
- `allowed-tools` changes, including pre-approving the prompt fetch.
- Per-agent tailored lists beyond the two tiers; an advisor read-only tier.
- A new writable security-engineer agent.
- Running R-267.

## Dependencies
- R-253 tool gate (shipped on the sprint branch, #224): path resolver, Bash-writer detection, rule file.
- API repo `feat/determinism-sprint/build` (exists, from a774a57).
- Claude Code behavior confirmed by probes P1-P4.

## Open Questions
- [ ] P1-P4 results (US-001).
- [ ] Do gate test runs write inside the repo (coverage, build output)? If yes, ask before widening the rule.

## Traceability Matrix
| Requirement | Story | Test | Code |
|-------------|-------|------|------|
| Probes | US-001 | NOTES.md record | — |
| tools: everywhere | US-002 | agents/__tests__ frontmatter test | agents/*.md |
| Gates no Edit | US-003 | frontmatter test + hermetic row | gate agents |
| Gate repo-write rule | US-004 | watcher/test/tool-gate/rules/* | watcher/src/tool-gate/rules/*, config/tool-gates.json |
| Read-only offload | US-005 | offload step test | agents' offload step |
| Snippet moved | US-006 | agents tests | moved file + references |
| Served text | US-007 | API prompts test | API prompts, CLAUDE.md, oss-lab ROADMAP |
