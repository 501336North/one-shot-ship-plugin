# Design: Enhanced Notifications + Settings

## Problem

Users have no visibility into workflow progress and no control over how they're notified. Currently only context persist/load triggers notifications.

## Solution

1. Add notifications at key workflow moments
2. Create `/oss:settings` command for user preferences
3. Prompt for notification preference during `/oss:login`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Notification System                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│  │   Commands   │     │   Watcher    │     │    Hooks     │ │
│  │  (ideate,    │     │  Supervisor  │     │  (session,   │ │
│  │   plan...)   │     │              │     │   precommand)│ │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘ │
│         │                    │                    │         │
│         └────────────────────┼────────────────────┘         │
│                              ▼                               │
│                    ┌──────────────────┐                     │
│                    │  oss-notify.sh   │                     │
│                    │  (unified hook)  │                     │
│                    └────────┬─────────┘                     │
│                             │                               │
│                    ┌────────▼─────────┐                     │
│                    │ ~/.oss/settings  │                     │
│                    │    .json         │                     │
│                    └────────┬─────────┘                     │
│                             │                               │
│         ┌───────────────────┼───────────────────┐          │
│         ▼                   ▼                   ▼          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   Visual    │    │    Audio    │    │    Sound    │    │
│  │ terminal-   │    │    say      │    │   afplay    │    │
│  │ notifier    │    │  command    │    │             │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Settings Schema

```json
{
  "notifications": {
    "style": "visual",
    "voice": "Samantha",
    "sound": "Glass",
    "verbosity": "important"
  },
  "version": 1
}
```

## Notification Events

| Event | Title | Priority | Verbosity |
|-------|-------|----------|-----------|
| COMMAND_START | "🎯 Starting {cmd}..." | low | all |
| COMMAND_COMPLETE | "✅ {cmd} complete" | high | important |
| COMMAND_FAILED | "❌ {cmd} failed" | critical | errors-only |
| AGENT_SPAWN | "🤖 Delegating to {agent}..." | low | all |
| QUALITY_PASSED | "✅ Quality checks passed" | high | important |
| PR_CREATED | "📝 PR #{num} created" | high | important |
| PR_MERGED | "🎉 PR #{num} merged" | high | important |
| LOOP_DETECTED | "⚠️ Loop detected" | critical | errors-only |

## User Flow

### First Login
```
1. User runs /oss:login
2. Authenticates successfully
3. System detects no settings.json
4. Prompts: "How would you like to be notified?"
   A) Visual (macOS notifications)
   B) Audio (spoken messages)
   C) Sound (audio chime)
   D) None (silent)
5. Saves choice to ~/.oss/settings.json
6. Shows preview notification
```

### Changing Settings
```
1. User runs /oss:settings
2. Shows current settings
3. Offers options to change
4. Saves immediately on change
```

## Out of Scope

- Cross-platform (Windows/Linux) - macOS only for now
- Custom sound files - use system sounds
- Per-command notification overrides
- Notification history/log
