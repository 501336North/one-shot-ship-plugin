# Feature: Supervisor Agent with Structured Logging

## Problem

Commands and agents execute in isolation - there's no unified view of what's happening across the workflow chain. When something goes wrong (loop, stuck, TDD violation), it's not detected until the user notices. The watcher exists but only monitors external signals (test output, git), not the workflow itself.

## Solution

Every OSS command and spawned agent logs structured entries to `.oss/workflow.log`. The watcher becomes a reasoning agent that reads this log in real-time, understands workflow semantics, and injects interventions via the existing queue system.

## Approach

1. **Structured Logging** - All commands/agents append to `.oss/workflow.log` in hybrid format (JSONL + human summary)
2. **Smart Watcher** - Reads log as a live queue, reasons about progress (not pattern matching)
3. **Graduated Response** - High confidence -> auto-remediate via queue; lower confidence -> notify + suggest
4. **Chain Memory** - Commands read the log to understand what previous commands produced

## Components

- **WorkflowLogger** - Utility for writing structured log entries (used by API prompts)
- **LogReader** - Real-time log tailing and parsing for the watcher
- **WorkflowAnalyzer** - Reasoning about log semantics (progress, loops, violations)
- **InterventionGenerator** - Creates queue tasks with appropriate priority/prompt
- **Updated API Prompts** - All `/oss:` commands log their phases and milestones

## Log Format

```
{"ts":"2025-12-07T00:45:00Z","cmd":"build","phase":"RED","event":"START","data":{}}
# BUILD:RED:START - Beginning test-first development

{"ts":"2025-12-07T00:47:00Z","cmd":"build","phase":"RED","event":"COMPLETE","data":{"tests_written":3,"files":["auth.test.ts"]}}
# BUILD:RED:COMPLETE - Wrote 3 failing tests
```

## Success Criteria

- [ ] All `/oss:` commands log START/phase transitions/COMPLETE to workflow.log
- [ ] Spawned agents log their own lifecycle events
- [ ] Watcher detects stuck/loop/regression by reasoning about log
- [ ] High-confidence issues auto-remediate via queue injection
- [ ] Lower-confidence issues notify + suggest action
- [ ] Commands can read log to find previous command output

## TDD Test Plan

- [ ] WorkflowLogger writes correct hybrid format
- [ ] LogReader tails file and parses entries in real-time
- [ ] WorkflowAnalyzer detects: loop, stuck, regression, out-of-order
- [ ] InterventionGenerator creates correct queue tasks by confidence level
- [ ] Integration: command logs -> watcher detects -> queue injection -> Claude sees it

## Out of Scope

- Modifying Claude Code's hook system (we use existing mechanisms)
- Historical log analytics/dashboards
- Multi-session log aggregation
- Custom log retention policies
