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

## Last Updated: 2026-11-11 by /oss:build (Task 1)
