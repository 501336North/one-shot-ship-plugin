# Decisions: least-privilege-tools (R-266)

Picks are recorded by the hook in `decisions.ndjson`; the full Q&A is in `IDEATE_QA.md`. Deciders: the project owner, via the ideation picker (2026-11-11).

---

## ADR-001: Gate agents review and report; builders fix

**Date:** 2026-11-11 · **Status:** Accepted (Q1)

**Context.** code-reviewer, security-auditor, penetration-tester and performance-auditor judge changes in `/oss:ship`. security-auditor's description also says it implements auth and fixes vulnerabilities, and IRON LAW #5 routes all security work to it. A gate that can edit what it judges is the unguarded-fix pattern (8 of 9 fixes unguarded, 2026-09-06).

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Gates review only | One clear rule; no new agent; ship already has the main agent fix findings | Security fixes need a different delegation target | Best |
| Split security (new security-engineer) | Keeps a security specialist for fixes | One more agent to maintain; more served-text change | Decent |
| security-auditor stays writable | No served-text change | The security gate can still edit what it reviews | Poor |

**Decision.** All four gates are read-only; their descriptions say review and report. Fixes go to the stack's builder agent.

**Consequences.** + No gate edits its subject. − The served delegation row must change (ADR-005). Neutral: the ship prompt needs no change (the main agent already fixes; gates only re-check).

---

## ADR-002: Two layers: `tools:` lists coarse, an agent-aware R-253 rule fine

**Date:** 2026-11-11 · **Status:** Accepted (Q2, Q6), depends on probe P1

**Context.** Gates need Bash (tests, `git diff`, exploits) and Write (offload `prompt.md` in a private mktemp folder). Both can write repo files. R-253's gate doesn't yet know which agent made a call.

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| `tools:` drops Edit/MultiEdit/NotebookEdit; R-253 rule refuses a gate's Write/Edit/Bash writes inside the repo | Closes every write path; reuses R-253's resolver and Bash-writer detection | Needs the hook input to name the subagent (P1) | Best |
| Tool names only, Bash gap accepted | Smallest | Bash and Write remain a way around | Poor |
| No Bash/Write for gates | Strict | Breaks the pen tester and the offload step | Poor |

**Decision.** Coarse layer: gate `tools:` without Edit, MultiEdit, NotebookEdit. Fine layer: a new R-253 rule refuses a gate agent's Write, Edit or Bash write to a path inside the repo; private temp writes pass; main agent and unknown agents are not refused (no lockout). The rule reads the gate set from one source; a test checks agent lists and rule agree. **If P1 shows the hook input doesn't name the subagent, stop and ask.**

**Consequences.** + Every repo-write path is refused for gates. − Narrows the card's "no Edit or Write" wording: Write stays on the list, refusal moves to the rule. − Gate test runs that write inside the repo (coverage, build output) would be refused; record and ask before widening.

---

## ADR-003: Two tiers of tool lists

**Date:** 2026-11-11 · **Status:** Accepted (Q3), depends on probes P2, P3

**Context.** The card requires `tools:` on every agent. R-267 requires that nothing that works today breaks.

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Two tiers: gates restricted, builders keep today's capabilities | Only 4 agents change behavior | Builder lists may freeze today's tools | Best |
| Three tiers (+ read-only advisors) | Tighter | More behavior change at once; docs-architect writes | Decent |
| Per-agent lists | Precise | Hard to keep consistent | Poor |

**Decision.** Two tiers. Builder lists name the MCP tools the agent uses. If P3 finds an "all tools" value, builders use it; otherwise explicit lists, with a test rejecting unknown tool names.

**Consequences.** + Builder behavior unchanged. − New Claude Code tools may need adding to builder lists (unless P3).

---

## ADR-004: Move `agents/_shared/model-routing.md` out of `agents/`

**Date:** 2026-11-11 · **Status:** Accepted (Q4)

**Context.** Claude Code loads it as the agent `oss:_shared:model-routing` with every tool.

**Decision.** Move it to a non-agent folder; update all references. A test fails on any `agents/**/*.md` without frontmatter `name:`.

**Alternatives rejected.** Exempting it in the test (stays spawnable with all tools); an empty tool list (stays listed as a useless agent).

---

## ADR-005: Served delegation text changes on the API Sprint D branch; R-267 serves it

**Date:** 2026-11-11 · **Status:** Accepted (Q5)

**Context.** "Security → security-auditor" is served from the API (`packages/api/src/prompts/shared/iron-laws.md`, `commands/build.md`, `build.ts`), with a copy in the plugin `CLAUDE.md`. The API serves prompts from `main`; Sprint D changes stay on `feat/determinism-sprint/build` until R-267 passes.

**Decision.** A PR into the API's Sprint D branch splits the row into "Security review → security-auditor" and "Security fixes → the stack's builder agent"; the plugin `CLAUDE.md` copy changes on the plugin sprint branch. The R-267 card records that the candidate run serves the API Sprint D prompts.

**Consequences.** − Until the sprint merges, live sessions still route security fixes to the read-only auditor: the Edit is refused and the main agent picks a builder. Accepted; R-267 counts it.

**Alternatives rejected.** Plugin-side override only (law and agent disagree all sprint); deferring security-auditor (narrows ADR-001).

---

## ADR-006: Gate offload runs read-only, or not at all

