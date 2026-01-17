# Implementation Plan: Claude Code v2.1.0 + Playwright Integration

**Feature**: OSS Plugin v2.1.0 Optimizations & Native Playwright Support
**Created**: 2026-01-13
**Status**: Ready for Approval
**Repository**: one-shot-ship-plugin

---

## Executive Summary

This plan covers two parallel tracks:
1. **Track 1**: Adopt Claude Code v2.1.0 features for improved UX and efficiency
2. **Track 2**: Add native Playwright integration for web app developers

Both tracks follow London TDD methodology (Outside-In, RED-GREEN-REFACTOR).

---

## Phase 1: Claude Code v2.1.0 Feature Adoption

### Task 1.1: Wildcard Bash Permissions
**Priority**: High | **Effort**: Low | **Files**: 1

Add wildcard permission patterns to reduce user approval friction.

**Current State**: Each unique bash command requires separate approval.

**Target State**: Pre-approved patterns for common operations.

**TDD Approach**:
- **RED**: Write test in `watcher/test/permissions.test.ts` that validates permission patterns are defined in plugin config
- **GREEN**: Update plugin.json with permission patterns
- **REFACTOR**: Ensure patterns are minimally permissive (principle of least privilege)

**Changes**:
```
hooks/hooks.json → Add "permissions" block:
  - Bash($CLAUDE_PLUGIN_ROOT/hooks/*)
  - Bash(npm test)
  - Bash(npm run build)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git push *)
  - Bash(gh pr *)
```

**Acceptance Criteria**:
- [ ] Permission patterns defined in hooks.json
- [ ] Test validates patterns exist and follow security best practices
- [ ] User can run OSS workflows with fewer approval prompts

---

### Task 1.2: Context Fork for Heavy Agents
**Priority**: High | **Effort**: Low | **Files**: 5

Add `context: fork` frontmatter to context-heavy agents.

**Current State**: All agents inherit full parent context, bloating token usage.

**Target State**: Heavy agents run in isolated context, results summarized back.

**TDD Approach**:
- **RED**: Write test that parses agent frontmatter and validates `context: fork` for specific agents
- **GREEN**: Add `context: fork` to target agent files
- **REFACTOR**: Document which agents use forked context and why

**Target Agents**:
```markdown
agents/code-reviewer.md      → context: fork
agents/debugger.md           → context: fork
agents/test-engineer.md      → context: fork
agents/refactoring-specialist.md → context: fork
agents/architecture-auditor.md   → context: fork
```

**Acceptance Criteria**:
- [ ] 5 agents updated with `context: fork` in frontmatter
- [ ] Test validates frontmatter parsing
- [ ] Documentation updated in CLAUDE.md

---

### Task 1.3: Extended Thinking Cleanup
**Priority**: Medium | **Effort**: Medium | **Files**: ~10

Remove redundant "think step-by-step" scaffolding now that extended thinking is default.

**Current State**: Commands include explicit thinking prompts that are now redundant.

**Target State**: Cleaner, more focused command prompts.

**TDD Approach**:
- **RED**: Write test that scans command files for deprecated thinking patterns
- **GREEN**: Remove patterns from identified files
- **REFACTOR**: Verify command behavior unchanged via integration test

**Target Commands**:
```
commands/ideate.md   → Remove step-by-step brainstorming scaffolding
commands/plan.md     → Remove explicit "think through each phase"
commands/debug.md    → Remove "systematically analyze"
commands/build.md    → Simplify TDD process section (keep requirements, remove think prompts)
```

**Patterns to Remove**:
- "Think through this step by step"
- "Before proceeding, consider..."
- "Analyze systematically by..."
- Explicit reasoning scaffolds (keep behavioral requirements)

**Acceptance Criteria**:
- [ ] Deprecated patterns identified and documented
- [ ] Test validates no deprecated patterns remain
- [ ] Commands work correctly after cleanup (manual verification)

---

