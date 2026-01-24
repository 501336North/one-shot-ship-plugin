# Implementation Plan: Configurable Workflow Orchestration (Option C: API-Driven)

## Summary

Decouple command chains from hardcoded prompts into **API-served workflow configurations** so teams can customize their workflow via the dashboard. Workflow configs are stored in the database, fetched encrypted like prompts, and never exposed locally.

## Design Reference

See `DESIGN.md` for architecture overview and `DECISIONS.md` for ADRs.

## Architecture Overview

```
CLOUD (Protected)                    LOCAL (Plugin)
─────────────────                    ──────────────
Database:                            Plugin:
└── WorkflowConfig table             ├── Fetch config from API
                                     ├── Decrypt locally
API:                                 ├── Execute workflow engine
├── GET /workflows/:name             └── No local config file
├── PUT /workflows/:name
└── GET /workflows

Dashboard:
└── /settings/workflows (UI)
```

## Repositories Affected

| Repository | Changes |
|------------|---------|
| **AgenticDevWorkflow** | API endpoints, database schema, dashboard UI |
| **one-shot-ship-plugin** | Fetch config, workflow engine, prompt refactoring |

---

## TDD Implementation Tasks

### Phase 1: API Infrastructure (AgenticDevWorkflow)

#### Task 1: Database Schema for WorkflowConfig

**Objective**: Create Prisma schema for storing per-team workflow configurations

**Tests to Write (RED step)**:
- [ ] Test: `should create workflow config for team`
  - File: `packages/api/test/models/workflow-config.test.ts`
  - Assertion: WorkflowConfig record created with valid data
- [ ] Test: `should enforce unique constraint on team + workflow name`
  - Assertion: Duplicate team+name throws constraint error
- [ ] Test: `should cascade delete when team is deleted`
  - Assertion: Configs deleted when parent team removed
- [ ] Test: `should store JSON config blob`
  - Assertion: Complex workflow config stored and retrieved correctly

**Implementation (GREEN step)**:
- File: `packages/database/prisma/schema.prisma`
- Model to create:
  ```prisma
  model WorkflowConfig {
    id          String   @id @default(cuid())
    teamId      String
    team        Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
    workflowName String  // "ideate", "plan", "build", "ship"
    config      Json     // The workflow configuration
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt

    @@unique([teamId, workflowName])
  }
  ```

**Acceptance Criteria**:
- [ ] Migration runs successfully
- [ ] CRUD operations work
- [ ] JSON config stored correctly

---

#### Task 2: Seed Default Workflow Configs

**Objective**: Create default workflow configurations matching current behavior

**Tests to Write (RED step)**:
- [ ] Test: `default ideate config should have 4 chains`
  - File: `packages/api/test/seeds/workflow-defaults.test.ts`
  - Assertion: ideate chains to requirements, api-design, data-model, adr
- [ ] Test: `default plan config should chain to acceptance`
  - Assertion: plan chains to acceptance
- [ ] Test: `default build config should have TDD loop and agents`
  - Assertion: red→green→refactor loop, code-simplifier, frontend-design
- [ ] Test: `default ship config should have 4 parallel quality agents`
  - Assertion: code-reviewer, performance-engineer, security-auditor, penetration-tester

**Implementation (GREEN step)**:
- File: `packages/api/src/config/workflow-defaults.ts`
- Constants:
  - `DEFAULT_IDEATE_WORKFLOW`
  - `DEFAULT_PLAN_WORKFLOW`
  - `DEFAULT_BUILD_WORKFLOW`
  - `DEFAULT_SHIP_WORKFLOW`
- File: `packages/database/prisma/seed.ts`
- Seed logic to create default configs

**Acceptance Criteria**:
- [ ] Defaults match demo script specification exactly
- [ ] Seed runs without errors
- [ ] All 4 workflows have defaults

---

#### Task 3: Zod Schema for Workflow Config Validation

**Objective**: Create type-safe validation schema for workflow configurations

