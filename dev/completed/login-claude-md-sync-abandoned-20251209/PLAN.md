# Implementation Plan: CLAUDE.md Sync on Login

> **Project:** Sync CLAUDE.md from API on `/oss:login`
> **Created:** 2024-12-06
> **Status:** Planning
> **TDD Style:** London (Outside-In)

---

## Executive Summary

When users run `/oss:login`, the system should fetch the official CLAUDE.md template from the API and ensure it exists on the user's disk. This provides optimal Claude behavior within our guardrails without exposing proprietary prompt logic.

---

## Architecture

### Current Flow
```
/oss:login → Authenticate → Store API key → Done
```

### New Flow
```
/oss:login → Authenticate → Store API key → Fetch CLAUDE.md template → Create/Update local file → Done
```

### Components

1. **API Endpoint** (AgenticDevWorkflow)
   - `GET /api/v1/prompts/claude-md` - Returns CLAUDE.md template
   - Authenticated (requires valid API key)
   - Returns markdown content

2. **Login Command Update** (one-shot-ship-plugin)
   - After successful auth, fetch CLAUDE.md from API
   - Check if local CLAUDE.md exists
   - Create or merge with existing

---

## Phase 1: API Endpoint (AgenticDevWorkflow)

### Task 1.1: Create CLAUDE.md template file

**Acceptance Criteria:**
- AC-1.1.1: Template includes London TDD rules
- AC-1.1.2: Template includes agent delegation table
- AC-1.1.3: Template includes all OSS commands reference
- AC-1.1.4: Template includes quality standards

**Files to Create:**
- `packages/api/src/prompts/templates/claude-md.md`

---

### Task 1.2: Create API route for CLAUDE.md

**Acceptance Criteria:**
- AC-1.2.1: Endpoint requires authentication
- AC-1.2.2: Returns markdown content type
- AC-1.2.3: Returns 401 for unauthenticated requests
- AC-1.2.4: Returns 200 with template content for authenticated requests

**Test First:**
```typescript
describe('GET /api/v1/prompts/claude-md', () => {
  it('should return 401 without auth', async () => {
    const response = await request(app).get('/api/v1/prompts/claude-md');
    expect(response.status).toBe(401);
  });

  it('should return CLAUDE.md template with valid auth', async () => {
    const response = await request(app)
      .get('/api/v1/prompts/claude-md')
      .set('Authorization', `Bearer ${validApiKey}`);
    expect(response.status).toBe(200);
    expect(response.text).toContain('London TDD');
    expect(response.text).toContain('/oss:');
  });
});
```

**Files to Create:**
- `packages/api/src/routes/claude-md.ts`
- `packages/api/test/claude-md.test.ts`

---

## Phase 2: Login Command Update (one-shot-ship-plugin)

### Task 2.1: Update login.md to fetch CLAUDE.md

**Acceptance Criteria:**
- AC-2.1.1: After successful login, fetch CLAUDE.md from API
- AC-2.1.2: If no local CLAUDE.md, create it
- AC-2.1.3: If local CLAUDE.md exists, check for OSS section
- AC-2.1.4: Add/update OSS section without destroying user content

**Implementation:**
```markdown
## Step 4: Sync CLAUDE.md

After successful authentication:

1. Fetch CLAUDE.md template from API:
   ```
   URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/claude-md
   Headers:
     Authorization: Bearer {apiKey}
   ```

2. Check if CLAUDE.md exists in current directory:
   ```bash
   test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
   ```

3. If MISSING: Create new CLAUDE.md with fetched content

4. If EXISTS:
   - Check if it contains "# OSS Dev Workflow" section
   - If no OSS section: Append fetched content
   - If OSS section exists: Replace it with fresh version
```

**Files to Modify:**
- `commands/login.md`

---

## Phase 3: CLAUDE.md Template Content

### What to Include (Not IP, Just Guidelines)

```markdown
# OSS Dev Workflow - Project Guidelines

## Development Methodology: London TDD

This project uses London-style Test-Driven Development...
[TDD rules, mock policy, etc.]

## Agent Delegation (MANDATORY)

[Agent delegation table]

## Available Commands

### Core Workflow
- `/oss:ideate` - Transform ideas into designs
- `/oss:plan` - Create TDD implementation plans
- `/oss:build` - Execute with strict TDD
- `/oss:ship` - Quality check, commit, PR

### London TDD Cycle
- `/oss:red` - Write failing test
- `/oss:green` - Minimal implementation
- `/oss:refactor` - Clean up
- `/oss:mock` - Generate mocks

[... rest of commands ...]

## Quality Standards

[Standards]

---

*Powered by [OSS Dev Workflow](https://www.oneshotship.com)*
*Run `/oss:login` to update these guidelines*
```

---

## Implementation Order

```
Phase 1: API (AgenticDevWorkflow)
├── Task 1.1: Create template file
└── Task 1.2: Create API route + tests

Phase 2: Plugin (one-shot-ship-plugin)
└── Task 2.1: Update login.md
```

---

## IP Protection Analysis

| Content | Location | IP Risk |
|---------|----------|---------|
| TDD guidelines | CLAUDE.md on disk | None - generic best practices |
| Agent delegation table | CLAUDE.md on disk | None - just references |
| Command list | CLAUDE.md on disk | None - already public in README |
| Actual prompt logic | API only | Protected - never on disk |

**Conclusion:** Safe to put guidelines on disk. The magic is in the API prompts.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| API endpoint works | 200 with content |
| Login syncs CLAUDE.md | Creates/updates file |
| Existing content preserved | User additions not lost |
| All tests pass | Required |

---

## Next Step

Run `/oss:build` to begin Phase 1: API Endpoint
