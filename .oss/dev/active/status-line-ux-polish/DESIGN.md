# Status Line UX Polish - Design Document

## Problem Statement

When starting a new Claude Code session, the status line displays "Saved unknown" instead of meaningful information. This occurs when:
1. Context file exists but date parsing fails
2. Date field is missing or malformed
3. Internal fallback values ("unknown") leak to the user

**Current behavior:** `📣 Saved unknown`
**Expected behavior:** Either show actual date or graceful alternative

## User Impact

The status line is a **MAJOR** part of the OSS system - it's what gives users confidence in what's being produced. Showing "unknown" values:
- Erodes trust in the system
- Looks like a bug
- Provides no useful information

## Root Cause Analysis

### Flow Trace
```
oss-session-start.sh (SAVE_DATE="unknown" default)
    ↓ Tries to parse ~/.oss/session-context.md
    ↓ If parsing fails → stays "unknown"
    ↓
oss-notify.sh --session context_restored {...saveDate: "unknown"...}
    ↓
notification-copy.ts → Template: "Saved {saveDate}"
    ↓ Interpolates to "Saved unknown"
    ↓
setNotification("Saved unknown", 10)
    ↓
workflow-state.json → .notification.message = "Saved unknown"
    ↓
oss-statusline.sh → Reads and displays "📣 Saved unknown"
```

### Files Involved
| File | Role | Issue |
|------|------|-------|
| `hooks/oss-session-start.sh` | Sets SAVE_DATE | Uses "unknown" as fallback |
| `watcher/src/services/notification-copy.ts` | Message templates | Template assumes date exists |
| `hooks/oss-notify.sh` | Routes notifications | Passes through without validation |
| `hooks/oss-statusline.sh` | Displays status | No filtering of internal values |

## Design Decisions

### Decision 1: Never Show "unknown" to Users
Internal fallback values must NEVER reach the UI. If we don't have valid data, we either:
- Show a graceful alternative message
- Show nothing (omit the field)

### Decision 2: Graceful Degradation Hierarchy
For session context restore:
1. **Date known** → "Saved 5m ago"
2. **Date unknown but context exists** → "Context loaded" (no date mention)
3. **Context failed to load** → "Ready" (fresh session message)
4. **No context exists** → "Ready" (fresh session message)

### Decision 3: Validation Layer
Add validation in `notification-copy.ts` before interpolation to catch and handle "unknown" values.

## Acceptance Criteria

### AC-001: No "unknown" in status line
- GIVEN any session start scenario
- WHEN the status line is displayed
- THEN "unknown" must NEVER appear in the visible text

### AC-002: Valid date shows relative time
- GIVEN context file with valid save date
- WHEN session starts
- THEN status line shows "Saved Xm/Xh/Xd ago"

### AC-003: Invalid date shows graceful message
- GIVEN context file with missing/malformed date
- WHEN session starts
- THEN status line shows "Context loaded" (no date)

### AC-004: No context shows fresh message
- GIVEN no context file exists
- WHEN session starts
- THEN status line shows "Ready"

### AC-005: Failed context load shows nothing special
- GIVEN context file exists but is corrupted
- WHEN session starts
- THEN status line shows "Ready" (treated as fresh)

## Out of Scope
- Changing the context save format
- Adding new notification types
- Modifying the status line layout
