# Technical Decisions: Configurable Workflow Orchestration

## ADR-001: API-Driven Config vs Local File

**Status**: Decided

**Context**:
Need to decide where workflow configurations are stored and how they're accessed.

**Options**:
1. **Option A**: Local `oss.config.json` file in project or home directory
2. **Option B**: Multiple config files per concern
3. **Option C**: API-driven config stored in database, fetched encrypted

**Decision**: **Option C - API-Driven Configuration**

**Rationale**:
- **IP Protection**: Workflow structure stays on server, not exposed locally
- **Customizable**: Teams can modify via dashboard without editing files
- **Consistent**: Same encryption as prompts (license-bound)
- **Auditable**: Config changes tracked in database

**Consequences**:
- Requires API connectivity to fetch config
- More complex than local file
- Dashboard UI needed for editing
- Fallback to defaults if API unavailable

---

## ADR-002: Per-Team vs Per-User vs Per-Project Config

**Status**: Decided

**Context**:
Need to decide the granularity of workflow configurations.

**Options**:
1. Per-user: Each user has their own config
2. Per-project: Each project/repo has its own config
3. Per-team: Team shares a single config

**Decision**: **Per-Team Configuration**

**Rationale**:
- Teams should have consistent workflows across members
- Reduces config management overhead
- Aligns with subscription model (team plans)
- Individual users can still use defaults

**Consequences**:
- Team admin required to modify config
- Members inherit team's workflow automatically
- No per-project customization (may add later)

---

## ADR-003: Config Schema Design

**Status**: Decided

**Context**:
Need to design the structure of workflow configuration JSON.

**Decision**: Hierarchical schema with typed fields

```typescript
interface WorkflowConfig {
  chains_to?: ChainStep[];      // Commands to run after
  pre_steps?: PreStep[];        // Steps before main workflow
  task_loop?: string[];         // For build: TDD cycle
  agents?: AgentConfig[];       // Agents to spawn
  quality_gates?: QualityGateConfig;  // For ship
  checkpoint: "human" | "auto"; // Proceed or stop
}
```

**Rationale**:
- Clear separation of concerns
- Each field optional (only override what you need)
- Typed for validation (Zod schema)
- Extensible for future features

---

## ADR-004: Condition Expression Language

**Status**: Decided

**Context**:
Need to decide how conditions like "if API work" are specified and evaluated.

**Options**:
1. Simple string identifiers: `"has_api_work"`
2. JavaScript expressions: `"design.includes('API')"`
3. JSON query language: `{"$contains": ["design", "API"]}`

**Decision**: **Simple string identifiers with built-in conditions**

**Built-in Conditions**:
- `has_api_work` - Design mentions API/endpoint
- `has_db_work` - Design mentions database/schema
- `has_ui_work` - Changed files include .tsx/.css
- `has_test_failures` - Test suite failing
- `always` - Always true
- `never` - Always false

**Rationale**:
- Simple and safe (no code injection)
- Covers 90% of use cases
- Easy to document and understand
- Can add custom conditions via plugins later

---

## ADR-005: Encryption and Authentication

**Status**: Decided

**Context**:
Need to ensure workflow configs are protected like prompts.

**Decision**: Use same license-bound encryption as prompts

**Implementation**:
1. Config stored as plaintext JSON in database
2. When fetched via API:
   - requireAuth middleware validates token
   - checkSubscription middleware verifies active plan
   - Config encrypted using deriveKey(apiKey, licenseId, hardwareId, salt)
   - Returns: { encrypted, iv, authTag }
3. Plugin decrypts locally using stored credentials

**Rationale**:
- Consistent with prompt protection
- Reuses existing encryption infrastructure
- Same security guarantees

---

## ADR-006: Fallback Behavior

**Status**: Decided

**Context**:
Need to decide what happens when config fetch fails.

**Decision**: Fallback to hardcoded defaults

**Fallback Chain**:
1. Try to fetch team's custom config from API
2. If 404 (no custom config), use default config
3. If API error, use hardcoded defaults in plugin
4. Log warning when using fallback

**Rationale**:
- Workflow should never completely fail
- Hardcoded defaults match current behavior
- Users see warning if degraded

---

## ADR-007: Dashboard UI Approach

**Status**: Decided

**Context**:
Need to decide how teams customize workflows in the dashboard.

**Decision**: Visual workflow editor with:
- Chain sequence as drag/drop list
- Condition toggles (checkboxes)
- Agent multi-select for quality gates
- Save/Reset to defaults buttons

**Rationale**:
- No JSON editing (error-prone)
- Visual representation matches mental model
- Validation on save prevents invalid configs
- Easy to reset if something breaks
