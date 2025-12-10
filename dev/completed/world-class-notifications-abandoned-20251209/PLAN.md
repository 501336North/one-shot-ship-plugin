# Implementation Plan: World-Class Notification Copy

## Summary

Transform 23 generic notification messages into exceptional, memorable copy that reflects the OSS brand personality. Every notification should feel premium, be useful, and make users smile.

## Design Principles

### 1. Brand Voice: Confident Ship Captain
- Nautical theme (subtle, not cheesy)
- Direct and action-oriented
- Celebrates wins, honest about failures
- Never corporate-speak

### 2. Copy Rules
- **Titles**: Max 20 chars, punchy, no fluff
- **Messages**: Max 50 chars, actionable context
- **Personality**: Clever but professional
- **Utility**: Include relevant data (counts, names, next steps)

### 3. Examples of Transformation

| Before | After (Title) | After (Message) |
|--------|---------------|-----------------|
| `Starting Ideation` | `Charting Course` | `Mapping requirements for {feature}` |
| `Build Complete` | `Ship Shape` | `{n} tests green. Ready to sail` |
| `Build Failed` | `Man Overboard` | `{test} failed. Rescue needed` |
| `PR Created` | `Ready to Launch` | `PR #{n}: {title} awaits review` |
| `Shipped!` | `Land Ho!` | `{branch} merged to main` |

---

## TDD Implementation Tasks

### Phase 1: Notification Copy Service (Foundation)

#### Task 1.1: Create NotificationCopyService with message templates

**Objective**: Centralized copy generation with context interpolation

**Tests to Write (RED step)**:
- File: `watcher/test/services/notification-copy.test.ts`

```typescript
/**
 * @behavior Notification copy is generated from templates with context
 * @acceptance-criteria AC-COPY.1
 */
describe('NotificationCopyService', () => {
  describe('getSessionCopy', () => {
    test('returns "Charting Course" for context_restored with branch', () => {
      const copy = service.getSessionCopy('context_restored', { branch: 'feat/auth' });
      expect(copy.title).toBe('Charting Course');
      expect(copy.message).toContain('feat/auth');
    });

    test('returns "New Voyage" for fresh_session', () => {
      const copy = service.getSessionCopy('fresh_session', { project: 'my-app' });
      expect(copy.title).toBe('New Voyage');
      expect(copy.message).toContain('my-app');
    });

    test('returns "Anchored" for session_end with uncommitted count', () => {
      const copy = service.getSessionCopy('session_end', { uncommitted: 3 });
      expect(copy.title).toBe('Anchored');
      expect(copy.message).toContain('3');
    });
  });
});
```

**Implementation (GREEN step)**:
- File: `watcher/src/services/notification-copy.ts`
- Class: `NotificationCopyService`
- Methods:
  - `getSessionCopy(event: SessionEvent, context: SessionContext): Copy`
  - `getWorkflowCopy(command: string, event: WorkflowEvent, context: WorkflowContext): Copy`
  - `getIssueCopy(issueType: IssueType, context: IssueContext): Copy`

**Acceptance Criteria**:
- [ ] All 3 tests pass
- [ ] Templates use {placeholder} interpolation
- [ ] Graceful fallback when context missing

---

#### Task 1.2: Session lifecycle copy templates

**Objective**: Premium copy for session start/end notifications

**Tests to Write (RED step)**:
```typescript
describe('Session Copy Templates', () => {
  test('context_restored includes age when available', () => {
    const copy = service.getSessionCopy('context_restored', {
      branch: 'main',
      age: '2h ago'
    });
    expect(copy.message).toMatch(/2h ago/);
  });

  test('fresh_session is welcoming for new users', () => {
    const copy = service.getSessionCopy('fresh_session', { project: 'untitled' });
    expect(copy.message).not.toContain('undefined');
    expect(copy.title).toBe('New Voyage');
  });

  test('session_end shows save confirmation', () => {
    const copy = service.getSessionCopy('session_end', {
      branch: 'feat/login',
      uncommitted: 0
    });
    expect(copy.message).toContain('clean');
  });
});
```

**Implementation (GREEN step)**:
```typescript
const SESSION_TEMPLATES = {
  context_restored: {
    title: 'Charting Course',
    message: 'Resuming {branch} • {age}',
  },
  fresh_session: {
    title: 'New Voyage',
    message: 'Ready to sail in {project}',
  },
  session_end: {
    title: 'Anchored',
    message: '{branch} saved • {uncommitted} pending',
  },
};
```

