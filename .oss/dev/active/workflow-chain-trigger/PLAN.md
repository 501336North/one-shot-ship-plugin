# Implementation Plan: Workflow Chain Trigger on Command Complete

## Summary
Wire custom command chain execution into `oss-notify.sh` so that when a standard workflow command completes, any `team:` prefixed commands in the workflow config's `chains_to` are automatically executed via the existing `CustomCommandExecutor` infrastructure.

## Root Cause
- `WorkflowChainExecutor` and `CustomCommandExecutor` are built and tested but never invoked at runtime
- `watcher/dist/index.js` is a library (exports only), not a daemon — exits immediately when run
- `oss-notify.sh` handles `complete` events but only updates state, never triggers chains
- Result: custom commands configured in `chains_to` never fire

## Design Decision: Hook-Based (Option 2)
Instead of fixing the watcher daemon (Option 1), we add chain triggering directly to `oss-notify.sh`. This is simpler, doesn't require a long-running process, and works immediately.

## Architecture

```
oss-notify.sh --workflow build complete
    │
    ├── (existing) Update workflow-state.json
    ├── (existing) Send Telegram notification
    │
    └── (NEW) Chain trigger:
        1. Read API key from ~/.oss/config.json
        2. Fetch workflow config: GET /api/v1/workflows/{command}
        3. Parse chains_to from response
        4. For each chain step with "team:" prefix:
           → Execute: node chain-trigger.js <command-name>
           → chain-trigger.js uses CustomCommandExecutor.invokeCommand()
        5. Log results to session log
```

## Files to Create/Modify

| File | Action | Repo |
|------|--------|------|
| `watcher/src/cli/chain-trigger.ts` | CREATE | one-shot-ship-plugin |
| `hooks/oss-notify.sh` | MODIFY (add chain trigger in `complete` case) | one-shot-ship-plugin |
| `watcher/test/cli/chain-trigger.test.ts` | CREATE | one-shot-ship-plugin |

## Phase 1: Create chain-trigger CLI entry point

### Task 1: Create chain-trigger.ts CLI that executes a single custom command

**Objective**: A Node.js CLI script that takes a custom command name, reads credentials, and invokes it via CustomCommandExecutor.

**Tests to Write (RED step)**:
- [ ] Test: `should exit with error when no command name provided`
  - File: `watcher/test/cli/chain-trigger.test.ts`
  - Assertion: process exits with code 1, stderr contains usage message
- [ ] Test: `should read API credentials from config.json`
  - File: `watcher/test/cli/chain-trigger.test.ts`
  - Assertion: reads apiKey and apiUrl from ~/.oss/config.json
- [ ] Test: `should invoke CustomCommandExecutor.invokeCommand with the command name`
  - File: `watcher/test/cli/chain-trigger.test.ts`
  - Assertion: invokeCommand called with correct name
- [ ] Test: `should exit 0 on success, exit 1 on failure`
  - File: `watcher/test/cli/chain-trigger.test.ts`
  - Assertion: exit code matches success/failure
- [ ] Test: `should log chain trigger start and result to session log`
  - File: `watcher/test/cli/chain-trigger.test.ts`
  - Assertion: oss-log.sh called with agent chain_trigger messages

**Implementation (GREEN step)**:
- File: `watcher/src/cli/chain-trigger.ts`
- Reads `~/.oss/config.json` for apiKey/apiUrl
- Creates `CustomCommandExecutor` with those credentials
- Calls `invokeCommand(commandName)`
- Logs start/result via oss-log.sh
- Exits 0 on success, 1 on failure

**Refactor (REFACTOR step)**:
- Extract config reading into shared utility if duplicated

**Acceptance Criteria**:
- [ ] `node watcher/dist/cli/chain-trigger.js my-command` fetches and executes custom command
- [ ] Proper error handling for missing config, API failures
- [ ] Logs are written for observability

## Phase 2: Wire chain trigger into oss-notify.sh

### Task 2: Add chain trigger logic to the `complete` event handler

**Objective**: When `oss-notify.sh --workflow <cmd> complete` fires, fetch the workflow config for `<cmd>` and execute any `team:` prefixed chains.

**Tests to Write (RED step)**:
- [ ] Test: `should fetch workflow config on complete event`
  - File: `watcher/test/cli/chain-trigger-integration.test.ts`
  - Assertion: API called with correct workflow name
- [ ] Test: `should execute team: prefixed chain steps`
  - File: `watcher/test/cli/chain-trigger-integration.test.ts`
  - Assertion: chain-trigger.js invoked for each team: command
