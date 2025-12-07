# Design: SwiftBar + Jamf Notifier Integration

## Overview

Integrate modern macOS notification and menu bar tools to provide world-class UX for workflow status.

## Components

### 1. SwiftBar Menu Bar Plugin
- Shows persistent workflow chain state in menu bar
- Displays supervisor status (🤖✓/🤖⚡/🤖✗)
- Dropdown shows full chain: ideate → plan → acceptance → red → green → refactor → integration → ship
- Reads from `~/.oss/workflow-state.json`

### 2. Jamf Notifier Integration
- Modern native macOS notifications (UserNotifications framework)
- Replaces terminal-notifier
- Better UI, supports banners and alerts
- Installed automatically on first `/oss:login`

### 3. MenuBarService
- TypeScript service that manages workflow state file
- Called by notification hooks to update state
- Supports: setActiveStep, setTddPhase, setSupervisor, setProgress

## User Experience

1. **Menu Bar**: Always shows current step + supervisor status
   - Example: `🤖✓ BUILD` visible at all times
   - Click to expand full chain dropdown

2. **Notifications**: Jamf Notifier for events
   - Banner notifications for progress
   - Alert notifications for failures/interventions

## Installation

On `/oss:login`:
1. `brew install swiftbar` (if not installed)
2. Download Jamf Notifier PKG
3. Copy SwiftBar plugin to plugins folder
4. Create initial `~/.oss/workflow-state.json`

## State File Format

```json
{
  "supervisor": "watching",
  "activeStep": "build",
  "chainState": {
    "ideate": "done",
    "plan": "done",
    "acceptance": "done",
    "red": "active",
    "green": "pending",
    "refactor": "pending",
    "integration": "pending",
    "ship": "pending"
  },
  "currentTask": "Implementing auth service",
  "progress": "3/8",
  "testsPass": 47,
  "lastUpdate": "2024-12-07T10:30:00Z"
}
```

## Technical Decisions

- SwiftBar plugin refreshes every 1 second (`.1s.sh` suffix)
- State file is the single source of truth
- Notifications are fire-and-forget (don't block workflow)