**Acceptance Criteria**:
- [ ] All 3 tests pass
- [ ] Messages feel premium, not robotic
- [ ] Edge cases handled (missing context)

---

### Phase 2: Workflow Command Copy

#### Task 2.1: Ideate command copy

**Tests to Write (RED step)**:
```typescript
describe('Ideate Copy', () => {
  test('start shows feature being explored', () => {
    const copy = service.getWorkflowCopy('ideate', 'start', {
      idea: 'user dashboard'
    });
    expect(copy.title).toBe('Charting Course');
    expect(copy.message).toContain('user dashboard');
  });

  test('complete celebrates with next step', () => {
    const copy = service.getWorkflowCopy('ideate', 'complete', {
      requirementsCount: 5
    });
    expect(copy.title).toBe('Course Plotted');
    expect(copy.message).toMatch(/5 requirements/);
  });

  test('failed is honest but encouraging', () => {
    const copy = service.getWorkflowCopy('ideate', 'failed', {
      reason: 'API timeout'
    });
    expect(copy.title).toBe('Off Course');
    expect(copy.message).not.toContain('Error');
  });
});
```

**Implementation (GREEN step)**:
```typescript
const IDEATE_TEMPLATES = {
  start: { title: 'Charting Course', message: 'Exploring "{idea}"...' },
  complete: { title: 'Course Plotted', message: '{requirementsCount} requirements mapped. /oss:plan next' },
  failed: { title: 'Off Course', message: 'Navigation issue. Try again?' },
};
```

---

#### Task 2.2: Plan command copy

**Tests to Write (RED step)**:
```typescript
describe('Plan Copy', () => {
  test('start shows planning action', () => {
    const copy = service.getWorkflowCopy('plan', 'start', {});
    expect(copy.title).toBe('Drawing Maps');
    expect(copy.message).toContain('TDD');
  });

  test('complete shows task count and next step', () => {
    const copy = service.getWorkflowCopy('plan', 'complete', {
      taskCount: 12,
      phases: 3
    });
    expect(copy.title).toBe('Maps Ready');
    expect(copy.message).toMatch(/12 tasks/);
  });

  test('failed suggests recovery', () => {
    const copy = service.getWorkflowCopy('plan', 'failed', {});
    expect(copy.title).toBe('Compass Spinning');
  });
});
```

---

#### Task 2.3: Build command copy

**Tests to Write (RED step)**:
```typescript
describe('Build Copy', () => {
  test('start shows construction beginning', () => {
    const copy = service.getWorkflowCopy('build', 'start', {
      totalTasks: 8
    });
    expect(copy.title).toBe('Raising Sails');
    expect(copy.message).toContain('8');
  });

  test('task_complete shows progress fraction', () => {
    const copy = service.getWorkflowCopy('build', 'task_complete', {
      current: 3,
      total: 8,
      taskName: 'auth service'
    });
    expect(copy.title).toBe('Knot Tied');
    expect(copy.message).toMatch(/3.*8/);
  });

  test('complete celebrates all tests passing', () => {
    const copy = service.getWorkflowCopy('build', 'complete', {
      testsPass: 47,
      duration: '4m 32s'
    });
    expect(copy.title).toBe('Ship Shape');
    expect(copy.message).toMatch(/47.*green/i);
  });

  test('failed identifies the broken test', () => {
    const copy = service.getWorkflowCopy('build', 'failed', {
      failedTest: 'auth.test.ts:42'
    });
    expect(copy.title).toBe('Man Overboard');
    expect(copy.message).toContain('auth.test.ts');
  });
});
```

---

#### Task 2.4: Ship command copy