**Tests to Write (RED step)**:
- [ ] Test: `should validate minimal valid config`
  - File: `packages/api/test/schemas/workflow-config.test.ts`
  - Assertion: Valid config passes Zod validation
- [ ] Test: `should reject config with unknown workflow`
  - Assertion: Throws validation error for invalid workflow names
- [ ] Test: `should reject config with invalid chain reference`
  - Assertion: Throws error if chain references non-existent command
- [ ] Test: `should provide defaults for missing optional fields`
  - Assertion: Defaults filled in for missing fields
- [ ] Test: `should validate condition strings`
  - Assertion: Only allowed conditions accepted
- [ ] Test: `should validate agent references`
  - Assertion: Only known agent types accepted

**Implementation (GREEN step)**:
- File: `packages/api/src/schemas/workflow-config.ts`
- Schemas:
  - `ChainStepSchema`
  - `AgentConfigSchema`
  - `WorkflowConfigSchema`
  - `validateWorkflowConfig(config: unknown): WorkflowConfig`

**Acceptance Criteria**:
- [ ] Schema covers all 4 main workflows
- [ ] Helpful error messages for validation failures
- [ ] TypeScript types exported

---

#### Task 4: API Endpoint - GET /api/v1/workflows/:name

**Objective**: Serve encrypted workflow config to authenticated users

**Tests to Write (RED step)**:
- [ ] Test: `should return 401 without authentication`
  - File: `packages/api/test/routes/workflows.test.ts`
  - Assertion: Returns 401 Unauthorized
- [ ] Test: `should return 403 without active subscription`
  - Assertion: Returns 403 Forbidden
- [ ] Test: `should return encrypted default config for new teams`
  - Assertion: Returns encrypted default workflow config
- [ ] Test: `should return encrypted custom config if exists`
  - Assertion: Returns team's custom config
- [ ] Test: `should return 404 for unknown workflow name`
  - Assertion: Returns 404 for invalid workflow

**Implementation (GREEN step)**:
- File: `packages/api/src/routes/workflows.ts`
- Endpoint: `GET /api/v1/workflows/:workflowName`
- Logic:
  1. requireAuth middleware
  2. checkSubscription middleware
  3. Load team's config OR default
  4. Encrypt with license-bound encryption
  5. Return encrypted config

**Acceptance Criteria**:
- [ ] Authenticated users can fetch configs
- [ ] Encryption matches prompt encryption
- [ ] Falls back to defaults correctly

---

#### Task 5: API Endpoint - PUT /api/v1/workflows/:name

**Objective**: Allow teams to customize their workflow config

**Tests to Write (RED step)**:
- [ ] Test: `should return 401 without authentication`
  - File: `packages/api/test/routes/workflows.test.ts`
  - Assertion: Returns 401 Unauthorized
- [ ] Test: `should return 403 for non-team-admin`
  - Assertion: Only team admins can modify configs
- [ ] Test: `should validate config before saving`
  - Assertion: Invalid config returns 400 with errors
- [ ] Test: `should create new config if none exists`
  - Assertion: Creates WorkflowConfig record
- [ ] Test: `should update existing config`
  - Assertion: Updates existing record
- [ ] Test: `should track analytics on config change`
  - Assertion: Usage event recorded

**Implementation (GREEN step)**:
- File: `packages/api/src/routes/workflows.ts`
- Endpoint: `PUT /api/v1/workflows/:workflowName`
- Logic:
  1. requireAuth + requireTeamAdmin middleware
  2. Validate config with Zod schema
  3. Upsert WorkflowConfig record
  4. Track usage event
  5. Return success

**Acceptance Criteria**:
- [ ] Team admins can customize workflows
- [ ] Validation prevents invalid configs
- [ ] Changes tracked in analytics

---

#### Task 6: API Endpoint - GET /api/v1/workflows

**Objective**: List available workflows and their customization status

**Tests to Write (RED step)**:
- [ ] Test: `should return list of 4 main workflows`
  - File: `packages/api/test/routes/workflows.test.ts`
  - Assertion: Returns ideate, plan, build, ship
