# Design: Configurable Workflow Orchestration (Option C: API-Driven)

## Problem

Currently, command chains are **hardcoded in prompts**:
- `ideate.md` embeds: chains to requirements, api-design, data-model, adr
- `plan.md` embeds: chains to acceptance
- `build.md` embeds: red→green→refactor loop, agents
- `ship.md` embeds: 4 parallel quality gate agents

This makes it impossible for teams to customize their workflow without editing prompts. Additionally, exposing workflow structure in a local config file would reveal our IP.

## Solution

**Option C: API-Driven Configuration**

Store workflow configurations in the database, serve them encrypted like prompts, and provide a dashboard UI for team customization. No local config file - everything stays protected on the cloud.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLOUD (Protected)                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Database (Supabase)                                                     │
│  └── WorkflowConfig table                                               │
│      ├── teamId (FK to Team)                                            │
│      ├── workflowName ("ideate", "plan", "build", "ship")               │
│      └── config (JSON blob)                                             │
│                                                                          │
│  API Server                                                              │
│  ├── GET /api/v1/workflows           → List workflows + status          │
│  ├── GET /api/v1/workflows/:name     → Encrypted workflow config        │
│  └── PUT /api/v1/workflows/:name     → Update team's config             │
│                                                                          │
│  Dashboard                                                               │
│  └── /settings/workflows             → Visual workflow editor           │
│      ├── Chain sequence (drag/drop)                                     │
│      ├── Condition toggles                                              │
│      └── Agent selection                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                           Encrypted fetch
                           (like prompts)
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         LOCAL (Plugin)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Plugin                                                                  │
│  ├── Fetches workflow config from API at workflow start                 │
│  ├── Decrypts using stored credentials                                  │
│  ├── Executes via workflow engine:                                      │
│  │   ├── Condition evaluator (has_api_work, has_ui_work, etc.)         │
│  │   ├── Chain executor (invoke Skill tool for commands)               │
│  │   └── Agent spawner (invoke Task tool for agents)                   │
│  └── NO local config file (nothing to expose)                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why Option C?

| Approach | IP Protected | Customizable | Complexity |
|----------|--------------|--------------|------------|
| A: Local config | ❌ No | ✅ Yes | Low |
| B: Multiple files | ❌ No | ✅ Yes | Medium |
| **C: API-driven** | **✅ Yes** | **✅ Yes** | Medium |

Option C gives us both IP protection AND customization.

## Components

### 1. Database Schema

```prisma
model WorkflowConfig {
  id           String   @id @default(cuid())
  teamId       String
  team         Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  workflowName String   // "ideate", "plan", "build", "ship"
  config       Json     // The workflow configuration
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([teamId, workflowName])
}
```

### 2. Config Schema

```typescript
interface WorkflowConfig {
  // What commands to chain to after this workflow
  chains_to?: ChainStep[];

  // Pre-steps to run before main workflow
  pre_steps?: PreStep[];

  // For build: the TDD cycle
  task_loop?: string[];  // ["red", "green", "refactor"]

  // Agents to spawn during/after workflow
  agents?: AgentConfig[];

  // For ship: quality gate configuration
  quality_gates?: QualityGateConfig;

  // Human checkpoint or auto-proceed
  checkpoint: "human" | "auto";
}

interface ChainStep {
  command: string;           // "requirements", "api-design", etc.
  always?: boolean;          // Always run
  condition?: string;        // "has_api_work", "has_db_work", etc.
}

interface AgentConfig {
  agent: string;             // "code-simplifier", "security-auditor", etc.
  always?: boolean;
  condition?: string;
}

interface QualityGateConfig {
  parallel: boolean;         // Run agents in parallel
  agents: string[];          // Which agents to run
  all_must_pass: boolean;    // Fail if any fails
}
```

### 3. Built-in Conditions

| Condition | Evaluates To True When |
|-----------|------------------------|
| `has_api_work` | Design mentions "API", "endpoint", "REST", "GraphQL" |
| `has_db_work` | Design mentions "database", "schema", "table", "migration" |
| `has_ui_work` | Changed files include `.tsx`, `.jsx`, `.css`, `.scss` |
| `has_test_failures` | Test suite has failing tests |
| `always` | Always true |
| `never` | Always false |

### 4. Default Configs (Your Current Workflow)

```json
// IDEATE
{
  "chains_to": [
    { "command": "requirements", "always": true },
    { "command": "api-design", "condition": "has_api_work" },
    { "command": "data-model", "condition": "has_db_work" },
    { "command": "adr", "always": true }
  ],
  "checkpoint": "human"
}

// PLAN
{
  "pre_steps": [
    { "action": "archive_completed", "path": "dev/active/" }
  ],
  "chains_to": [
    { "command": "acceptance", "always": true }
  ],
  "checkpoint": "human"
}

// BUILD
{
  "task_loop": ["red", "green", "refactor"],
  "chains_to": [
    { "command": "integration", "always": true }
  ],
  "agents": [
    { "agent": "code-simplifier", "always": true },
    { "agent": "frontend-design", "condition": "has_ui_work" }
  ],
  "checkpoint": "auto"
}

// SHIP
{
  "quality_gates": {
    "parallel": true,
    "agents": [
      "code-reviewer",
      "performance-engineer",
      "security-auditor",
      "penetration-tester"
    ],
    "all_must_pass": true
  },
  "on_pass": {
    "actions": ["commit", "create_pr"],
    "never": ["push_to_main"]
  },
  "checkpoint": "human"
}
```

## Success Criteria

- [ ] Workflow configs stored in Supabase, not locally
- [ ] Teams can customize via dashboard UI
- [ ] Config encrypted when fetched (same as prompts)
- [ ] Default config replicates current behavior exactly
- [ ] Prompts refactored to be cleaner (no hardcoded chains)

## TDD Test Plan

1. Database CRUD operations
2. API endpoints (auth, validation, encryption)
3. Dashboard UI (render, edit, save)
4. Plugin fetch + decrypt
5. Condition evaluator
6. Chain executor
7. Agent spawner
8. Refactored prompts with default config
9. Custom config changes behavior

## Out of Scope

- Workflow versioning/history
- Rollback to previous config
- Config import/export
- Per-project config (only per-team)
