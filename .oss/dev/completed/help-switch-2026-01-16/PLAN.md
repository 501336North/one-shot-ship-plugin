# Plan: Comprehensive --help Support for All Commands

## Overview

Add `--help` support to all 53 OSS Dev Workflow commands so users can learn how each command works, its supported switches, role, goal, and position in the full workflow.

## Current State

- **53 commands** in `/commands/*.md`
- **No --help implementation** exists
- Commands have inconsistent documentation of flags
- No workflow position context in command docs
- Some commands have `## Flags` sections, most don't

## Design Decision

**Approach: Markdown-Based Help System**

Since commands are markdown prompts executed by Claude Code (not CLI binaries), we'll implement --help by:
1. Adding a standardized `## Help` section to each command markdown
2. When user runs `/oss:cmd --help`, Claude detects the flag and displays the help section instead of executing
3. No code changes needed - pure documentation enhancement

**Why this approach:**
- Consistent with existing architecture (prompts are markdown)
- Self-documenting (help lives with the command)
- No runtime code to maintain
- Easy to update as commands evolve

## Help Section Structure

Each command will have this standardized section at the top:

```markdown
## Help

**Command:** `/oss:command-name`

**Description:** One-line summary of what it does

**Workflow Position:** Where this fits (e.g., "ideate → plan → BUILD → ship")

**Usage:**
```bash
/oss:command-name [OPTIONS] [ARGUMENTS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<feature>` | Yes | Feature to plan |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--verbose` | `-v` | Enable verbose output |

**Examples:**
```bash
/oss:command-name "feature description"
/oss:command-name --flag value
```

**Related Commands:**
- `/oss:prev-cmd` - Run before this
- `/oss:next-cmd` - Run after this

---
```

## Phased Implementation

### Phase 1: Core Workflow Commands (Priority)
These are the most-used commands and form the main workflow.

| Task | Command | Workflow Position |
|------|---------|------------------|
| 1.1 | `/oss:ideate` | **1st** - Start here |
| 1.2 | `/oss:plan` | **2nd** - After ideate |
| 1.3 | `/oss:build` | **3rd** - After plan |
| 1.4 | `/oss:ship` | **4th** - After build |

**Tests for Phase 1:**
- Each command has `## Help` section
- Each has workflow position indicator
- Each lists related commands
- `--help` flag is documented

### Phase 2: TDD Cycle Commands
The granular London TDD commands.

| Task | Command | Workflow Position |
|------|---------|------------------|
| 2.1 | `/oss:red` | Build phase - Write failing test |
| 2.2 | `/oss:green` | Build phase - Pass the test |
| 2.3 | `/oss:refactor` | Build phase - Clean up |
| 2.4 | `/oss:mock` | Build phase - Create mocks |
| 2.5 | `/oss:acceptance` | Pre-build - System boundary tests |
| 2.6 | `/oss:integration` | Post-build - Validate mocks |

### Phase 3: Design Commands (Outside-In Starting Points)

| Task | Command | Workflow Position |
|------|---------|------------------|
| 3.1 | `/oss:requirements` | After ideate - Extract stories |
| 3.2 | `/oss:api-design` | After requirements - API contracts |
| 3.3 | `/oss:data-model` | After requirements - Schema design |
| 3.4 | `/oss:adr` | Any time - Record decisions |
| 3.5 | `/oss:contract` | Testing - Consumer contracts |

### Phase 4: Testing & Quality Commands

| Task | Command | Purpose |
|------|---------|---------|
| 4.1 | `/oss:test` | E2E test runner |
| 4.2 | `/oss:review` | Multi-perspective code review |
| 4.3 | `/oss:bench` | Performance benchmarking |
| 4.4 | `/oss:load` | Load testing with k6 |
| 4.5 | `/oss:audit` | Security scanning |
| 4.6 | `/oss:a11y` | Accessibility audit |
| 4.7 | `/oss:tech-debt` | Technical debt analysis |

### Phase 5: Deployment Commands

| Task | Command | Workflow Position |
|------|---------|------------------|
| 5.1 | `/oss:stage` | Pre-production deploy |
| 5.2 | `/oss:deploy` | Production deploy |
| 5.3 | `/oss:release` | Versioned release |
| 5.4 | `/oss:smoke` | Post-deploy validation |

### Phase 6: Operations Commands

| Task | Command | Purpose |
|------|---------|---------|
| 6.1 | `/oss:monitor` | Production health |
| 6.2 | `/oss:incident` | Incident response |
| 6.3 | `/oss:rollback` | Emergency rollback |
| 6.4 | `/oss:debug` | Systematic debugging |
| 6.5 | `/oss:trace` | Distributed tracing |
| 6.6 | `/oss:postmortem` | Post-incident analysis |

### Phase 7: Utility & Settings Commands

| Task | Command | Purpose |
|------|---------|---------|
| 7.1 | `/oss:login` | Authentication |
| 7.2 | `/oss:status` | Subscription status |
| 7.3 | `/oss:models` | Model routing config |
| 7.4 | `/oss:settings` | Preferences |
| 7.5 | `/oss:telegram` | Telegram notifications |
| 7.6 | `/oss:webhook` | GitHub webhook setup |
| 7.7 | `/oss:watcher` | Background agent |
| 7.8 | `/oss:queue` | Task queue management |
| 7.9 | `/oss:legend` | Status line legend |
| 7.10 | `/oss:docs` | Documentation generation |

### Phase 8: Specialized Commands

| Task | Command | Purpose |
|------|---------|---------|
| 8.1 | `/oss:iterate` | Feature refinement |
| 8.2 | `/oss:chaos` | Chaos engineering |
| 8.3 | `/oss:cost` | Cloud cost analysis |
| 8.4 | `/oss:design-review` | UX/UI review |
| 8.5 | `/oss:experiment` | A/B testing |
| 8.6 | `/oss:feature-flag` | Feature flags |
| 8.7 | `/oss:license` | License compliance |
| 8.8 | `/oss:privacy` | GDPR/CCPA audit |
| 8.9 | `/oss:retro` | Sprint retrospective |
| 8.10 | `/oss:oss` | Meta command |

## TDD Approach

For each command update:

1. **RED**: Write test that verifies `## Help` section exists and contains required fields
2. **GREEN**: Add the help section to the command markdown
3. **REFACTOR**: Ensure consistency with other commands

### Test File: `tests/help-documentation.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMMANDS_DIR = path.join(__dirname, '../commands');

const REQUIRED_HELP_FIELDS = [
  'Command:',
  'Description:',
  'Workflow Position:',
  'Usage:',
  'Options:',
  'Examples:',
  'Related Commands:'
];

describe('Command Help Documentation', () => {
  const commandFiles = fs.readdirSync(COMMANDS_DIR)
    .filter(f => f.endsWith('.md'));

  commandFiles.forEach(file => {
    const commandName = file.replace('.md', '');

    describe(`/oss:${commandName}`, () => {
      const content = fs.readFileSync(
        path.join(COMMANDS_DIR, file),
        'utf-8'
      );

      it('should have ## Help section', () => {
        expect(content).toContain('## Help');
      });

      REQUIRED_HELP_FIELDS.forEach(field => {
        it(`should have ${field} in help section`, () => {
          const helpSection = content.split('## Help')[1]?.split('---')[0];
          expect(helpSection).toContain(field);
        });
      });

      it('should document --help flag', () => {
        expect(content).toMatch(/--help.*-h.*Show.*help/i);
      });

      it('should show workflow position', () => {
        expect(content).toMatch(/Workflow Position:/);
      });
    });
  });
});
```

## Acceptance Criteria

1. **Every command** has a `## Help` section
2. **--help flag** is documented in all commands
3. **Workflow position** is clearly indicated
4. **Related commands** show what comes before/after
5. **Examples** show common usage patterns
6. **Options table** lists all flags with descriptions
7. **Consistent format** across all 53 commands

## Workflow Diagram (for reference)

```
┌─────────────────────────────────────────────────────────────────┐
│                    OSS DEV WORKFLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  IDEATION PHASE                                                  │
│  ┌──────────┐                                                    │
│  │ /ideate  │ ──→ Transform ideas into requirements             │
│  └────┬─────┘                                                    │
│       ↓                                                          │
│  ┌────────────────┐  ┌────────────┐  ┌──────────────┐           │
│  │ /requirements  │→ │ /api-design│→ │ /data-model  │           │
│  └────────────────┘  └────────────┘  └──────────────┘           │
│       ↓                                                          │
│  ┌─────────┐                                                     │
│  │  /adr   │ ──→ Record architecture decisions                  │
│  └────┬────┘                                                     │
│       ↓                                                          │
│  PLANNING PHASE                                                  │
│  ┌─────────┐                                                     │
│  │  /plan  │ ──→ Create TDD implementation plan                 │
│  └────┬────┘                                                     │
│       ↓                                                          │
│  BUILD PHASE (TDD Cycle)                                        │
│  ┌─────────────┐                                                │
│  │ /acceptance │ ──→ System boundary tests FIRST                │
│  └──────┬──────┘                                                │
│         ↓                                                        │
│  ┌──────────────────────────────────────────────┐               │
│  │              /build (TDD Loop)                │               │
│  │  ┌───────┐   ┌────────┐   ┌───────────┐     │               │
│  │  │ /red  │ → │ /green │ → │ /refactor │ ──┐ │               │
│  │  └───────┘   └────────┘   └───────────┘   │ │               │
│  │       ↑                                   │ │               │
│  │       └───────────────────────────────────┘ │               │
│  └──────────────────────┬───────────────────────┘               │
│                         ↓                                        │
│  ┌─────────────┐                                                │
│  │ /integration│ ──→ Validate mocks match reality               │
│  └──────┬──────┘                                                │
│         ↓                                                        │
│  QUALITY PHASE                                                  │
│  ┌────────┐ ┌───────┐ ┌───────┐ ┌───────┐                      │
│  │ /test  │ │/review│ │/audit │ │/bench │                      │
│  └────────┘ └───────┘ └───────┘ └───────┘                      │
│         ↓                                                        │
│  SHIPPING PHASE                                                 │
│  ┌─────────┐                                                    │
│  │  /ship  │ ──→ Quality gates + Commit + PR + Merge           │
│  └────┬────┘                                                    │
│       ↓                                                          │
│  DEPLOYMENT PHASE                                               │
│  ┌─────────┐   ┌─────────┐   ┌──────────┐                      │
│  │ /stage  │ → │ /deploy │ → │ /release │                      │
│  └─────────┘   └─────────┘   └──────────┘                      │
│       ↓                                                          │
│  ┌─────────┐                                                    │
│  │ /smoke  │ ──→ Post-deployment validation                     │
│  └────┬────┘                                                    │
│       ↓                                                          │
│  OPERATIONS PHASE                                               │
│  ┌─────────┐   ┌───────────┐   ┌───────────┐                   │
│  │/monitor │   │ /incident │   │ /rollback │                   │
│  └─────────┘   └───────────┘   └───────────┘                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Notes

1. **Repository**: Changes are in `one-shot-ship-plugin` (`/Users/ysl/dev/one-shot-ship-plugin`)
2. **Files to modify**: All 53 `commands/*.md` files
3. **Test location**: `tests/help-documentation.test.ts`
4. **No API changes needed**: Help is markdown, served as-is

## Estimated Effort

- **Phase 1 (Core)**: 4 commands - Foundation
- **Phase 2 (TDD)**: 6 commands
- **Phase 3 (Design)**: 5 commands
- **Phase 4 (Quality)**: 7 commands
- **Phase 5 (Deploy)**: 4 commands
- **Phase 6 (Ops)**: 6 commands
- **Phase 7 (Utility)**: 10 commands
- **Phase 8 (Specialized)**: 10 commands + deprecated

**Total**: 53 commands to update

## Success Criteria

1. Run `/oss:cmd --help` and see comprehensive help for any command
2. User understands what each command does without reading docs
3. User knows which command to run next in the workflow
4. All tests pass verifying help section completeness