- [ ] Test: `should indicate which are customized`
  - Assertion: Each workflow shows isCustomized boolean
- [ ] Test: `should return 401 without authentication`
  - Assertion: Returns 401 Unauthorized

**Implementation (GREEN step)**:
- File: `packages/api/src/routes/workflows.ts`
- Endpoint: `GET /api/v1/workflows`
- Returns: List of workflows with customization status

**Acceptance Criteria**:
- [ ] All 4 workflows listed
- [ ] Customization status accurate

---

### Phase 2: Dashboard UI (AgenticDevWorkflow)

#### Task 7: Workflow Settings Page

**Objective**: Create dashboard page for viewing/editing workflow configs

**Tests to Write (RED step)**:
- [ ] Test: `should render workflow list`
  - File: `packages/web/test/pages/settings/workflows.test.tsx`
  - Assertion: Shows all 4 workflows
- [ ] Test: `should show customized badge for modified workflows`
  - Assertion: Visual indicator for custom vs default
- [ ] Test: `should navigate to workflow editor on click`
  - Assertion: Routes to /settings/workflows/:name

**Implementation (GREEN step)**:
- File: `packages/web/app/settings/workflows/page.tsx`
- Components:
  - WorkflowList
  - WorkflowCard (shows name, status, edit button)

**Acceptance Criteria**:
- [ ] All 4 workflows displayed
- [ ] Customization status visible
- [ ] Navigation works

---

#### Task 8: Workflow Editor - Chain Configuration

**Objective**: UI for editing command chain sequence

**Tests to Write (RED step)**:
- [ ] Test: `should display current chain steps`
  - File: `packages/web/test/components/workflow-editor.test.tsx`
  - Assertion: Shows ordered list of chain commands
- [ ] Test: `should allow reordering chain steps`
  - Assertion: Drag/drop updates order
- [ ] Test: `should allow toggling optional steps`
  - Assertion: Condition-based steps can be enabled/disabled
- [ ] Test: `should show available commands to add`
  - Assertion: Dropdown with available commands

**Implementation (GREEN step)**:
- File: `packages/web/app/settings/workflows/[name]/page.tsx`
- Components:
  - ChainEditor (drag/drop list)
  - ChainStep (individual step with condition toggle)
  - AddStepDropdown

**Acceptance Criteria**:
- [ ] Chain displayed correctly
- [ ] Reordering works
- [ ] Conditions toggleable

---

#### Task 9: Workflow Editor - Agent Configuration

**Objective**: UI for configuring which agents run

**Tests to Write (RED step)**:
- [ ] Test: `should display current agent list`
  - File: `packages/web/test/components/agent-editor.test.tsx`
  - Assertion: Shows configured agents
- [ ] Test: `should allow adding agents`
  - Assertion: Can select from available agents
- [ ] Test: `should allow removing agents`
  - Assertion: Can remove agents from list
- [ ] Test: `should show parallel vs sequential toggle for ship`
  - Assertion: Ship workflow shows parallel execution option

**Implementation (GREEN step)**:
- File: `packages/web/components/AgentEditor.tsx`
- Components:
  - AgentList
  - AgentSelector (dropdown of available agents)
  - ParallelToggle

**Acceptance Criteria**:
- [ ] Agents configurable
- [ ] Parallel execution toggle works
- [ ] Changes saved correctly

---

#### Task 10: Workflow Editor - Save and Reset

**Objective**: Save changes and reset to defaults

**Tests to Write (RED step)**:
- [ ] Test: `should save changes via API`
  - Assertion: PUT request sent with updated config
- [ ] Test: `should show success toast on save`
  - Assertion: Success feedback displayed
- [ ] Test: `should reset to defaults`
  - Assertion: Confirms and deletes custom config
- [ ] Test: `should show validation errors`
  - Assertion: Errors displayed inline

