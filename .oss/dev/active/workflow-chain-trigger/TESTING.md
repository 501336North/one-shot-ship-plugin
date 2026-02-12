# Testing Strategy: Workflow Chain Trigger

## Unit Tests (London TDD)
- chain-trigger.ts: mock CustomCommandExecutor, mock config reading
- Test exit codes, argument parsing, error handling

## Integration Tests
- End-to-end: oss-notify.sh complete event triggers chain-trigger.js
- Verify team: commands are invoked, standard commands skipped
- Verify non-blocking behavior (main hook doesn't wait)

## Manual Verification
1. Configure custom command in dashboard
2. Add to build's chains_to with team: prefix
3. Run /oss:build
4. Observe chain fire in terminal output and logs