### Task 1.4: Background Task Documentation (Ctrl+B)
**Priority**: Medium | **Effort**: Low | **Files**: 4

Add guidance for Ctrl+B backgrounding to long-running commands.

**Current State**: Users wait for long operations to complete.

**Target State**: Users informed they can background operations.

**TDD Approach**:
- **RED**: Write test that validates long-running commands have Ctrl+B guidance
- **GREEN**: Add documentation section to target commands
- **REFACTOR**: Standardize the guidance format

**Target Commands**:
```
commands/test.md     → Add "Long-running? Press Ctrl+B"
commands/build.md    → Add backgrounding guidance for multi-phase builds
commands/load.md     → Add backgrounding guidance for load tests
commands/bench.md    → Add backgrounding guidance for benchmarks
```

**Acceptance Criteria**:
- [ ] 4 commands updated with Ctrl+B guidance
- [ ] Test validates guidance present in target files
- [ ] Consistent format across all updated commands

---

### Task 1.5: Graceful Permission Denial Handling
**Priority**: Medium | **Effort**: Medium | **Files**: 3

Add fallback paths when users deny critical permissions.

**Current State**: Permission denial causes command failure.

**Target State**: Commands degrade gracefully with manual instructions.

**TDD Approach**:
- **RED**: Write test that simulates permission denial and validates fallback behavior
- **GREEN**: Add fallback sections to target commands
- **REFACTOR**: Extract common fallback pattern to reusable template

**Target Commands**:
```
commands/ship.md    → If git push denied: "PR prepared. Run: git push -u origin {branch}"
commands/deploy.md  → If kubectl denied: "Manifest saved. Run: kubectl apply -f {file}"
commands/release.md → If npm publish denied: "Package ready. Run: npm publish"
```

**Acceptance Criteria**:
- [ ] 3 commands have fallback paths defined
- [ ] Test validates fallback messages are present
- [ ] Fallback messages include exact command to run manually

---

### Task 1.6: Token Usage Visibility
**Priority**: Low | **Effort**: Low | **Files**: 2

Add estimated token usage to command descriptions.

**Current State**: Users have no visibility into command costs.

**Target State**: Commands display expected token ranges.

**TDD Approach**:
- **RED**: Write test that validates `estimated_tokens` in frontmatter for key commands
- **GREEN**: Add token estimates to command frontmatter
- **REFACTOR**: Document how estimates were calculated

**Target Commands** (with estimates):
```yaml
# commands/build.md
estimated_tokens: 5000-15000

# commands/ideate.md
estimated_tokens: 2000-8000

# commands/review.md
estimated_tokens: 3000-10000
```

**Acceptance Criteria**:
- [ ] Token estimates added to high-usage commands
- [ ] Test validates estimates are present and reasonable
- [ ] `/oss:status` shows session usage (if feasible)

---

## Phase 2: Native Playwright Integration

### Task 2.1: Playwright Detection Utility
**Priority**: High | **Effort**: Medium | **Files**: 2

Create utility to detect if project has Playwright configured.

**Current State**: No detection of Playwright in user projects.

**Target State**: Commands can detect and leverage existing Playwright setup.

**TDD Approach**:
- **RED**: Write test for `detect-playwright.sh` that returns presence status
- **GREEN**: Implement detection script (checks package.json, playwright.config.*)
- **REFACTOR**: Add caching to avoid repeated filesystem checks

**New File**: `hooks/oss-detect-playwright.sh`

```bash
# Detection logic:
# 1. Check package.json for "@playwright/test" dependency
# 2. Check for playwright.config.ts or playwright.config.js
# 3. Return JSON: {"detected": true, "configPath": "...", "version": "..."}
```

**Acceptance Criteria**:
- [ ] Script detects Playwright in projects that have it
- [ ] Script returns structured JSON output
- [ ] Test covers: present, absent, malformed config cases

---

### Task 2.2: Playwright Setup Scaffolding
**Priority**: Medium | **Effort**: Medium | **Files**: 1

