# Plan: Statusbar Refactor - World-Class Command Board

## Summary

Transform the OSS statusbar from an afterthought into the trust-building command board that makes or breaks user confidence. The statusbar must **always show up-to-date data, at the right time, with just the right information, in an aesthetically pleasing way for developers**.

## Problem Statement

**Current Issues:**
1. "Saved unknown" message when context restore fails - useless feedback
2. 7 sections crammed into one line - too noisy, unclear priority
3. Fragmented state across multiple files (workflow-state.json, queue.json, iron-law-state.json)
4. Display logic is complex with many conditionals - hard to reason about
5. Messages not contextually useful (showing info even when not relevant)

**User Expectation:**
> "It's like the command board... what will make or break the trust users have in our product"

## Design Principles

1. **Trust through accuracy**: Never show stale or incorrect data
2. **Signal over noise**: Show only what's relevant right now
3. **Hierarchy matters**: Supervisor status > Queue > Workflow > Branch
4. **Fail gracefully**: If we can't load data, don't show garbage - show nothing
5. **Aesthetically consistent**: Sectioned format with clear visual separation

## Target Display Format

```
[Sectioned Layout - Priority Order]

IDLE STATE:
✅ 🌿 feat/auth → plan

ACTIVE WORKFLOW:
[build] 🔴 3/8 | 🤖 react-specialist | 🌿 feat/x | ✓

SUPERVISOR INTERVENING:
⚡ 🚨 2 issues | [build] BLOCKED | 🌿 feat/x

LAW#4 VIOLATION:
⛔ LAW#4 | ⚠️ main → create feature branch

CONTEXT RESTORED (10s auto-expire):
📣 Context 2h ago | ✅ 🌿 feat/auth → plan
```

## Sections (Priority Order)

| # | Section | When Shown | Format |
|---|---------|------------|--------|
| 1 | Health | Always | ✅ or ⛔ LAW#X |
| 2 | Queue Alert | supervisor=intervening OR queue.critical > 0 | 🚨 X issues |
| 3 | Workflow | currentCommand set | [cmd] phase progress |
| 4 | Agent | activeAgent set (during workflow) | 🤖 agent-type |
| 5 | Branch | Always in git repo | 🌿 branch or ⚠️ main |
| 6 | Supervisor | watching (show ✓), idle (hide) | ✓ or (empty) |
| 7 | Next Command | idle AND nextCommand set | → next |
| 8 | Notification | notification.message exists AND not expired | 📣 message |

## Phase 1: Fix Critical Bugs (1 task)

### Task 1.1: Fix "Saved unknown" message

**Problem**: When session context file exists but date parsing fails, we show "Saved unknown" which is useless.

**Files**:
- `hooks/oss-session-start.sh` (lines 147-176)
- `watcher/src/services/notification-copy.ts` (lines 259-265)

**Behavior Change**:
- If we can load and parse the saved date: Show "Context Xh ago" (human readable)
- If date parsing fails but file exists: Show "Context restored" (no date)
- If file doesn't exist: Show "Ready" (fresh start) or show nothing

**Test**: `watcher/test/services/notification-copy.test.ts`
- Add test: when saveDate is "unknown", message should be "Context restored" (not "Saved unknown")
- Add test: when saveDate is valid, message should be "Saved Xh ago"

## Phase 2: Consolidate State (2 tasks)

### Task 2.1: Add queue-related fields to workflow-state.json

**Problem**: Queue info is in separate queue.json, causing fragmented reads

**Files**:
- `watcher/src/services/workflow-state.ts` (add queueSummary field)
- `watcher/src/cli/update-workflow-state.ts` (add setQueueSummary command)

**New State Field**:
```typescript
interface WorkflowState {
  // ... existing fields ...
  queueSummary?: {
    critical: number;
    pending: number;
    topIssue?: string;
  };
}
```

**Test**: `watcher/test/cli/update-workflow-state.test.ts`
- Add test: setQueueSummary updates queueSummary field
- Add test: clearQueueSummary removes queueSummary field

### Task 2.2: Add health status to workflow-state.json

**Problem**: Health check reads iron-law-state.json AND runs git branch --show-current each time

