# Plan: Status Line Legend Command & Session Event Display

## Summary

1. Reorder status bar to put Health first (most important at a glance)
2. Add workflow/session messages at the end (what used to go to terminal-notifier)
3. Enhance queue display to show count + top item
4. Add `/oss:legend` command to display status bar legend
5. Add session idle indicator (`💾`)

---

## New Status Bar Format

### Current Format (WRONG)
```
[Model] Dir | 🌿 Branch | ✅ Health | 🔵 TDD X/Y ✓ 🤖 agent | ⚠️ Issue 📋Queue
```

### Target Format (CORRECT)
```
✅ [Model] Dir | 🌿 Branch | 🔵 TDD X/Y ✓ 🤖 agent | ⚠️ Issue | 📋3: Top Item | 📣 Message
```

**Key Changes:**
1. **Health first** - `✅` or `⛔ LAW#X` at the very beginning
2. **Queue enhanced** - Show count AND top item: `📋3: Implement auth`
3. **Message at end** - New section showing workflow/session messages

---

## Message Examples (From NotificationCopyService)

### Session Messages
| Event | Message |
|-------|---------|
| `context_restored` | "Context Loaded" |
| `fresh_start` | "Ready" |
| `context_saved` | "Context Persisted" |

### Workflow Messages
| Command | Event | Message |
|---------|-------|---------|
| ideate | start | "Ideating" |
| ideate | complete | "→ Plan" |
| plan | start | "Planning" |
| plan | complete | "→ Build" |
| build | start | "Building" |
| build | task_complete | "3/10 Task Name" |
| build | complete | "→ Ship" |
| ship | start | "Shipping" |
| ship | pr_created | "PR #123" |
| ship | merged | "Shipped" |

### Issue Messages
| Type | Message |
|------|---------|
| loop_detected | "Loop: toolName × 5" |
| tdd_violation | "TDD Violation" |
| regression | "Regression: 3 tests broke" |

---

## Phase 1: Reorder Status Bar (Health First)

### Task 1.1: Write test for health-first ordering
**File:** `watcher/test/hooks/oss-statusline.test.ts`
**Test:** Status line should start with health indicator before model

### Task 1.2: Update oss-statusline.sh output order
**File:** `hooks/oss-statusline.sh`
**Change:** Move `$OSS_HEALTH` to the beginning of output line

---

## Phase 2: Enhance Queue Display

### Task 2.1: Write test for queue with top item
**File:** `watcher/test/hooks/oss-statusline.test.ts`
**Test:** Queue display should show count AND first pending task name

### Task 2.2: Update oss-statusline.sh queue section
**File:** `hooks/oss-statusline.sh`
**Change:** Extract first pending task description, format as `📋3: Task Name`

---

## Phase 3: Add Message Section

### Task 3.1: Add message field to workflow-state.json
**File:** `watcher/src/services/workflow-state.ts`
**Change:** Add `message?: string` field to WorkflowState interface

### Task 3.2: Write test for message display
**File:** `watcher/test/hooks/oss-statusline.test.ts`
**Test:** Status line should show message at end when present

### Task 3.3: Update CLI to set message
**File:** `watcher/src/cli/update-workflow-state.ts`
**Change:** Add `setMessage` command

### Task 3.4: Update oss-notify.sh to write message
**File:** `hooks/oss-notify.sh`
**Change:** Call `setMessage` with copy title/message on workflow events

### Task 3.5: Update oss-statusline.sh to display message
**File:** `hooks/oss-statusline.sh`
**Change:** Read `message` from workflow-state.json, append to output

---

## Phase 4: Add Session Idle Indicator

### Task 4.1: Write test for idle supervisor display
**File:** `watcher/test/hooks/oss-statusline.test.ts`
**Test:** When supervisor is "idle", status line should show `💾` indicator

### Task 4.2: Implement idle supervisor indicator
**File:** `hooks/oss-statusline.sh`
**Change:** Add `elif [[ "$SUPERVISOR" == "idle" ]]` block showing `💾`