**Implementation (GREEN step)**:
- File: `packages/web/components/WorkflowEditorActions.tsx`
- Components:
  - SaveButton
  - ResetToDefaultsButton
  - ValidationErrors

**Acceptance Criteria**:
- [ ] Save works
- [ ] Reset works
- [ ] Validation feedback shown

---

### Phase 3: Plugin Integration (one-shot-ship-plugin)

#### Task 11: Fetch Workflow Config from API

**Objective**: Plugin fetches workflow config like prompts

**Tests to Write (RED step)**:
- [ ] Test: `should fetch workflow config from API`
  - File: `test/api/workflow-config.test.ts`
  - Assertion: GET /api/v1/workflows/:name called
- [ ] Test: `should decrypt config using stored credentials`
  - Assertion: Config decrypted correctly
- [ ] Test: `should cache config for session`
  - Assertion: Second call uses cache, no API request
- [ ] Test: `should handle API errors gracefully`
  - Assertion: Falls back to hardcoded defaults on error

**Implementation (GREEN step)**:
- File: `src/api/workflow-config.ts`
- Functions:
  - `fetchWorkflowConfig(workflowName: string): Promise<WorkflowConfig>`
  - `decryptWorkflowConfig(encrypted: EncryptedConfig): WorkflowConfig`
  - `getCachedOrFetch(workflowName: string): Promise<WorkflowConfig>`

**Acceptance Criteria**:
- [ ] Config fetched from API
- [ ] Decryption works
- [ ] Caching prevents redundant calls

---

#### Task 12: Workflow Engine - Condition Evaluator

**Objective**: Evaluate conditions like "has_api_work"

**Tests to Write (RED step)**:
- [ ] Test: `should evaluate has_api_work based on design content`
  - File: `test/engine/conditions.test.ts`
  - Assertion: Returns true when design mentions API
- [ ] Test: `should evaluate has_db_work based on design content`
  - Assertion: Returns true when design mentions database
- [ ] Test: `should evaluate has_ui_work based on files changed`
  - Assertion: Returns true when .tsx/.css files modified
- [ ] Test: `should handle unknown conditions gracefully`
  - Assertion: Returns false for unknown conditions

**Implementation (GREEN step)**:
- File: `src/engine/conditions.ts`
- Functions:
  - `evaluateCondition(condition: string, context: WorkflowContext): boolean`
  - `getBuiltInConditions(): Record<string, ConditionFn>`

**Acceptance Criteria**:
- [ ] Built-in conditions work
- [ ] Context passed correctly

---

#### Task 13: Workflow Engine - Chain Executor

**Objective**: Execute command chains based on config

**Tests to Write (RED step)**:
- [ ] Test: `should invoke Skill tool for command chains`
  - File: `test/engine/executor.test.ts`
  - Assertion: Skill("oss:requirements") called
- [ ] Test: `should skip optional chains when condition is false`
  - Assertion: api-design skipped when has_api_work is false
- [ ] Test: `should execute chains in order`
  - Assertion: Commands invoked in sequence
- [ ] Test: `should stop at human checkpoint`
  - Assertion: Returns CHECKPOINT when checkpoint is human
- [ ] Test: `should log chain execution`
  - Assertion: Workflow log updated

**Implementation (GREEN step)**:
- File: `src/engine/executor.ts`
- Functions:
  - `executeChain(config: WorkflowConfig, context: WorkflowContext): Promise<ChainResult>`
  - `invokeCommand(command: string): Promise<void>`

**Acceptance Criteria**:
- [ ] Commands invoked via Skill tool
- [ ] Conditions respected
- [ ] Checkpoints work

---

#### Task 14: Workflow Engine - Agent Spawner

**Objective**: Spawn agents based on config

**Tests to Write (RED step)**:
- [ ] Test: `should spawn single agent with Task tool`
  - File: `test/engine/agents.test.ts`
  - Assertion: Task tool called with correct subagent_type
- [ ] Test: `should spawn parallel agents in single message`
  - Assertion: Multiple Task calls for ship workflow
