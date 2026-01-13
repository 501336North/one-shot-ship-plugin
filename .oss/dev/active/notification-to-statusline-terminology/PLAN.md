# Plan: Update Notification Terminology to Status Line

## Current Phase: ship

## Problem Statement

The command files in the plugin still use "Send notification" terminology, but the actual behavior has migrated to updating the Claude Code status line. This creates confusion about what the commands are actually doing.

**Example:**
- Current: "## Step 3: Send Start Notification"
- Should be: "## Step 3: Update Status Line"

## Scope

### Files to Update (Plugin - one-shot-ship-plugin)

| File | Section Headers to Update |
|------|---------------------------|
| commands/acceptance.md | Step 3, Step 5 |
| commands/adr.md | Step 3, Step 5 |
| commands/api-design.md | Step 3, Step 5 |
| commands/build.md | Step 3, Step 6 |
| commands/contract.md | Step 3, Step 5 |
| commands/data-model.md | Step 3, Step 5 |
| commands/debug.md | Step 4, Step 6 |
| commands/green.md | Step 3, Step 5 |
| commands/ideate.md | Step 4, Step 7 |
| commands/integration.md | Step 3, Step 5 |
| commands/iterate.md | Step 3, Step 6 |
| commands/mock.md | Step 3, Step 5 |
| commands/plan.md | Step 3, Step 6 |
| commands/red.md | Step 3, Step 5 |
| commands/refactor.md | Step 3, Step 5 |
| commands/requirements.md | Step 3, Step 5 |
| commands/ship.md | Step 3, Step 6 |

### Files to Update (API - AgenticDevWorkflow)

| File | Section to Update |
|------|-------------------|
| packages/api/src/prompts/commands/iterate.md | notification mentions |

## Terminology Changes

| Current | New |
|---------|-----|
| "Send Start Notification" | "Update Status Line (Start)" |
| "Send Completion Notification" | "Update Status Line (Completion)" |
| "Send Task Completion Notifications" | "Update Status Line (Progress)" |
| "Send Milestone Notifications" | "Update Status Line (Milestones)" |
| "You MUST execute this notification command" | "You MUST update the status line" |
| "notification commands" | "status line update commands" |

## Implementation Tasks

### Phase 1: Plugin Commands (18 files)

- [ ] Task 1.1: Update acceptance.md terminology
- [ ] Task 1.2: Update adr.md terminology
- [ ] Task 1.3: Update api-design.md terminology
- [ ] Task 1.4: Update build.md terminology
- [ ] Task 1.5: Update contract.md terminology
- [ ] Task 1.6: Update data-model.md terminology
- [ ] Task 1.7: Update debug.md terminology
- [ ] Task 1.8: Update green.md terminology
- [ ] Task 1.9: Update ideate.md terminology
- [ ] Task 1.10: Update integration.md terminology
- [ ] Task 1.11: Update iterate.md terminology
- [ ] Task 1.12: Update mock.md terminology
- [ ] Task 1.13: Update plan.md terminology
- [ ] Task 1.14: Update red.md terminology
- [ ] Task 1.15: Update refactor.md terminology
- [ ] Task 1.16: Update requirements.md terminology
- [ ] Task 1.17: Update ship.md terminology

### Phase 2: API Commands (1 file)

- [ ] Task 2.1: Update packages/api/src/prompts/commands/iterate.md

### Phase 3: Verification

- [ ] Task 3.1: Search for remaining "notification" references
- [ ] Task 3.2: Run tests in plugin
- [ ] Task 3.3: Run tests in API

## Acceptance Criteria

1. All "Send ... Notification" section headers updated to "Update Status Line (...)"
2. Body text updated to reflect status line behavior
3. No remaining notification terminology in command files (except settings.md which configures notification preferences)
4. All tests pass

## Last Updated: 2024-12-21 by /oss:plan
