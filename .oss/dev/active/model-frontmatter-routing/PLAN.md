# Implementation Plan: Model Frontmatter Routing

## Summary
Add `model:` frontmatter to agent, command, and skill .md files in the plugin repo to control which native Claude model handles each prompt. Optimizes cost (haiku for routine tasks) and guarantees quality (opus for critical reasoning) regardless of user's default model.

## Design Reference
See: `.oss/dev/active/model-frontmatter-routing/DESIGN.md`

## Scope: 164 total prompt files
- 44 agents (`agents/*.md`)
- 63 commands (`commands/*.md`)
- 57 skills (`skills/*.md`)

## TDD Implementation Tasks

### Task 1: Add `model: opus` to critical reasoning agents (8 agents)

**Objective**: Force Opus for agents where deep reasoning is non-negotiable.

**Tests to Write (RED step)**:
- [ ] Test: `should have model: opus for all critical reasoning agents`
  - File: `test/agents/model-frontmatter.test.ts`
  - Assertion: Parsed YAML frontmatter contains `model: "opus"` for all 8 agents

**Implementation (GREEN step)**:
- Files: `agents/architecture-auditor.md`, `agents/security-auditor.md`, `agents/incident-responder.md`, `agents/performance-auditor.md`, `agents/backend-architect.md`, `agents/cloud-architect.md`, `agents/debugger.md`, `agents/code-reviewer.md`
- Add `model: opus` to YAML frontmatter after `description:` line

**Acceptance Criteria**:
- [ ] All 8 agent .md files have `model: opus` in frontmatter
- [ ] Existing frontmatter fields (name, description, model_routing, context) preserved
- [ ] Tests pass

---

### Task 2: Add `model: haiku` to mechanical agents (5 agents)

**Objective**: Save cost on agents doing routine/templated work.

**Tests to Write (RED step)**:
- [ ] Test: `should have model: haiku for all mechanical agents`
  - File: `test/agents/model-frontmatter.test.ts`
  - Assertion: Parsed YAML frontmatter contains `model: "haiku"` for all 5 agents

**Implementation (GREEN step)**:
- Files: `agents/dependency-analyzer.md`, `agents/docs-architect.md`, `agents/git-workflow-manager.md`, `agents/release-manager.md`, `agents/seo-aeo-expert.md`
- Add `model: haiku` to YAML frontmatter

**Acceptance Criteria**:
- [ ] All 5 agent .md files have `model: haiku`
- [ ] Existing frontmatter preserved
- [ ] Tests pass

---

### Task 3: Verify inherit-parent agents have NO model field (31 agents)

**Objective**: Ensure the remaining agents inherit from parent (no model field = inherit).

**Tests to Write (RED step)**:
- [ ] Test: `should NOT have model field in frontmatter for inherit-parent agents`
  - File: `test/agents/model-frontmatter.test.ts`
  - Assertion: Parsed frontmatter does NOT contain `model` key for all 31 agents
- [ ] Test: `should account for all 44 agents across the three tiers`
  - Assertion: opus(8) + inherit(31) + haiku(5) = 44 total agents

**Implementation (GREEN step)**:
- No file changes needed — verification only

**Acceptance Criteria**:
- [ ] All 31 inherit-parent agents confirmed to have no `model:` field
- [ ] Total agent count validated (44)
- [ ] Tests pass

---

### Task 4: Add `model: opus` to critical reasoning commands (6 commands)

**Objective**: Force Opus for strategic planning and analysis commands.

**Tests to Write (RED step)**:
- [ ] Test: `should have model: opus for all critical commands`
  - File: `test/commands/model-frontmatter.test.ts`
  - Assertion: Batch test for: plan, ideate, review, audit, postmortem, chaos

**Implementation (GREEN step)**:
- Files: `commands/plan.md`, `commands/ideate.md`, `commands/review.md`, `commands/audit.md`, `commands/postmortem.md`, `commands/chaos.md`
- Add `model: opus` to YAML frontmatter after `description:` line

**Acceptance Criteria**:
- [ ] All 6 command .md files have `model: opus`
- [ ] Existing `description:` preserved
- [ ] Tests pass

---

### Task 5: Add `model: haiku` to routine commands (16 commands)

**Objective**: Save cost on display, config, and routine commands.

**Tests to Write (RED step)**:
- [ ] Test: `should have model: haiku for all routine commands`
  - File: `test/commands/model-frontmatter.test.ts`
  - Assertion: Batch test for: changelog, status, legend, settings, login, models, pause, resume, queue, watcher, telegram, workflows, oss, oss-audio, docs, release

**Implementation (GREEN step)**:
- Files: 16 command .md files
- Add `model: haiku` to YAML frontmatter

**Acceptance Criteria**:
- [ ] All 16 command .md files have `model: haiku`
- [ ] Existing frontmatter preserved
- [ ] Tests pass

---

### Task 6: Verify inherit-parent commands have NO model field (41 commands)

**Objective**: Ensure remaining commands inherit from parent model.

**Tests to Write (RED step)**:
- [ ] Test: `should NOT have model field for inherit-parent commands`
  - File: `test/commands/model-frontmatter.test.ts`
  - Assertion: No `model:` key in frontmatter for all 41 commands
- [ ] Test: `should account for all 63 commands across three tiers`
  - Assertion: opus(6) + inherit(41) + haiku(16) = 63 total commands

**Implementation (GREEN step)**:
- No file changes — verification only

**Acceptance Criteria**:
- [ ] All 41 inherit-parent commands confirmed
- [ ] Total command count validated (63)
- [ ] Tests pass

---

### Task 7: Add `model: opus` to critical reasoning skills (12 skills)

**Objective**: Force Opus for skills that mirror critical agents/commands or handle security analysis.

