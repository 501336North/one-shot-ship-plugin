# Implementation Plan: Fix Chain Trigger to Actually Execute Custom Commands

## Summary
chain-trigger.js currently runs as a **background Node process** that fetches custom command prompts but **can't execute them** — there's no Claude Code session. The fix: make chain-trigger output structured chain instructions **synchronously** so Claude sees them in the Bash tool result and invokes each command as a skill (`/oss:oss-custom <name>`) — exactly how standard chain commands like `requirements`, `api-design`, `adr` already work.

## Root Cause
- `oss-notify.sh` backgrounds chain-trigger.js with `( ... ) &`
- Background process output goes to a log file, not back to Claude
- `CustomCommandExecutor.invokeCommand()` fetches the prompt and returns it as data, but nothing executes it
- Result: prompts are fetched and discarded. Custom commands never run.

## Design: Synchronous Chain Output

```
User runs /oss:build
    ↓
Build completes → Claude calls:
    ~/.oss/hooks/oss-notify.sh --workflow build complete '{...}'
    ↓
oss-notify.sh runs chain-trigger.js SYNCHRONOUSLY (no &)
    ↓
chain-trigger.js fetches workflow config, outputs:
    ---CHAIN_COMMANDS---
    CHAIN: /oss:oss-custom lint-check (always)
    CHAIN: /oss:adr (always)
    ---END_CHAIN_COMMANDS---
    ↓
Claude sees this output in the Bash tool result
    ↓
Claude invokes each command as a skill:
    → Skill("oss:oss-custom", args="lint-check")
    → Skill("oss:adr")
    ↓
Each command runs with FULL lifecycle:
    oss-log.sh init custom
    oss-notify.sh --workflow custom start
    oss-decrypt --type custom --name lint-check
    [Claude executes the prompt]
    oss-notify.sh --workflow custom complete
```

## Key Insight
Standard chain commands (requirements, api-design, adr) already work because the **skill prompt** tells Claude to evaluate `chains_to` and invoke each one. Custom commands (`team:*`) should work identically — Claude invokes `/oss:oss-custom <name>` which is an existing skill that handles the full lifecycle.

The only missing piece: Claude needs to **SEE** what commands to execute. Currently the output is backgrounded and invisible.

## Files to Modify

| File | Action | What |
|------|--------|------|
| `watcher/src/cli/chain-trigger.ts` | MODIFY | Output structured chain instructions to stdout (not just return data) |
| `watcher/test/cli/chain-trigger.test.ts` | MODIFY | Add tests for structured output format |
| `hooks/oss-notify.sh` | MODIFY | Run chain-trigger synchronously, print output |
| `watcher/test/cli/chain-trigger-integration.test.ts` | MODIFY | Update integration tests for sync execution |

## Phase 1: chain-trigger.ts outputs structured chain instructions

### Task 1: Make chain-trigger output chain commands to stdout

**Objective**: chain-trigger.js should output a structured list of commands for Claude to execute, including both standard and custom commands with their conditions.

**Tests to Write (RED)**:
- [ ] `executeChainForWorkflow should output CHAIN: lines for team: commands`
  - Assertion: stdout contains `CHAIN: /oss:oss-custom lint-check (always)`
- [ ] `executeChainForWorkflow should output CHAIN: lines for standard commands`
  - Assertion: stdout contains `CHAIN: /oss:adr (always)` for non-team commands
- [ ] `executeChainForWorkflow should include conditions in output`
  - Assertion: stdout contains `CHAIN: /oss:api-design (condition: has_api_work)`
- [ ] `executeChainForWorkflow should wrap output in delimiters`
  - Assertion: output starts with `---CHAIN_COMMANDS---` and ends with `---END_CHAIN_COMMANDS---`

**Implementation (GREEN)**:
- Remove the `invokeCommand()` calls from `executeChainForWorkflow`
- Instead, build a list of chain instructions and print them to stdout
- For `team:X` commands → `CHAIN: /oss:oss-custom X (always|condition: Y)`
- For standard commands → `CHAIN: /oss:X (always|condition: Y)`
- Wrap in `---CHAIN_COMMANDS---` / `---END_CHAIN_COMMANDS---` delimiters
- Remove `CustomCommandExecutor` dependency (no longer needed in chain-trigger)
- Keep `getCachedOrFetch` for fetching workflow config

**Refactor**:
- Clean up unused imports (CustomCommandExecutor, isCustomCommand, parseCustomCommand)
- Simplify return type (no longer tracking executed/skipped/errors)

## Phase 2: oss-notify.sh runs chain-trigger synchronously

### Task 2: Remove backgrounding, capture and print chain-trigger output

**Objective**: Claude must see the chain-trigger output in the Bash tool result.

**Tests to Write (RED)**:
- [ ] `oss-notify.sh chain trigger should NOT be backgrounded`
  - Assertion: the chain-trigger invocation line does NOT end with `&`
- [ ] `oss-notify.sh chain trigger output should be visible (not /dev/null)`
  - Assertion: no `>/dev/null` or `2>/dev/null` on the chain-trigger line

**Implementation (GREEN)**:
- Change from: `( run_with_timeout 30 node "$CHAIN_TRIGGER_CLI" --workflow "$WORKFLOW_CMD" >> "$CHAIN_TRIGGER_LOG" 2>&1 || true ) &`
- Change to: `run_with_timeout 30 node "$CHAIN_TRIGGER_CLI" --workflow "$WORKFLOW_CMD" 2>> "$CHAIN_TRIGGER_LOG" || true`
- Stdout goes to Claude (chain instructions), stderr goes to log file (errors)

**Refactor**:
- Clean up comments

## Implementation Sequence

```
1. Task 1: chain-trigger.ts outputs structured chain instructions
   └── RED → GREEN → REFACTOR (~4 tests)

2. Task 2: oss-notify.sh runs synchronously
   └── RED → GREEN → REFACTOR (~2 tests)
```

## Testing Strategy

### Unit Tests (chain-trigger.test.ts)
- Output format: delimiters, CHAIN: lines, conditions
- Both team: and standard commands included
- Error handling: API failures produce empty output (not crash)

### Integration Tests (chain-trigger-integration.test.ts)
- oss-notify.sh chain-trigger is NOT backgrounded
- Output is NOT suppressed

### Manual Verification
1. Configure `team:my-test-cmd` custom command in dashboard
2. Add to build's chains_to
3. Run `/oss:build`
4. See in terminal: `CHAIN: /oss:oss-custom my-test-cmd (always)`
5. Claude invokes `/oss:oss-custom my-test-cmd`
6. Full lifecycle fires: logging, status, decrypt, execute, complete

## Estimated Tasks: 2
## Estimated Test Cases: ~6
## Estimated Time: 20 min