**Tests to Write (RED step)**:
```typescript
describe('Ship Copy', () => {
  test('start shows quality check beginning', () => {
    const copy = service.getWorkflowCopy('ship', 'start', {});
    expect(copy.title).toBe('Final Check');
    expect(copy.message).toContain('quality');
  });

  test('quality_passed is satisfying', () => {
    const copy = service.getWorkflowCopy('ship', 'quality_passed', {
      checks: ['lint', 'types', 'tests']
    });
    expect(copy.title).toBe('All Clear');
    expect(copy.message).toMatch(/3 checks/);
  });

  test('pr_created shows PR number and title', () => {
    const copy = service.getWorkflowCopy('ship', 'pr_created', {
      prNumber: 42,
      prTitle: 'Add user auth'
    });
    expect(copy.title).toBe('Ready to Launch');
    expect(copy.message).toContain('#42');
  });

  test('merged is celebratory', () => {
    const copy = service.getWorkflowCopy('ship', 'merged', {
      branch: 'feat/auth',
      prNumber: 42
    });
    expect(copy.title).toBe('Land Ho!');
    expect(copy.message).toContain('merged');
  });

  test('failed explains what blocked', () => {
    const copy = service.getWorkflowCopy('ship', 'failed', {
      blocker: 'CI failed'
    });
    expect(copy.title).toBe('Stuck in Port');
    expect(copy.message).toContain('CI');
  });
});
```

---

### Phase 3: Issue/Intervention Copy

#### Task 3.1: Watcher issue copy templates

**Tests to Write (RED step)**:
```typescript
describe('Issue Copy', () => {
  test('loop_detected is urgent but helpful', () => {
    const copy = service.getIssueCopy('loop_detected', {
      toolName: 'Grep',
      iterations: 7
    });
    expect(copy.title).toBe('Caught in Whirlpool');
    expect(copy.message).toContain('Grep');
    expect(copy.message).toContain('7');
  });

  test('tdd_violation is educational', () => {
    const copy = service.getIssueCopy('tdd_violation', {
      violation: 'code before test'
    });
    expect(copy.title).toBe('Wrong Heading');
    expect(copy.message).toContain('RED');
  });

  test('regression shows what broke', () => {
    const copy = service.getIssueCopy('regression', {
      failedTests: 3,
      previouslyPassing: true
    });
    expect(copy.title).toBe('Taking on Water');
    expect(copy.message).toMatch(/3.*broke/);
  });

  test('phase_stuck suggests action', () => {
    const copy = service.getIssueCopy('phase_stuck', {
      phase: 'GREEN',
      duration: '5m'
    });
    expect(copy.title).toBe('Becalmed');
    expect(copy.message).toContain('GREEN');
  });
});
```

---

### Phase 4: Integration & Shell Hook Updates

#### Task 4.1: Update oss-notify.sh to use copy service

**Objective**: Shell hook calls TypeScript service for copy

**Tests to Write (RED step)**:
```bash
# Manual test script: test-notify-copy.sh
#!/bin/bash

# Test ideate start
OUTPUT=$(node dist/cli.js get-copy ideate start '{"idea":"auth"}')
echo "$OUTPUT" | grep -q "Charting Course" || echo "FAIL: ideate start title"

# Test build complete
OUTPUT=$(node dist/cli.js get-copy build complete '{"testsPass":47}')
echo "$OUTPUT" | grep -q "Ship Shape" || echo "FAIL: build complete title"
echo "$OUTPUT" | grep -q "47" || echo "FAIL: build complete message"

echo "All manual tests passed"
```

**Implementation (GREEN step)**:
- Create CLI entry point: `watcher/src/cli.ts`
- Command: `node dist/cli.js get-copy <command> <event> <context-json>`
- Returns: JSON `{ "title": "...", "message": "..." }`

---

#### Task 4.2: Update all command files with new copy

**Objective**: Replace hardcoded strings in .md files

**Implementation**:
Update these files to call the copy service:

| File | Changes |
|------|---------|
| `commands/ideate.md` | 3 notification calls |
| `commands/plan.md` | 3 notification calls |
| `commands/build.md` | 4 notification calls |
| `commands/ship.md` | 5 notification calls |
| `hooks/oss-session-start.sh` | 2 notification calls |
| `hooks/oss-session-end.sh` | 1 notification call |

**Acceptance Criteria**:
- [ ] All 18 workflow notifications use new copy
- [ ] Context is passed correctly to each call
- [ ] Fallback to old copy if service unavailable

---

### Phase 5: Copy Refinement & Testing

#### Task 5.1: End-to-end notification copy verification