**Files**:
- `watcher/src/services/workflow-state.ts` (add health field)
- `hooks/oss-iron-law-check.sh` (update health on check)

**New State Field**:
```typescript
interface WorkflowState {
  // ... existing fields ...
  health?: {
    status: 'ok' | 'violation';
    violatedLaw?: number;
    message?: string;
  };
}
```

**Test**: `watcher/test/cli/update-workflow-state.test.ts`
- Add test: setHealth updates health field
- Add test: health status reflects in workflow-state.json

## Phase 3: Simplify Statusline Script (3 tasks)

### Task 3.1: Rewrite compute_workflow() with clear priority

**Current**: Complex nested conditionals mixing agent, TDD phase, and command flow

**New Logic** (priority order):
1. If `supervisor === 'intervening'` → Show blocked state first
2. If `activeAgent.type` exists → Show `🤖 agent-type`
3. If `tddPhase` exists → Show phase emoji + progress
4. If `currentCommand` exists → Show `[cmd]` + optional progress
5. If none of above → Return empty

**Test**: `watcher/test/hooks/oss-statusline.test.ts`
- Add test: intervening state shows before agent
- Add test: agent shows before TDD phase
- Add test: TDD phase shows before command

### Task 3.2: Simplify section ordering in build_status_line()

**Current**: Fixed 7-section order regardless of context

**New**: Dynamic ordering based on priority:
```bash
# Priority 1: Critical alerts (always first)
[[ "$supervisor" == "intervening" ]] && sections+=("⚡")
[[ -n "$health" && "$health" != "✅" ]] && sections+=("$health")

# Priority 2: Queue alerts (if any)
[[ -n "$queue" ]] && sections+=("$queue")

# Priority 3: Workflow state
[[ -n "$workflow" ]] && sections+=("$workflow")

# Priority 4: Context
[[ -n "$branch" ]] && sections+=("$branch")
[[ "$supervisor" == "watching" ]] && sections+=("✓")

# Priority 5: Suggestions (idle only)
[[ -z "$workflow" && -n "$next_cmd" ]] && sections+=("→ $next_cmd")

# Priority 6: Notifications (last, auto-expire)
[[ -n "$notification" ]] && sections+=("$notification")
```

**Test**: `watcher/test/hooks/oss-statusline.test.ts`
- Add test: intervening state appears first
- Add test: queue appears before workflow
- Add test: idle state shows minimal info + suggested next

### Task 3.3: Read consolidated state (single JSON read)

**Current**: Multiple file reads (workflow-state.json, queue.json, iron-law-state.json, git)

