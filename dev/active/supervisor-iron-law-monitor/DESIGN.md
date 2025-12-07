# Design: Supervisor IRON LAW Monitor

## Problem Statement

The current supervisor only monitors workflow log entries (from `/oss:*` commands). When an agent works directly without using workflow commands, IRON LAW violations go undetected:

- Working on main branch instead of feature branch
- Writing code before tests
- Not delegating to specialized agents
- Not keeping dev docs in sync

## Solution

Add an **IronLawMonitor** service that continuously monitors:
1. Git state (branch, staged files)
2. File system changes (new .ts files without corresponding .test.ts)
3. Tool usage patterns (detecting code written before tests)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WatcherSupervisor                         │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   LogReader     │  │ WorkflowAnalyzer│  │IronLawMonitor│ │
│  │  (workflow.log) │  │  (TDD phases)   │  │ (IRON LAWS)  │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
│           │                    │                   │         │
│           └────────────────────┴───────────────────┘         │
│                                │                             │
│                    ┌───────────▼───────────┐                 │
│                    │ InterventionGenerator │                 │
│                    └───────────┬───────────┘                 │
│                                │                             │
│                    ┌───────────▼───────────┐                 │
│                    │     QueueManager      │                 │
│                    └───────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## IronLawMonitor Responsibilities

### IRON LAW #1: TDD
- Detect new `.ts` files without corresponding `.test.ts`
- Detect code changes to files not covered by recent test runs
- Track Write tool usage vs test execution order

### IRON LAW #4: Git Flow
- Check current branch (main/master = violation)
- Detect uncommitted changes on main
- Verify feature branch naming convention

### IRON LAW #5: Agent Delegation
- Track Task tool usage
- Detect patterns suggesting specialized work without delegation
- (Limited - hard to detect from outside)

### IRON LAW #6: Dev Docs
- Check for `dev/active/*/PROGRESS.md` when work is happening
- Detect stale timestamps (>1 hour during active work)
- Verify required docs exist for active features

## Monitoring Mode Setting

```json
// ~/.oss/settings.json
{
  "supervisor": {
    "mode": "always",  // "always" | "workflow-only"
    "ironLawChecks": {
      "tdd": true,
      "gitFlow": true,
      "agentDelegation": true,
      "devDocs": true
    },
    "checkIntervalMs": 5000
  }
}
```

## Issue Types

New issue types for IRON LAW violations:
- `iron_law_branch` - On main/master branch
- `iron_law_tdd` - Code without tests
- `iron_law_docs` - Stale or missing dev docs
- `iron_law_delegation` - Specialized work without agent

## Interventions

When violations detected, generate interventions:
1. Notify user via terminal-notifier/SwiftBar
2. Queue corrective action (e.g., "create feature branch")
3. Update menu bar state to show violation

## State File

```json
// ~/.oss/iron-law-state.json
{
  "lastCheck": "2024-12-07T10:00:00Z",
  "violations": [
    {
      "law": 4,
      "type": "iron_law_branch",
      "message": "On main branch",
      "detected": "2024-12-07T10:00:00Z",
      "resolved": null
    }
  ],
  "recentFileChanges": [],
  "recentToolCalls": []
}
```