**Tests to Write (RED step)**:
```typescript
describe('E2E Notification Copy', () => {
  test('full ideate workflow produces correct notifications', () => {
    // Simulate: start -> complete
    const start = service.getWorkflowCopy('ideate', 'start', { idea: 'auth' });
    const complete = service.getWorkflowCopy('ideate', 'complete', { requirementsCount: 5 });

    expect(start.title).not.toBe(complete.title);
    expect(complete.message).toContain('/oss:plan');
  });

  test('all titles are under 20 characters', () => {
    const allTitles = service.getAllTitles();
    allTitles.forEach(title => {
      expect(title.length).toBeLessThanOrEqual(20);
    });
  });

  test('no copy contains "Error" or "Failed" (use branded alternatives)', () => {
    const allMessages = service.getAllMessages();
    allMessages.forEach(msg => {
      expect(msg).not.toMatch(/\bError\b/i);
      expect(msg).not.toMatch(/\bFailed\b/i);
    });
  });
});
```

---

## Complete Copy Reference

### Session Lifecycle

| Event | Title | Message Template |
|-------|-------|------------------|
| context_restored | `Charting Course` | `Resuming {branch} • {age}` |
| fresh_session | `New Voyage` | `Ready to sail in {project}` |
| session_end | `Anchored` | `{branch} • {uncommitted} uncommitted` |

### Ideate Command

| Event | Title | Message Template |
|-------|-------|------------------|
| start | `Charting Course` | `Exploring "{idea}"...` |
| complete | `Course Plotted` | `{n} requirements mapped` |
| failed | `Off Course` | `Navigation issue. Retry?` |

### Plan Command

| Event | Title | Message Template |
|-------|-------|------------------|
| start | `Drawing Maps` | `Architecting TDD plan...` |
| complete | `Maps Ready` | `{n} tasks in {p} phases` |
| failed | `Compass Spinning` | `Planning blocked. Check reqs` |

### Build Command

| Event | Title | Message Template |
|-------|-------|------------------|
| start | `Raising Sails` | `Building {n} tasks...` |
| task_complete | `Knot Tied` | `{current}/{total}: {name}` |
| complete | `Ship Shape` | `{n} tests green in {time}` |
| failed | `Man Overboard` | `{test} needs rescue` |

### Ship Command

| Event | Title | Message Template |
|-------|-------|------------------|
| start | `Final Check` | `Running quality gates...` |
| quality_passed | `All Clear` | `{n} checks passed` |
| pr_created | `Ready to Launch` | `PR #{n}: {title}` |
| merged | `Land Ho!` | `{branch} reached main` |
| failed | `Stuck in Port` | `{blocker} blocking` |

### Issues/Interventions

| Issue Type | Title | Message Template |
|------------|-------|------------------|
| loop_detected | `Caught in Whirlpool` | `{tool} spinning ({n}x)` |
| tdd_violation | `Wrong Heading` | `RED first, then GREEN` |
| regression | `Taking on Water` | `{n} tests broke` |
| phase_stuck | `Becalmed` | `{phase} stalled {time}` |
| chain_broken | `Lost Bearings` | `Run {prereq} first` |
| explicit_failure | `Rough Seas` | `{error} encountered` |
| agent_failed | `Crew Down` | `{agent} couldn't finish` |

### Settings & Login

| Event | Title | Message Template |
|-------|-------|------------------|
| welcome | `Welcome Aboard` | `Notifications configured` |
| settings_saved | `Preferences Set` | `Your way, captain` |

---

## Testing Strategy

### Unit Tests
- [ ] NotificationCopyService (15 tests)
- [ ] Session templates (3 tests)
- [ ] Workflow templates (15 tests)
- [ ] Issue templates (7 tests)

### Integration Tests
- [ ] CLI get-copy command (5 tests)
- [ ] Shell hook integration (manual)

### Quality Tests
- [ ] Title length validation
- [ ] No corporate-speak words
- [ ] Consistent nautical theme

## Security Checklist

- [ ] No secrets in notification messages
- [ ] No user data (emails, keys) in messages
- [ ] Context sanitization for shell injection

## Estimated Tasks: 5 phases, ~10 tasks
## Estimated Test Cases: ~45 automated + manual tests

---

## Command Chain

```
/oss:ideate (DONE - designed copy)
    ↓
/oss:plan (THIS DOCUMENT)
    ↓
/oss:build → Execute phases 1-5
    ↓
/oss:ship → Quality check, commit, PR
```

Ready for `/oss:build`?
