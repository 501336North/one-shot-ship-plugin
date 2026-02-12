# Design: Workflow Chain Trigger

## Problem
WorkflowChainExecutor and CustomCommandExecutor are built and tested but never wired into any runtime. The watcher process (index.js) is a library module, not a daemon — it exits immediately. Custom commands configured in workflow chains_to never fire.

## Solution: Hook-Based Chain Triggering (Option 2)
Add chain execution directly to `oss-notify.sh` on `complete` events. A new `chain-trigger.js` CLI handles fetching workflow config and executing team: commands.

## Architecture
```
oss-notify.sh complete → (background) node chain-trigger.js --workflow <cmd>
                           → getCachedOrFetch(cmd)
                           → filter chains_to for team: prefix
                           → CustomCommandExecutor.invokeCommand(name)
                           → log results
```

## Why Not a Daemon
- Simpler: no long-running process to manage
- Reliable: triggered by the hook system that already works
- No PID file management needed
- Works immediately without session restart
