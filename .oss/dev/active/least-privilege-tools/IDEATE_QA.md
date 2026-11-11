# Ideation Q&A Transcript: least-privilege-tools (R-266)
Date: 2026-11-11
Original prompt: `/oss:ideate R-266 (Sprint D, oss-lab ROADMAP): least-privilege tool lists — agents get only the tools their job needs. Every plugin agent file gets a `tools:` list; the gate and review agents (code review, security, pen test, performance) are read-only (no Edit or Write). `allowed-tools` only where it removes a prompt the user always approves (e.g. the prompt fetch), kept narrow, since it widens rather than narrows. Verified 2026-11-09 (Claude Code 2.1.319): agent `tools:` restricts; command `allowed-tools` pre-approves and does not restrict. Tool names are the coarse layer; R-253's rule file is the fine one. Acceptance: a hermetic row where a gate agent's Edit is refused, a positive control where a build agent's Edit passes, and a test that fails on any agent file without a `tools:` list. Feature slug: least-privilege-tools. This work lands on the sprint branch feat/determinism-sprint/build via a PR into it, never main; it merges to main only after the R-267 deepblue benchmark.`

Context found before Q1: 46 files under `agents/` (45 agents + `_shared/model-routing.md`), none with `tools:`; none of 69 commands set `allowed-tools`.

## Q1: Some gate agents also do fixing work today (security-auditor's description says it implements auth and fixes vulnerabilities; IRON LAW #5 routes all security work to it). How should the read-only gate agents handle that?
**Choices offered:**
- A) Gates review only (Recommended): the four gates are read-only, descriptions say review and report; fixes go to the stack's builder agent
- B) Split security: as A, plus a new writable security-engineer agent for fixes
- C) Read-only only where unambiguous: security-auditor stays writable

**Selected: A** — "Gates review only (Recommended)"

## Q2: The gate agents still need Bash (tests, git diff, exploits), and Bash can write files. R-253's gate doesn't yet know which agent made a call. How far should "read-only" go?
**Choices offered:**
- A) Add a gate rule (Recommended): check in a real session whether hook input names the subagent; if so, R-253 refuses a gate agent's Bash writes inside the repo; if not, stop and ask
- B) Tool names only: Bash gap written down as an accepted limit for R-267
- C) No Bash for gates: breaks the pen tester

**Selected: A** — "Add a gate rule (Recommended)"

## Q3: Besides the 4 gate agents, how should the other agents get their tools: list? (MCP tools not named in a tools: list are likely cut off.)
**Choices offered:**
- A) Two tiers (Recommended): gates read-only; every other agent gets an explicit list matching what it can do today, MCP tools named
- B) Three tiers: plus a read-only advisor tier
- C) Per-agent lists

**Selected: A** — "Two tiers (Recommended)"

## Q4: agents/_shared/model-routing.md is a shared snippet that Claude Code loads as an agent (oss:_shared:model-routing) with every tool. What should happen to it?
**Choices offered:**
- A) Move it out of agents/ (Recommended), updating its 2 references
- B) Exempt it in the test
- C) Give it an empty tool list

**Selected: A** — "Move it out of agents/ (Recommended)"

## Heads-up from the user (mid-ideation)
"Heads up · Making security-auditor read-only means the IRON LAWS text that tells agents to send security fixes to it must change too, and that text comes from the API."
Checked: the row is served from the API's `packages/api/src/prompts/shared/iron-laws.md:209`, `commands/build.md:123`, `build.ts:174`; the plugin's CLAUDE.md has a copy. The served ship prompt has the main agent fix findings (gate agents only re-check), so ship needs no change.

## Q5: The served delegation row "Security → security-auditor" must change, and the API serves prompts from main. How should R-266 handle it?
**Choices offered:**
- A) API PR + R-267 note (Recommended): PR into the API's Sprint D branch splits the row (review → security-auditor, fixes → builder) plus the plugin CLAUDE.md copy; R-267 must serve the API Sprint D prompts
- B) Plugin-side override only
- C) Defer security-auditor to a follow-up card

**Selected: A** — "API PR + R-267 note (Recommended)"

## Q6: Gate agents use the Write tool in their model-routing offload step (prompt.md in a private mktemp folder), and the offloaded local model can edit repo files, bypassing tools:. How should gates stay read-only?
**Choices offered:**
- A) Keep Write, gate rule (Recommended): gates lose Edit/MultiEdit/NotebookEdit, keep Write; the R-253 rule refuses a gate agent's Write/Edit/Bash write inside the repo; the gate's offload runs read-only (or gates don't offload)
- B) No Write, no offload
- C) No Write, offload via a fixed Bash helper

**Selected: A** — "Keep Write, gate rule (Recommended)"

## Design Decisions Summary
- **Gates review, builders fix** (Q1): a gate can never edit the code it judges.
- **Coarse + fine layers** (Q2, Q6): `tools:` removes Edit/MultiEdit/NotebookEdit from gates; a new R-253 rule refuses their Write, Edit and Bash writes inside the repo, keyed on the calling agent. Depends on probe P1 (hook input names the subagent); if it doesn't, stop and ask.
- **Two tiers** (Q3): only the four gates change behavior; builders keep what they have, so R-267's "nothing that works today breaks" holds.
- **Shared snippet moves out of agents/** (Q4).
- **Served text changes on the API Sprint D branch, R-267 serves it** (Q5).
- **Card narrowing recorded:** the card said gates have "no Edit or Write"; Q6 keeps Write on the tool list and moves the repo-write refusal to the gate rule.
