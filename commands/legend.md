---
description: Display the status line legend and symbol meanings
---

# /oss:legend - Status Line Legend

Display the complete legend for the OSS Dev Workflow status line.

## Status Line Format

```
OSS_HEALTH [Model] Dir | Branch | TDD_PHASE Progress SUPERVISOR AGENT | Issue | Queue | Message
```

## Symbol Meanings

### Position 1: Health (First, Most Important)

| Symbol | Meaning |
|--------|---------|
| `✅` | All IRON LAWS passing |
| `⛔ LAW#X` | IRON LAW X violation |

### Position 2: Model & Directory

| Symbol | Meaning |
|--------|---------|
| `[Opus]` | Claude model name |
| `project-name` | Workspace directory basename |

### Position 3: Git Branch

| Symbol | Meaning |
|--------|---------|
| `🌿 feat/branch` | Feature branch (safe) |
| `⚠️ main` | On main/master branch (warning) |

### Position 4: TDD Phase & Progress

| Symbol | Meaning |
|--------|---------|
| `🔴 RED` | Writing failing test |
| `🟢 GREEN` | Making test pass |
| `🔵 REFACTOR` | Cleaning up |
| `3/10` | Task progress (current/total) |

### Position 5: Supervisor Status

| Symbol | Meaning |
|--------|---------|
| `✓` | Supervisor watching (session active) |
| `⚡` | Supervisor intervening (issue detected) |
| `💾` | Context saved (session idle) |

### Position 6: Active Agent

| Symbol | Meaning |
|--------|---------|
| `🤖 react-specialist` | Delegated agent running |

### Position 7: Issues

| Symbol | Meaning |
|--------|---------|
| `⛔ msg` | Error issue |
| `⚠️ msg` | Warning issue |
| `ℹ️ msg` | Info issue |

### Position 8: Queue

| Symbol | Meaning |
|--------|---------|
| `🚨3: Task` | 3 critical tasks, showing top one |
| `📋5: Task` | 5 pending tasks, showing top one |
| *(empty)* | Queue is empty |

### Position 9: Message (Last)

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

## Examples

### Active Build Session
```
✅ [Opus] my-project | 🌿 feat/auth | 🟢 GREEN 3/10 ✓ | 📋2: Add tests | 📣 Building
```

### IRON LAW Violation
```
⛔ LAW#4 [Opus] my-project | ⚠️ main | 🔴 RED ⚡ | ⛔ On main branch
```

### Idle Session
```
✅ [Opus] my-project | 🌿 main 💾 | 📣 Context Persisted
```

### Agent Delegating
```
✅ [Opus] my-project | 🌿 feat/ui | 🟢 GREEN ⚡ 🤖 react-specialist
```

---

*Use this legend to understand what each symbol in your Claude Code status line means.*
