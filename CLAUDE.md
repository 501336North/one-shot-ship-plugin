# One Shot Ship Plugin - Development Guide

> **⚠️ INTERNAL DOCUMENTATION - NOT FOR END USERS**

---

## 🔴 CRITICAL: MULTI-REPOSITORY CODEBASE

**The OSS Dev Workflow solution spans THREE repositories. ALWAYS check all three when investigating issues or answering questions.**

| Repository | Path | Purpose |
|------------|------|---------|
| **AgenticDevWorkflow** | `/Users/ysl/dev/AgenticDevWorkflow` | API server, web dashboard, database, `.claude-plugin/` integration |
| **one-shot-ship-plugin** | `/Users/ysl/dev/one-shot-ship-plugin` | Plugin source, watcher supervisor, PR monitor, agents, commands |
| **Telegram Driver** | `/Users/ysl/dev/Telegram Driver` | Telegram bridge service, notification system |

### Before Answering ANY Question

```
CROSS-REPO CHECK:
1. [ ] Searched AgenticDevWorkflow
2. [ ] Searched one-shot-ship-plugin
3. [ ] Searched Telegram Driver
```

---

## This Repository: one-shot-ship-plugin

**Purpose:** Core plugin source code, watcher system, and all slash commands.

### Directory Structure

```
one-shot-ship-plugin/
├── .claude-plugin/       # Plugin manifest and configuration
├── agents/               # Specialized agents (40+ agents)
├── commands/             # Slash command implementations (/oss:*)
├── daemon/               # Background services
├── hooks/                # Git and workflow hooks
└── watcher/              # 🔥 Supervisor agent system
    ├── src/
    │   ├── agents/       # Background agents including PR monitor
    │   │   └── pr-monitor.ts  # GitHub PR change-request monitoring
    │   ├── cli/          # Watcher CLI
    │   ├── healthchecks/ # Agent health monitoring
    │   ├── monitors/     # Log and workflow monitors
    │   ├── queue/        # Task queue management
    │   └── supervisor/   # Watcher supervisor coordination
    └── test/             # 1284 tests (100% pass rate)
```

### Key Components

| Component | Description | Tests |
|-----------|-------------|-------|
| `watcher/` | Supervisor agent system | 1284 |
| `watcher/src/agents/pr-monitor.ts` | GitHub PR change-request monitoring | ✅ |
| `commands/` | All `/oss:*` slash commands | ✅ |
| `agents/` | Specialized development agents | ✅ |

### PR Monitor Agent

The PR Monitor watches GitHub PRs for review comments and queues remediation tasks:

```typescript
// Key features:
- Polls GitHub for open PRs
- Detects "change request" comments (not approvals)
- Queues tasks with suggested agent delegation
- Replies with acknowledgment
- Tracks processed comments to avoid duplicates
```

---

## Related Repositories

- **AgenticDevWorkflow**: API server, prompts served to plugin
- **Telegram Driver**: Notification fallback for AskUserQuestion

---

*Part of the OSS Dev Workflow solution*