**Date:** 2026-11-11 · **Status:** Accepted (Q6), depends on probe P4

**Context.** The offloaded local model "can read and edit files in the current repo", outside `tools:` and the tool gate.

**Decision.** A gate agent's offload launch runs the local model read-only. If the runner can't enforce that (P4), gate agents skip offload and run on the frontier model.

**Consequences.** − If P4 fails, per-agent model routing stops applying to the four gates and gate runs cost more.

**Alternatives rejected.** No Write and no offload (always frontier, even when read-only offload works); a fixed Bash helper for the prompt file (more plumbing in the shared offload step).

**Plan note (2026-11-11).** `agent-offload.ts` already launches the nested session with `--permission-mode acceptEdits` and `--disallowedTools`, so the gate case adds Edit, Write, MultiEdit and NotebookEdit to `--disallowedTools` (P4 confirms). Bash stays; ADR-007 covers its writes.

---

## ADR-007: Before/after tree check around every review-agent run

**Date:** 2026-11-11 · **Status:** Accepted (plan, after the user's heads-up: "A script can still write files.")

**Context.** ADR-002's rule refuses only the Bash writes the command reader recognizes. `python -c`, `node -e`, a test that writes files or any script file gets past it.

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Keep the rule, add a snapshot at the review agent's start and a compare at its end | Catches every non-ignored change, from any source (scripts, offload); needs only the `Agent` tool's `subagent_type`, not P1 | Detects after the write, doesn't prevent it; gitignored files unseen; snapshot cost on big repos | Best |
| Bash allowlist for reviewers | Prevents up front | Breaks the penetration tester; constant list upkeep | Poor |
| Accept the gap | No work | Rule is evadable on purpose | Poor |

**Decision.** Known-writer rule stays as the fast refusal. A PreToolUse hook on `Agent|Task` snapshots the tree (temporary index, `git add -A`, `write-tree`) for gate agents; the PostToolUse hook compares. A change voids the review, names the files, and tells the main agent to stop the ship and ask the user. Overlapping review runs are all voided by a change. Errors: allow, log, tell.

**Consequences.** + The script gap closes for tracked and untracked non-ignored files. − Gitignored files unseen (recorded limit). − Hook cost per review run (timeout 10 s, measured).

---

## ADR-008: Served agent headers carry no `tools:` lines

**Date:** 2026-11-11 · **Status:** Accepted (plan, FOLLOWUPS #168 pulled in)

**Context.** 18 served agent prompts in the API carry `tools:` header text, which Claude Code never enforces (only the local file's frontmatter counts), and much of it names things that aren't tools (`npm`, `vite`, `MCP_DOCKER`). After R-266 it would contradict the real lists.

**Decision.** Remove the lines on the API Sprint D branch, with a test that keeps them out. The local agent file is the only tool list.

**Alternative rejected.** Keeping served lists in sync with the local ones: two sources for one fact.

---

## ADR-009: The tree check hangs off SubagentStart/SubagentStop, not the `Agent` call

**Date:** 2026-11-11 · **Status:** Accepted (build, Task 1 probe finding; refines ADR-007's mechanism, not its promise)

**Context.** Probe (Claude Code 2.1.322): for an agent run with `run_in_background: true`, PostToolUse on `Agent` fires at launch (`status: "async_launched"`), before the agent does anything. A compare there would always pass. `SubagentStart` and `SubagentStop` fire at the run's real start and end, foreground and background, with `agent_id` and `agent_type`.

**Decision.** Snapshot on `SubagentStart` and compare on `SubagentStop` for gate agents, keyed by `agent_id`. For a foreground run, the main agent is told through the `Agent` PostToolUse (`additionalContext`), found by `tool_response.agentId`. For a background run, `SubagentStop` records the void (state + timeline) and tells the user (`systemMessage`). The message says the repo changed while the review ran, since the change may come from any writer during the run.

**Consequences.** + Background review runs are covered. + The plan's Task 10-12 tests stay the same in substance; their trigger events change. − Two more hook events in `hooks.json`.

---

## ADR-010: The review tree check leaves out the top-level `.oss/` folder

**Date:** 2026-11-11 · **Status:** Accepted (user pick at /oss:integration: "Ignore all of .oss/")

**Context.** A live background review run was voided although the review agent changed nothing: while it ran, OSS's own hooks wrote `.oss/dev/timeline-unfiled.ndjson` (they also write `.oss/logs/**`, `.oss/workflow-state.json`, `.oss/session-context.md`). Untracked, non-ignored, so the tree changed. Nearly every ship review would have been voided.

| Option | Pros | Cons |
|--------|------|------|
| Leave out all of top-level `.oss/` (chosen) | Simple; holds as hooks change | A review agent's edit to `.oss/dev` docs goes unseen by this check (the gate rule still refuses its known writes) |
| Leave out only OSS-written files | Tighter | List must track every hook writing under `.oss/`; a new one brings false voids back |

**Decision.** Start and stop trees both omit the top-level `.oss/` folder. `.oss` folders deeper in the tree and look-alikes (`.ossfoo/`) are still checked. The live row gets a control: a clean review run is not voided.

**Heads-up answered (2026-11-11):** "the before/after check may compare too early when review agents run in the background." Covered by ADR-009: the compare runs on SubagentStop, which fires at the end of a background run (probe: after the agent's command finished), not on the `Agent` PostToolUse that fires at launch.