- [ ] Test: `should skip conditional agents when condition false`
  - Assertion: frontend-design skipped when no UI work
- [ ] Test: `should aggregate results from multiple agents`
  - Assertion: Combined results returned

**Implementation (GREEN step)**:
- File: `src/engine/agents.ts`
- Functions:
  - `spawnAgent(config: AgentConfig, context: WorkflowContext): Promise<AgentResult>`
  - `spawnParallelAgents(configs: AgentConfig[]): Promise<AgentResult[]>`

**Acceptance Criteria**:
- [ ] Agents spawned correctly
- [ ] Parallel execution works
- [ ] Results aggregated

---

#### Task 15: Refactor Prompts to Use Fetched Config

**Objective**: Remove hardcoded chains from all 4 main prompts

**Tests to Write (RED step)**:
- [ ] Test: `ideate prompt should not contain hardcoded chains`
  - File: `test/prompts/refactored.test.ts`
  - Assertion: No "/oss:requirements" literal in prompt
- [ ] Test: `plan prompt should not contain hardcoded chains`
  - Assertion: No "/oss:acceptance" literal
- [ ] Test: `build prompt should not contain hardcoded agent list`
  - Assertion: No hardcoded agent references
- [ ] Test: `ship prompt should not contain hardcoded quality gates`
  - Assertion: No hardcoded agent names

**Implementation (GREEN step)**:
- Files to modify:
  - `packages/api/src/prompts/commands/ideate.md`
  - `packages/api/src/prompts/commands/plan.md`
  - `packages/api/src/prompts/commands/build.md`
  - `packages/api/src/prompts/commands/ship.md`
- Changes:
  - Remove "Command Chain (MANDATORY)" sections
  - Remove hardcoded agent lists
  - Add "Chain execution driven by workflow config" note

**Acceptance Criteria**:
- [ ] No hardcoded orchestration in prompts
- [ ] Prompts cleaner and more focused
- [ ] Behavior unchanged with default config

---

### Phase 4: Polish

#### Task 16: Skill - Show Current Workflow Config

**Objective**: Let users see their current workflow configuration

**Tests to Write (RED step)**:
- [ ] Test: `oss:workflows should list all 4 workflows`
  - File: `test/skills/workflows.test.ts`
  - Assertion: Returns ideate, plan, build, ship with status
- [ ] Test: `oss:workflows show ideate should display config`
  - Assertion: Shows chain steps and agents

**Implementation (GREEN step)**:
- File: `commands/oss-workflows.md`
- Skill that fetches and displays workflow config

**Acceptance Criteria**:
- [ ] Users can see their config
- [ ] Clear formatting

---

#### Task 17: Seed Production Workflow Configs for Your Team

**Objective**: Create WorkflowConfig records in Supabase for your team matching current command chains

**Tests to Write (RED step)**:
- [ ] Test: `should create ideate config matching demo script`
  - File: `packages/api/test/seeds/production-seed.test.ts`
  - Assertion: ideate chains to requirements, api-design?, data-model?, adr
- [ ] Test: `should create plan config matching demo script`
  - Assertion: plan chains to acceptance
- [ ] Test: `should create build config matching demo script`
  - Assertion: red→green→refactor loop, integration, code-simplifier, frontend-design?
- [ ] Test: `should create ship config matching demo script`
  - Assertion: 4 parallel quality agents, all must pass

**Implementation (GREEN step)**:
- File: `packages/api/scripts/seed-production-workflows.ts`
- Script to run against Supabase:
  ```typescript
  // Create WorkflowConfig records for your team
  const YOUR_TEAM_ID = 'your-team-id-here';

  await prisma.workflowConfig.createMany({
    data: [
      { teamId: YOUR_TEAM_ID, workflowName: 'ideate', config: IDEATE_CONFIG },
      { teamId: YOUR_TEAM_ID, workflowName: 'plan', config: PLAN_CONFIG },
      { teamId: YOUR_TEAM_ID, workflowName: 'build', config: BUILD_CONFIG },
      { teamId: YOUR_TEAM_ID, workflowName: 'ship', config: SHIP_CONFIG },
    ]
  });
  ```