Offer to scaffold Playwright when building web features.

**Current State**: Users must manually set up Playwright.

**Target State**: OSS offers to initialize Playwright for web projects.

**TDD Approach**:
- **RED**: Write test for scaffold command that creates minimal Playwright setup
- **GREEN**: Implement `oss-scaffold-playwright.sh` that runs `npm init playwright@latest`
- **REFACTOR**: Add project-type detection (Next.js, React, Vue) for optimized config

**New File**: `hooks/oss-scaffold-playwright.sh`

**Acceptance Criteria**:
- [ ] Script can scaffold Playwright in empty project
- [ ] Test validates playwright.config.ts created
- [ ] Script respects existing configuration (no overwrite)

---

### Task 2.3: Enhanced /oss:acceptance for Web UI
**Priority**: High | **Effort**: High | **Files**: 2

Generate Playwright acceptance tests for web UI features.

**Current State**: `/oss:acceptance` focuses on API/unit boundaries.

**Target State**: Detects web features and generates Playwright tests.

**TDD Approach**:
- **RED**: Write test that validates Playwright test generation for UI acceptance criteria
- **GREEN**: Update acceptance.md to detect UI features and generate Playwright tests
- **REFACTOR**: Support Given/When/Then format in generated tests

**Updates to**: `commands/acceptance.md`

**Generated Test Format**:
```typescript
// tests/acceptance/user-registration.spec.ts
import { test, expect } from '@playwright/test';

test.describe('User Registration', () => {
  test('should register new user with valid credentials', async ({ page }) => {
    // Given I am on the registration page
    await page.goto('/register');

    // When I fill in valid credentials
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'SecurePass123!');
    await page.click('[data-testid="submit"]');

    // Then I should see the dashboard
    await expect(page).toHaveURL('/dashboard');
  });
});
```

**Acceptance Criteria**:
- [ ] UI features detected via requirement keywords (form, page, click, etc.)
- [ ] Playwright test generated with proper structure
- [ ] Test uses data-testid selectors (best practice)
- [ ] Generated test follows Given/When/Then format

---

### Task 2.4: Enhanced /oss:test for Playwright
**Priority**: High | **Effort**: Medium | **Files**: 1

Run Playwright E2E tests as part of test workflow.

**Current State**: `/oss:test` runs tests but doesn't specifically handle Playwright.

**Target State**: Detects and runs Playwright tests, reports browser results.

**TDD Approach**:
- **RED**: Write test that validates Playwright execution path in test command
- **GREEN**: Update test.md to detect playwright.config and run `npx playwright test`
- **REFACTOR**: Add browser-specific reporting (Chromium, Firefox, WebKit)

**Updates to**: `commands/test.md`

**Execution Flow**:
```
1. Detect test frameworks (vitest, jest, playwright)
2. Run unit/integration tests first
3. If Playwright detected: run `npx playwright test --reporter=list`
4. Aggregate results: "Unit: 50/50 | E2E: 12/12 | Browsers: ✓ Chromium ✓ Firefox ✓ WebKit"
```

**Acceptance Criteria**:
- [ ] Playwright tests run when detected
- [ ] Results clearly separated from unit tests
- [ ] Browser coverage reported

---

### Task 2.5: Enhanced /oss:smoke for Browser Testing
**Priority**: Medium | **Effort**: Medium | **Files**: 1

Browser-based smoke tests after deployment.

**Current State**: `/oss:smoke` runs CLI/API checks.

**Target State**: Can run browser smoke tests against deployed URL.

**TDD Approach**:
- **RED**: Write test that validates browser smoke test execution
- **GREEN**: Update smoke.md to support `--browser` flag for Playwright smoke tests
- **REFACTOR**: Add critical path detection from existing Playwright tests

**Updates to**: `commands/smoke.md`

**Usage**:
```bash
/oss:smoke --url https://staging.example.com --browser
```