- [ ] Test: `should skip non-team chain steps (standard commands)`
  - File: `watcher/test/cli/chain-trigger-integration.test.ts`
  - Assertion: chain-trigger.js NOT invoked for standard commands
- [ ] Test: `should not block the main complete handler if chain fails`
  - File: `watcher/test/cli/chain-trigger-integration.test.ts`
  - Assertion: oss-notify.sh exits 0 even if chain-trigger fails
- [ ] Test: `should skip chain trigger when no API key configured`
  - File: `watcher/test/cli/chain-trigger-integration.test.ts`
  - Assertion: no API call made, no chain-trigger invoked

**Implementation (GREEN step)**:
- File: `hooks/oss-notify.sh` (modify `complete` case, around line 318-340)
- After existing complete logic, add:
  1. Background subshell `( ... ) &` to not block
  2. Read apiKey from `~/.oss/config.json`
  3. Fetch workflow config: `curl -sS GET /api/v1/workflows/{cmd}`
  4. The API returns encrypted config - use `oss-decrypt` to get plaintext
  5. OR: simpler approach - use the chain-trigger.js with a `--workflow` flag that handles fetching the config and iterating chains
  6. For each `team:` prefixed command in `chains_to`: invoke `node chain-trigger.js <name>`
  7. Log results

**Design choice**: The simplest approach is a single Node.js script `chain-trigger.js` that:
- Takes `--workflow <cmd>` flag
- Fetches the workflow config using existing `getCachedOrFetch()` from `watcher/src/api/workflow-config.ts`
- Iterates `chains_to`, filters for `team:` prefix
- Executes each via `CustomCommandExecutor.invokeCommand()`
- This avoids complex shell parsing of encrypted JSON

So `oss-notify.sh` just needs to add ONE line in the `complete` case:
```bash
# Trigger custom command chains (background, non-blocking)
( node "$CHAIN_TRIGGER_CLI" --workflow "$WORKFLOW_CMD" 2>/dev/null || true ) &
```

**Refactor (REFACTOR step)**:
- Ensure timeout protection (5s max per command)
- Clean up any redundant watcher PID logic in session-start.sh

**Acceptance Criteria**:
- [ ] `/oss:build` completing triggers custom commands in `build.chains_to`
- [ ] Standard commands in chains are skipped (only `team:` fired)
- [ ] Main workflow is never blocked by chain execution
- [ ] Chain execution is logged for observability

## Phase 3: Clean up stale watcher code

### Task 3: Fix session-start.sh watcher spawn (stop spawning dead process)

**Objective**: The session-start hook spawns `node watcher/dist/index.js` which is a library, not a daemon. Remove or fix this to avoid stale PID files.

**Tests to Write (RED step)**:
- [ ] Test: `should not write stale PID file for library-only module`
  - Verify PID file is not created for a process that exits immediately

**Implementation (GREEN step)**:
- Remove watcher spawn from `oss-session-start.sh` (lines 192-217)
- OR: Replace with a proper daemon that stays alive
- For now: Remove the spawn. Chain execution is handled by oss-notify.sh hook.
- Keep the PID check logic but comment out spawn until watcher has a proper entry point

**Refactor (REFACTOR step)**:
- Clean up comments to explain the new architecture

**Acceptance Criteria**:
- [ ] No stale PID files after session start
- [ ] Custom command chains still work (via oss-notify.sh hook)

## Implementation Sequence

```
1. Foundation Phase
   └── Task 1: Create chain-trigger.ts CLI (the execution engine)

2. Integration Phase (depends on Foundation)
   └── Task 2: Wire into oss-notify.sh complete event

3. Cleanup Phase (depends on Integration)
   └── Task 3: Remove stale watcher spawn from session-start.sh
```

## Testing Strategy

### Unit Tests
- [ ] chain-trigger.ts: config reading, executor invocation, exit codes
- [ ] Mocked CustomCommandExecutor (London TDD)

### Integration Tests
- [ ] End-to-end: oss-notify.sh complete → chain-trigger.js → API call
- [ ] Verify logs show chain execution

### Manual Verification
- [ ] Configure a custom command in dashboard
- [ ] Add it to build's chains_to
- [ ] Run /oss:build
- [ ] See chain fire in terminal and logs

## Security Checklist
- [ ] API key read from existing config (no new credential storage)
- [ ] Chain trigger runs in background subshell (no terminal blocking)
- [ ] Errors are caught and logged (never crash the main hook)

## Estimated Tasks: 3
## Estimated Test Cases: 10
