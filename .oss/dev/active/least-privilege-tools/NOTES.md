# Notes: least-privilege-tools (R-266)

## Found at ideate/plan (2026-11-11)
- 46 files under `agents/`: 45 agents + `_shared/model-routing.md` (loaded by Claude Code as `oss:_shared:model-routing`). None sets `tools:`. No command sets `allowed-tools`.
- Gate agents' Step 2.5 offload writes `prompt.md` with the Write tool into `mktemp -d -t oss-offload.XXXXXX`.
- `watcher/src/cli/agent-offload.ts` launches `claude` with `--permission-mode acceptEdits` and `--disallowedTools 'Read(./.oss/**)' 'Edit(./.oss/**)'`.
- `hooks.json` already has PreToolUse/PostToolUse entries on `Agent|Task` (timeline, async) and the R-253 tool gate on `Bash|Edit|Write|MultiEdit|NotebookEdit`.
- Served delegation row "Security → security-auditor": API `packages/api/src/prompts/shared/iron-laws.md:209`, `commands/build.md:123`, `build.ts:174`. The plugin `CLAUDE.md` IRON LAWS block is refreshed from the live API, so it follows the API once the sprint merges; not hand-edited.
- Served ship prompt: the main agent fixes findings; gate agents only re-check. No ship prompt change needed.
- 18 served agent headers carry `tools:` text (FOLLOWUPS #168).

## Probe results (Task 1)
- P1: (pending)
- P2: (pending)
- P3: (pending)
- P4: (pending)

## Last Updated: 2026-11-11 by /oss:plan