---

## Phase 5: Create /oss:legend Command

### Task 5.1: Create legend.md command file
**File:** `commands/legend.md`
**Purpose:** Simple command that outputs the status bar legend

### Task 5.2: Register command in plugin manifest
**File:** `.claude-plugin/plugin.json`
**Change:** Add `legend` to commands list

---

## Phase 6: Verify & Document

### Task 6.1: Integration test
- Run workflow commands, verify messages appear in status line
- Run session events, verify messages appear
- Verify health check appears first
- Add items to queue, verify count + top item displayed
- Run `/oss:legend` and verify output matches

### Task 6.2: Update dev docs
**File:** `.oss/dev/active/statusline-legend-and-session-events/PROGRESS.md`

---

## Test Strategy

| Task | Test Type | Description |
|------|-----------|-------------|
| 1.1-1.2 | Unit | Health indicator appears first |
| 2.1-2.2 | Unit | Queue shows count + top item |
| 3.2-3.5 | Unit | Message appears at end of status line |
| 4.1-4.2 | Unit | `💾` shown for idle supervisor |
| 5.1 | Integration | `/oss:legend` outputs complete legend |

---

## Complete Status Line Legend

```
✅ [Model] Dir | 🌿 Branch | 🔵 TDD X/Y ✓ 🤖 agent | ⚠️ Issue | 📋3: Top Task | 📣 Message
```

### Position 1: Health (FIRST)
| Symbol | Meaning |
|--------|---------|
| `✅` | All IRON LAWS passing |
| `⛔ LAW#X` | IRON LAW X violation |

### Position 2: Model & Directory
| Symbol | Meaning |
|--------|---------|
| `[Model]` | Claude model (e.g., `[Opus]`) |
| `Dir` | Workspace directory basename |

### Position 3: Git Branch
| Symbol | Meaning |
|--------|---------|
| `🌿 branch` | Feature branch |
| `⚠️ main` | On main/master branch (warning) |

### Position 4: TDD Phase & Progress
| Symbol | Meaning |
|--------|---------|
| `🔴 RED` | Writing failing test |
| `🟢 GREEN` | Making test pass |
| `🔵 REFACTOR` | Cleaning up |
| `X/Y` | Task progress (current/total) |

### Position 5: Supervisor Status
| Symbol | Meaning |
|--------|---------|
| `✓` | Supervisor watching (session active) |
| `⚡` | Supervisor intervening (issue detected) |
| `💾` | Context saved (session idle) |

### Position 6: Active Agent
| Symbol | Meaning |
|--------|---------|
| `🤖 agent` | Delegated agent running |

### Position 7: Issues
| Symbol | Meaning |
|--------|---------|
| `⛔ msg` | Error issue |
| `⚠️ msg` | Warning issue |
| `ℹ️ msg` | Info issue |

### Position 8: Queue (ENHANCED)
| Symbol | Meaning |
|--------|---------|
| `🚨3: Task` | 3 critical tasks, showing top one |
| `📋5: Task` | 5 pending tasks, showing top one |

**Examples:**
- `📋3: Implement auth` - 3 pending tasks, top is "Implement auth"
- `🚨1: Fix security bug` - 1 critical task
- *(nothing)* - queue is empty

### Position 9: Message (NEW)
| Symbol | Meaning |
|--------|---------|
| `📣 Ideating` | ideate start |
| `📣 → Plan` | ideate complete |
| `📣 Planning` | plan start |
| `📣 → Build` | plan complete |
| `📣 Building` | build start |
| `📣 3/10 Task` | build task_complete |
| `📣 → Ship` | build complete |
| `📣 Shipping` | ship start |
| `📣 PR #123` | ship pr_created |
| `📣 Shipped` | ship merged |
| `📣 Ready` | fresh_start |
| `📣 Context Loaded` | context_restored |
| `📣 Context Persisted` | context_saved |

---

## Estimated Scope

- **Files to modify:** 5
- **New files:** 1
- **Tests to add:** 5-6
- **Total tasks:** 14