**Acceptance Criteria**:
- [ ] Browser smoke tests run against provided URL
- [ ] Critical user flows verified (login, main feature, checkout if applicable)
- [ ] Screenshot on failure for debugging

---

### Task 2.6: Enhanced /oss:red for UI Features
**Priority**: Medium | **Effort**: Medium | **Files**: 1

Scaffold Playwright test in RED phase for UI features.

**Current State**: `/oss:red` writes unit/integration tests only.

**Target State**: Detects UI feature and scaffolds Playwright test.

**TDD Approach**:
- **RED**: Write test that validates Playwright test scaffolding for UI feature
- **GREEN**: Update red.md to detect UI keywords and generate Playwright scaffold
- **REFACTOR**: Support page object pattern for complex pages

**Updates to**: `commands/red.md`

**Detection Keywords**: page, form, button, click, modal, navigation, UI, frontend

**Generated Scaffold**:
```typescript
// tests/e2e/feature-name.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.skip('should [acceptance criteria]', async ({ page }) => {
    // TODO: Implement test
    // This test should FAIL until implementation is complete
  });
});
```

**Acceptance Criteria**:
- [ ] UI features detected from task description
- [ ] Playwright test scaffolded with `.skip` (ensures RED phase)
- [ ] Test file created in correct location

---

## Phase 3: Testing & Documentation

### Task 3.1: Integration Tests for New Features
**Priority**: High | **Effort**: Medium | **Files**: 3

Write integration tests validating all changes work together.

**Test File**: `watcher/test/v2.1.0-features.test.ts`

**Test Cases**:
- Permission patterns are valid and minimal
- Context fork agents parse correctly
- Playwright detection works in various project structures
- Commands fall back gracefully on permission denial

---

### Task 3.2: Documentation Updates
**Priority**: Medium | **Effort**: Low | **Files**: 2

Update documentation for new features.

**Files**:
- `README.md` - Add Playwright integration section
- `CLAUDE.md` - Update with v2.1.0 patterns

---

## Test Summary

| Track | Tests | Type |
|-------|-------|------|
| Track 1 | 6 | Unit + Integration |
| Track 2 | 6 | Unit + Integration |
| Phase 3 | 2 | Integration + Docs |
| **Total** | **14** | |

---

## Dependency Graph

```
Phase 1 (Can run in parallel):
├── Task 1.1: Wildcard Permissions (standalone)
├── Task 1.2: Context Fork (standalone)
├── Task 1.3: Thinking Cleanup (standalone)
├── Task 1.4: Ctrl+B Docs (standalone)
├── Task 1.5: Graceful Degradation (standalone)
└── Task 1.6: Token Visibility (standalone)

Phase 2 (Sequential dependencies):
├── Task 2.1: Playwright Detection (first - required by all others)
├── Task 2.2: Playwright Scaffolding (depends on 2.1)
├── Task 2.3: /oss:acceptance Enhancement (depends on 2.1)
├── Task 2.4: /oss:test Enhancement (depends on 2.1)
├── Task 2.5: /oss:smoke Enhancement (depends on 2.1, 2.4)
└── Task 2.6: /oss:red Enhancement (depends on 2.1)

Phase 3 (After Phase 1 & 2):
├── Task 3.1: Integration Tests (depends on all above)
└── Task 3.2: Documentation (depends on all above)
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing commands | High | Integration tests before/after |
| Permission patterns too broad | Medium | Security review, minimal patterns |
| Playwright not installed in user project | Low | Graceful detection, offer scaffold |
| Extended thinking removal breaks quality | Medium | Manual testing of affected commands |

---

## Approval Checklist

- [ ] Plan reviewed and understood
- [ ] TDD approach for each task is clear
- [ ] Dependencies are correctly mapped
- [ ] Risk mitigations are acceptable

---

**Next Step**: After approval, run `/oss:build` to begin implementation with strict TDD.

---

*Last Updated: 2026-01-13*
