# Design: Claude Code v2.1.0 + Playwright Integration

## Overview

This feature set adapts OSS Dev Workflow to leverage Claude Code v2.1.0 capabilities while adding first-class Playwright support for web application developers.

## Architecture Decisions

### AD-1: Wildcard Permissions Strategy

**Decision**: Use minimally scoped wildcard patterns in hooks.json

**Rationale**: Balance UX (fewer prompts) with security (no arbitrary execution)

**Patterns Chosen**:
- `Bash($CLAUDE_PLUGIN_ROOT/hooks/*)` - Only our hooks
- `Bash(npm test)` - Standard test command only
- `Bash(git *)` - Git operations (already trusted)
- `Bash(gh pr *)` - GitHub CLI for PRs

**Rejected**: `Bash(*)` - Too permissive, security risk

---

### AD-2: Context Fork Agent Selection

**Decision**: Apply `context: fork` only to agents that typically consume >5k tokens

**Rationale**:
- Small agents benefit from parent context
- Large agents (code-reviewer, debugger) bloat parent context unnecessarily
- Forked agents return summarized results, keeping parent lean

**Selected Agents**:
1. code-reviewer (reads many files)
2. debugger (explores code paths)
3. test-engineer (writes many tests)
4. refactoring-specialist (analyzes structure)
5. architecture-auditor (comprehensive review)

---

### AD-3: Playwright Detection Method

**Decision**: Multi-signal detection in priority order

**Detection Logic**:
```
1. Check package.json for "@playwright/test" in devDependencies
2. Check for playwright.config.ts (preferred)
3. Check for playwright.config.js (fallback)
4. Return: { detected: boolean, configPath: string, version: string }
```

**Rationale**: Most reliable signals in order of specificity

---

### AD-4: Playwright Test Generation Style

**Decision**: Given/When/Then format with data-testid selectors

**Rationale**:
- Given/When/Then is readable by non-engineers (BDD style)
- data-testid selectors are Playwright best practice
- Resilient to CSS/class name changes

**Example**:
```typescript
test('should register new user', async ({ page }) => {
  // Given
  await page.goto('/register');

  // When
  await page.fill('[data-testid="email"]', 'test@example.com');
  await page.click('[data-testid="submit"]');

  // Then
  await expect(page).toHaveURL('/dashboard');
});
```

---

### AD-5: Graceful Degradation Pattern

**Decision**: Provide exact manual command on permission denial

**Rationale**:
- User knows exactly what to do
- No ambiguity about next steps
- Partial work preserved

**Template**:
```
Permission denied for [operation].

Your work has been saved. To complete manually:
  [exact command to run]

Files created:
  - [list of files]
```

---

## IP Protection Analysis

| Component | Exposes IP? | Safe? |
|-----------|-------------|-------|
| Wildcard permissions | No (just patterns) | Yes |
| Context fork frontmatter | No (execution model) | Yes |
| Thinking cleanup | No (removes scaffolding) | Yes |
| Ctrl+B docs | No (UX guidance) | Yes |
| Graceful degradation | No (error handling) | Yes |
| Token estimates | No (numbers only) | Yes |
| Playwright detection | No (utility script) | Yes |
| Test generation | Partial (templates) | Review templates |

**Conclusion**: All changes are safe. Test templates should be generic enough to not reveal methodology.

---

## Non-Goals

1. Remote environment support (`/remote-env`) - Requires architectural changes
2. Per-skill hooks with proprietary logic - IP protection concern
3. Full Playwright course/tutorial - OSS is a workflow tool, not a learning platform

---

*Last Updated: 2026-01-13*