**Production Configs to Seed**:

```json
// IDEATE_CONFIG
{
  "chains_to": [
    { "command": "requirements", "always": true },
    { "command": "api-design", "condition": "has_api_work" },
    { "command": "data-model", "condition": "has_db_work" },
    { "command": "adr", "always": true }
  ],
  "checkpoint": "human"
}

// PLAN_CONFIG
{
  "pre_steps": [
    { "action": "archive_completed", "path": "dev/active/" }
  ],
  "chains_to": [
    { "command": "acceptance", "always": true }
  ],
  "checkpoint": "human"
}

// BUILD_CONFIG
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

// SHIP_CONFIG
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

**Execution**:
```bash
# Run after migration is deployed
npx ts-node packages/api/scripts/seed-production-workflows.ts
```

**Acceptance Criteria**:
- [ ] All 4 workflow configs created in Supabase
- [ ] Configs match demo script specification exactly
- [ ] Your team can immediately use the new workflow engine
- [ ] Verified via dashboard that configs appear

---

## Testing Strategy

### Unit Tests (~50 tests)
- Database operations (4)
- Schema validation (6)
- API endpoints (15)
- Condition evaluator (4)
- Chain executor (5)
- Agent spawner (4)
- Config fetching (4)

### Integration Tests (~12 tests)
- Full workflow with default config (4)
- Full workflow with custom config (4)
- Dashboard save/reset (4)

### E2E Tests (~4 tests)
- Customize workflow via dashboard → run workflow → verify behavior

## Security Checklist

- [ ] Workflow configs encrypted like prompts
- [ ] Team admin required to modify configs
- [ ] Condition expressions validated (no injection)
- [ ] Agent names validated against allowlist

## Performance Considerations

- [ ] Config cached per session
- [ ] Single API call per workflow (not per command)
- [ ] Parallel agent spawning for ship

## Rollout Strategy

1. **Phase 1**: API endpoints + database (behind feature flag)
2. **Phase 2**: Dashboard UI (team settings)
3. **Phase 3**: Plugin integration (fetch from API)
4. **Phase 4**: Enable by default, announce feature

## Estimated Tasks: 17
## Estimated Test Cases: ~70

---

## File Structure After Implementation

```
AgenticDevWorkflow/
├── packages/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   └── workflows.ts        # NEW: Workflow config endpoints
│   │   │   ├── schemas/
│   │   │   │   └── workflow-config.ts  # NEW: Zod validation
│   │   │   ├── config/
│   │   │   │   └── workflow-defaults.ts # NEW: Default configs
│   │   │   └── prompts/commands/
│   │   │       ├── ideate.md           # REFACTORED
│   │   │       ├── plan.md             # REFACTORED
│   │   │       ├── build.md            # REFACTORED
│   │   │       └── ship.md             # REFACTORED
│   │   └── test/
│   │       ├── routes/workflows.test.ts
│   │       ├── schemas/workflow-config.test.ts
│   │       └── seeds/workflow-defaults.test.ts
│   ├── web/
│   │   └── app/settings/workflows/
│   │       ├── page.tsx                # NEW: Workflow list
│   │       └── [name]/page.tsx         # NEW: Workflow editor
│   └── database/
│       └── prisma/
│           └── schema.prisma           # ADD: WorkflowConfig model

one-shot-ship-plugin/
├── src/
│   ├── api/
│   │   └── workflow-config.ts          # NEW: Fetch from API
│   └── engine/
│       ├── conditions.ts               # NEW: Condition evaluator
│       ├── executor.ts                 # NEW: Chain executor
│       └── agents.ts                   # NEW: Agent spawner
├── commands/
│   └── oss-workflows.md                # NEW: View config skill
└── test/
    ├── api/workflow-config.test.ts
    └── engine/
        ├── conditions.test.ts
        ├── executor.test.ts
        └── agents.test.ts
```