**Skills**: architecture-auditor, backend-architect, cloud-architect, code-reviewer, debugger, incident-responder, performance-auditor, security-auditor (mirror opus agents), plan, ideate (mirror opus commands), security-audit, owasp-top10 (standalone security)

**Tests to Write (RED step)**:
- [ ] Test: `should have model: opus for all critical skills`
  - File: `test/skills/model-frontmatter.test.ts`
  - Assertion: Parsed YAML frontmatter contains `model: "opus"` for all 12 skills

**Implementation (GREEN step)**:
- Files: 12 skill .md files
- Add `model: opus` to YAML frontmatter after `description:` line

**Acceptance Criteria**:
- [ ] All 12 skill .md files have `model: opus`
- [ ] Tests pass

---

### Task 8: Add `model: haiku` to routine skills (6 skills)

**Objective**: Save cost on mechanical/documentation skills.

**Skills**: dependency-analyzer, docs-architect, git-workflow-manager, release-manager (mirror haiku agents), release (mirror haiku command), create-dev-docs (standalone doc generation)

**Tests to Write (RED step)**:
- [ ] Test: `should have model: haiku for all routine skills`
  - File: `test/skills/model-frontmatter.test.ts`
  - Assertion: Parsed YAML frontmatter contains `model: "haiku"` for all 6 skills

**Implementation (GREEN step)**:
- Files: 6 skill .md files
- Add `model: haiku` to YAML frontmatter

**Acceptance Criteria**:
- [ ] All 6 skill .md files have `model: haiku`
- [ ] Tests pass

---

### Task 9: Verify inherit-parent skills have NO model field (39 skills)

**Objective**: Ensure remaining skills inherit from parent model.

**Tests to Write (RED step)**:
- [ ] Test: `should NOT have model field for inherit-parent skills`
  - File: `test/skills/model-frontmatter.test.ts`
  - Assertion: No `model:` key in frontmatter for all 39 skills
- [ ] Test: `should account for all 57 skills across three tiers`
  - Assertion: opus(12) + inherit(39) + haiku(6) = 57 total skills

**Implementation (GREEN step)**:
- No file changes — verification only

**Acceptance Criteria**:
- [ ] All 39 inherit-parent skills confirmed
- [ ] Total skill count validated (57)
- [ ] Tests pass

---

### Task 10: Validate model field coexistence with model_routing

**Objective**: Ensure `model:` (native Claude model) and `model_routing: true` (external proxy) coexist correctly.

**Tests to Write (RED step)**:
- [ ] Test: `should allow both model and model_routing in same frontmatter`
  - File: `test/agents/model-frontmatter.test.ts`
  - Assertion: Agents with both fields have valid values for each
- [ ] Test: `model field should only contain valid values across all prompt types`
  - Assertion: `model` is always one of: "opus", "sonnet", "haiku"

**Implementation (GREEN step)**:
- No additional changes — validates work from previous tasks
- Add note in `agents/_shared/model-routing.md` about the distinction

**Acceptance Criteria**:
- [ ] No conflicts between model and model_routing fields
- [ ] All model values are valid enum members
- [ ] Tests pass

---

### Task 11: Update /oss:models command documentation

**Objective**: Document the native `model:` frontmatter alongside existing model routing docs.

**Tests to Write (RED step)**:
- [ ] Test: `should mention native model frontmatter in models command help`
  - File: `test/commands/model-frontmatter.test.ts`
  - Assertion: `commands/models.md` contains reference to `model:` frontmatter

**Implementation (GREEN step)**:
- File: `commands/models.md`
- Add section explaining native `model:` frontmatter vs `model_routing` proxy system

**Acceptance Criteria**:
- [ ] models.md documents native model frontmatter
- [ ] Distinction between `model:` and `model_routing:` is clear
- [ ] Tests pass

---

## Implementation Sequence

1. **Agents Phase** (Tasks 1-3)
   - Task 1: Add `model: opus` to 8 critical agents
   - Task 2: Add `model: haiku` to 5 mechanical agents
   - Task 3: Verify 31 inherit-parent agents (no changes)

2. **Commands Phase** (Tasks 4-6)
   - Task 4: Add `model: opus` to 6 critical commands
   - Task 5: Add `model: haiku` to 16 routine commands
   - Task 6: Verify 41 inherit-parent commands (no changes)

3. **Skills Phase** (Tasks 7-9)
   - Task 7: Add `model: opus` to 12 critical skills
   - Task 8: Add `model: haiku` to 6 routine skills
   - Task 9: Verify 39 inherit-parent skills (no changes)

4. **Validation Phase** (Tasks 10-11)
   - Task 10: Validate model + model_routing coexistence
   - Task 11: Update documentation

## Testing Strategy

### Unit Tests
- [ ] YAML frontmatter parsing for all 44 agents
- [ ] YAML frontmatter parsing for all 63 commands
- [ ] YAML frontmatter parsing for all 57 skills
- [ ] Model value validation (only opus/sonnet/haiku allowed)
- [ ] model + model_routing coexistence

### Integration Tests
- [ ] Plugin manifest still valid after frontmatter changes
- [ ] Agent spawning respects model frontmatter (manual verification)

### Edge Cases
- [ ] Agent with both `model:` and `model_routing: true`
- [ ] Agent with `context: fork` and `model:`
- [ ] Command with only `description:` getting `model:` added

## Security Checklist
- [ ] No secrets in frontmatter
- [ ] No prompt content changes (frontmatter only)

## Performance Considerations
- [ ] Haiku prompts will respond faster (lower latency)
- [ ] Opus prompts may take longer but produce better reasoning
- [ ] Net cost reduction from 27 prompts downgraded to haiku (5 agents + 16 commands + 6 skills)

## Estimated Tasks: 11
## Estimated Test Cases: ~20
