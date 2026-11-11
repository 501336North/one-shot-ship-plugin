# Notes: least-privilege-tools (R-266)

## Found at ideate/plan (2026-11-11)
- 46 files under `agents/`: 45 agents + `_shared/model-routing.md` (loaded by Claude Code as `oss:_shared:model-routing`). None sets `tools:`. No command sets `allowed-tools`.
- Gate agents' Step 2.5 offload writes `prompt.md` with the Write tool into `mktemp -d -t oss-offload.XXXXXX`.
- `watcher/src/cli/agent-offload.ts` launches `claude` with `--permission-mode acceptEdits` and `--disallowedTools 'Read(./.oss/**)' 'Edit(./.oss/**)'`.
- `hooks.json` already has PreToolUse/PostToolUse entries on `Agent|Task` (timeline, async) and the R-253 tool gate on `Bash|Edit|Write|MultiEdit|NotebookEdit`.
- Served delegation row "Security → security-auditor": API `packages/api/src/prompts/shared/iron-laws.md:209`, `commands/build.md:123`, `build.ts:174`. The plugin `CLAUDE.md` IRON LAWS block is refreshed from the live API, so it follows the API once the sprint merges; not hand-edited.
- Served ship prompt: the main agent fixes findings; gate agents only re-check. No ship prompt change needed.
- 18 served agent headers carry `tools:` text (FOLLOWUPS #168).

## Probe results (Task 1, 2026-11-11, Claude Code 2.1.322)
Method: throwaway git project in the session scratchpad, `claude -p ... --setting-sources project --strict-mcp-config --mcp-config <one stdio probe server>`, so user settings and plugins are off. Project `.claude/settings.json` had hooks that append each hook's stdin to a file; probe agents in `.claude/agents/`.

- **P1: YES.** PreToolUse and PostToolUse input for a subagent's tool call carries `agent_type` (the agent's `name:`, e.g. `"prober"`) and `agent_id`. The main agent's calls carry neither field. The `Agent` call itself (from the main agent) has `tool_input.subagent_type` and `tool_use_id`; its PostToolUse has the same `tool_use_id` and `tool_response.agentId`/`agentType`. Plugin agents are expected to arrive as `oss:<name>` (strip the prefix, Task 7). Not blocked: Task 7 goes ahead.
- **P2: YES, both forms.** An agent with `tools: Read, mcp__probe__ping` called the tool (returned the server's token `PONG-7f3a91`); so did `tools: Read, mcp__probe__*`.
- **P3: YES, `tools: "*"`.** The agent got every tool, deferred and MCP tools included, and its Edit applied. Control: `tools: Read` reported only Read and could not edit (file unchanged). A misspelled entry (`tools: Edti`) left the agent with no tools at all, with no warning: a typo fails closed but silently, so the known-names test (AC-002.2) still matters.
- **P4: YES.** `claude -p --permission-mode acceptEdits --disallowedTools Edit Write MultiEdit NotebookEdit` asked to edit a file replied it had no edit tools; file unchanged. Bash in the same setup still wrote a file (expected: the tree check covers it).

## Findings from the probes (change how tasks are built, not what they promise)
- **`MultiEdit` is not a tool in Claude Code 2.1.322**: `--disallowedTools MultiEdit` prints `Permission deny rule "MultiEdit" matches no known tool`. Task 13 disallows Edit, Write, NotebookEdit only; the known-names list (Task 2/6) leaves MultiEdit out; the "no edit tools on gate agents" check still rejects it if someone lists it.
- **Background agents: PostToolUse on `Agent` fires at launch** (`tool_response.status: "async_launched"`), before the agent works. Comparing there would miss every background review run. `SubagentStart` and `SubagentStop` fire at the true start and end of the run, foreground and background, and both carry `agent_id` and `agent_type`. So the tree check (Tasks 10-12) snapshots on `SubagentStart` and compares on `SubagentStop`, keyed by `agent_id`; for foreground runs the main agent is told through the `Agent` PostToolUse (`tool_response.agentId` links it). See ADR-009.
- **Served ship runs the four review agents in the foreground, in parallel, and waits** (`run_in_background: false`, ship Step 1). So during ship a repo change in a review run can only come from a review agent; overlapping review runs all void (as planned). A review run in the background outside ship, while the main agent edits, also voids: the code changed under the review, so its report is stale either way. The message says "the repo changed while the review ran", not "the reviewer changed it".
- Served ship's code-reviewer runs "tests, lint, types, build". A build that rewrites tracked output (e.g. `watcher/dist/*.cjs`) with different bytes would void the run. Same bytes = no change. Watch for it in Task 16; ask before widening.

## Build notes
- Task 3: `watcher/dist/cli/tool-gate.cjs` is a tracked bundle built from source (`npm run build:cli-bundle`). A new required key in `config/tool-gates.json` with a stale bundle makes the gate fail open ("tool-gate failed, rules not checked"), so config and bundle change in one commit. `hooks/__tests__/watcher-dist-fresh.test.sh` checks only the `.js` files, not the `.cjs` bundles: that gap let the stale bundle pass. Closed: each of the four tracked `.cjs` bundles now has its own fresh-build test under `watcher/test/hooks/*-dist.test.ts`.
- Task 3: `npm run build:cli-bundle` also rewrote `oss-launch.cjs` (embedded version 2.0.97 → 2.1.2, stale from an earlier release). Restored then, but that was wrong: ship's code-reviewer runs the build, so the stale bundle would void its review. Fixed after integration: rebuilt and committed, with `watcher/test/hooks/oss-launch-dist.test.ts` (same shape as the tool-gate, gate-run and chain-trigger bundle tests) so a stale bundle fails a test. Once current, a rebuild leaves the review-check snapshot identical (checked with the real `write-tree` snapshot).
- Task 4: the snippet's 19 lines in `commands/__tests__/bash-allowlist-exempt.txt` were removed, not re-pathed: the check only scans `commands/`, `agents/`, `skills/`, and the list only shrinks.
- Task 5: in Claude Code 2.1.322 WebFetch/WebSearch are deferred tools (need ToolSearch). Check in the Task 16 live row that the pen tester can still reach them with its narrow list.

- Task 8: a review agent's Bash write to a path known only at run time (`"$d/f"`, `"$TMPDIR/f"`) is refused with "write the path out in full": the reader places such paths under the repo. The served pen-tester prompt writes no variable-path sandbox, and the offload step prints its mktemp path and writes it with the Write tool (literal path), so nothing served breaks. Also refuses a path that holds the repo (`rm -rf ..`).
- Task 13: offload reads gateAgents through `watcher/src/utils/gate-agents.ts`, not tool-gate (dist/tool-gate is gitignored; the shipped agent-offload.js would fail to load). Unreadable list → every offload loses edit tools (fail closed).
- Task 14: the security row was in 5 served files (plan named 3): also `commands/build-team.md` and `prompts/CLAUDE.md`. Not served and unchanged: API root `CLAUDE.md:515`, `docs/AGENT_ARCHITECTURE.md:74`.
- Task 15: nothing in the API reads the served `tools:` field. Manifest re-signed once for both API commits (key from the main checkout's packages/api/.env through the environment only).
- Task 12: snapshot timing on this repo (1,814 files): start ~240 ms (545 ms cold), stop ~238 ms; hook timeout 10 s. git child calls have no own timeout (killed hook may leave git running briefly). The plan's "timeline event" for a void is not written yet (state file + systemMessage + additionalContext are). Candidate FOLLOWUPs.

## Last Updated: 2026-11-11 by /oss:build (Tasks 7-15)