**New**: Single read of workflow-state.json (since Phase 2 consolidated state)
- Remove separate queue.json read
- Remove separate iron-law-state.json read
- Keep git branch check (can't consolidate - needs live data)

**Test**: `watcher/test/hooks/oss-statusline.test.ts`
- Add test: statusline works with consolidated state
- Add test: missing queueSummary shows nothing (not error)

## Phase 4: Notification Improvements (2 tasks)

### Task 4.1: Fix context_restored message when saveDate is unknown

**Files**: `watcher/src/services/notification-copy.ts`

**Current** (line 261-262):
```typescript
const saveDate = context.saveDate || 'unknown';
message = message.replace('{saveDate}', saveDate);
```

**New**:
```typescript
if (context.saveDate && context.saveDate !== 'unknown') {
  message = `Saved ${context.saveDate}`;
} else {
  message = 'Context restored';  // Fallback without useless "unknown"
}
```

**Test**: `watcher/test/services/notification-copy.test.ts`
- Add test: context_restored with saveDate="unknown" → message = "Context restored"
- Add test: context_restored with saveDate="2h ago" → message = "Saved 2h ago"

### Task 4.2: Fix session-start.sh date parsing robustness

**Files**: `hooks/oss-session-start.sh` (lines 151-176)

**Current**: If date parsing fails, SAVE_DATE stays "unknown"

**New**:
```bash
# If date parsing failed, don't pass saveDate at all
if [[ "$SAVE_EPOCH" == "0" || -z "$SAVE_EPOCH" ]]; then
    SAVE_DATE=""  # Empty = let copy service handle gracefully
fi
```

**Test**: Manual test + integration test in `watcher/test/hooks/oss-session-hooks.test.ts`
- Add test: session start with unparseable date passes empty saveDate

## Phase 5: Idle State Polish (1 task)

### Task 5.1: Implement minimal idle state display

**Current**: Shows model + project + branch even when idle (noisy)

**New Idle Display**:
```
✅ 🌿 feat/auth → plan
```

Components:
- Health status (✅ or ⛔ LAW#X)
- Branch (🌿 or ⚠️)
- Suggested next command (if known)

**Logic**:
```bash
# Idle = no currentCommand AND no activeAgent AND no tddPhase
if [[ -z "$current_cmd" && -z "$active_agent" && -z "$tdd_phase" ]]; then
    # Minimal: health + branch + suggestion
    sections+=("$health")
    sections+=("$branch")
    [[ -n "$next_cmd" ]] && sections+=("→ $next_cmd")
    # Skip model+project, supervisor, queue (unless critical)
fi
```

**Test**: `watcher/test/hooks/oss-statusline.test.ts`
- Add test: idle state shows health + branch + next only
- Add test: idle state with critical queue still shows queue

## Test Strategy

| Phase | Test Type | Location |
|-------|-----------|----------|
| 1.1 | Unit | `watcher/test/services/notification-copy.test.ts` |
| 2.1 | Unit | `watcher/test/cli/update-workflow-state.test.ts` |
| 2.2 | Unit | `watcher/test/cli/update-workflow-state.test.ts` |
| 3.1-3.3 | Integration | `watcher/test/hooks/oss-statusline.test.ts` |
| 4.1 | Unit | `watcher/test/services/notification-copy.test.ts` |
| 4.2 | Integration | `watcher/test/hooks/oss-session-hooks.test.ts` |
| 5.1 | Integration | `watcher/test/hooks/oss-statusline.test.ts` |

## Acceptance Criteria

- [ ] "Saved unknown" never appears - either shows time or omits date
- [ ] Idle state is minimal: just health + branch + suggested next
- [ ] Active workflow shows clear hierarchy: [cmd] phase progress | agent | branch | ✓
- [ ] Supervisor intervening is impossible to miss: ⚡ appears first
- [ ] Queue alerts appear prominently when supervisor has issues
- [ ] State is consolidated into workflow-state.json (fewer file reads)
- [ ] All tests pass
- [ ] Performance: statusline renders in <100ms

## Task Sequence

```
Phase 1 (Bug Fix)
├─ Task 1.1: RED → GREEN → REFACTOR (fix notification-copy.ts)

Phase 2 (State Consolidation)
├─ Task 2.1: RED → GREEN → REFACTOR (queueSummary field)
└─ Task 2.2: RED → GREEN → REFACTOR (health field)

Phase 3 (Statusline Rewrite)
├─ Task 3.1: RED → GREEN → REFACTOR (compute_workflow priority)
├─ Task 3.2: RED → GREEN → REFACTOR (section ordering)
└─ Task 3.3: RED → GREEN → REFACTOR (single JSON read)

Phase 4 (Notification Polish)
├─ Task 4.1: RED → GREEN → REFACTOR (notification-copy.ts fallback)
└─ Task 4.2: RED → GREEN → REFACTOR (session-start.sh robustness)

Phase 5 (Idle State)
└─ Task 5.1: RED → GREEN → REFACTOR (minimal idle display)

Ship
├─ Run all tests
├─ Verify statusline renders < 100ms
└─ Create PR
```

## Estimated Tasks: 9

## Dependencies

- Phase 3.3 depends on Phase 2.1 and 2.2 (consolidated state)
- Phase 4.1 and 4.2 address same issue from different angles

## Notes

- This is primarily a UX and architecture improvement
- No new features - focusing on making existing features reliable and beautiful
- The statusbar is the user's window into the system - it must inspire trust
- Breaking changes to workflow-state.json are OK (internal only)

---

*Created: 2025-12-22*
*Status: Ready for /oss:build*
