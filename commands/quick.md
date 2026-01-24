---
description: Execute ad-hoc tasks with TDD guarantees but skip optional workflow steps
estimated_tokens: 3000-8000
---

## Help

**Command:** `/oss:quick`

**Description:** Fast-path for bug fixes, config changes, or simple features. Maintains TDD discipline while skipping research and verification agents.

**Workflow Position:** standalone - **QUICK** mode

**Usage:**
```bash
/oss:quick [OPTIONS] [DESCRIPTION]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `DESCRIPTION` | No | Task description (will prompt if not provided) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--no-commit` | | Skip automatic commits (staging only) |

**Examples:**
```bash
# Quick task with description
/oss:quick "Add dark mode toggle"

# Quick task (will prompt for description)
/oss:quick

# Quick task without auto-commit
/oss:quick --no-commit "Fix typo in README"

# Show help
/oss:quick --help
```

**Related Commands:**
- `/oss:build` - Full workflow with research and verification (more thorough)
- `/oss:iterate` - Refine existing features when scope changes
- `/oss:debug` - Systematic debugging for bugs/errors
- `/oss:ship` - Quality check and create PR after quick tasks

---

# /oss:quick - Fast Track TDD

Execute ad-hoc tasks with TDD guarantees but skip optional workflow steps.

## What This Command Does

1. **Accepts task** - Takes description or prompts for one
2. **Generates plan** - Creates 1-3 focused TDD tasks (no research phase)
3. **Executes with TDD** - RED-GREEN-REFACTOR for each task
4. **Commits atomically** - One commit per completed task
5. **Creates summary** - Documents what was done

## Key Differences from Full Workflow

| Aspect | `/oss:quick` | `/oss:build` |
|--------|--------------|--------------|
| Research agents | Skipped | Spawned |
| Plan checker | Skipped | Runs |
| Post verifier | Skipped | Runs |
| Storage location | `.oss/dev/quick/` | `.oss/dev/active/` |
| Tracking | STATE.md table | ROADMAP.md |
| Typical tasks | 1-3 | 5-20+ |

## Step 0: Check for --help Flag

If `--help` or `-h` is passed, display usage information and exit:

```
/oss:quick - Execute ad-hoc tasks with TDD guarantees

USAGE:
  /oss:quick [DESCRIPTION]    Execute quick task with TDD
  /oss:quick --help           Display this help message

ARGUMENTS:
  DESCRIPTION    Task description (will prompt if not provided)

OPTIONS:
  --help, -h        Show this help message
  --no-commit       Skip automatic commits (staging only)

EXAMPLES:
  /oss:quick "Add dark mode toggle"
  /oss:quick "Fix login button alignment"
  /oss:quick --no-commit "Update dependencies"

QUICK TASK STORAGE:
  .oss/dev/quick/{NNN}-{slug}/
    {NNN}-PLAN.md      Minimal TDD plan (1-3 tasks)
    {NNN}-SUMMARY.md   Completion summary

STATE TRACKING:
  Updates "Quick Tasks Completed" table in STATE.md

TDD REQUIREMENTS (Still Enforced):
  - Each task must have test requirements
  - RED-GREEN-REFACTOR cycle for every task
  - Tests must pass before committing
  - Atomic commits per task

WHEN TO USE:
  - Bug fixes
  - Config changes
  - Small features
  - Documentation updates
  - Dependency updates

WHEN NOT TO USE:
  - Complex multi-component features (use /oss:plan + /oss:build)
  - Features requiring design decisions (use /oss:ideate first)
  - Changes touching 5+ files (use full workflow)
```

**If --help is detected, output the above and do not proceed.**

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init quick
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All IRON LAW violations must be self-corrected before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow quick start '{"description": "{TASK_DESCRIPTION}"}'
```

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name quick
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

Execute the prompt returned by the API. The proprietary prompt contains:
- Task description parsing or prompting
- Slug generation and numbering
- Directory creation in `.oss/dev/quick/`
- Minimal plan generation (1-3 tasks)
- TDD execution with RED-GREEN-REFACTOR
- Atomic commit creation
- Summary generation
- STATE.md update

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After quick task is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow quick complete '{"taskId": "{NNN}", "commits": {COMMIT_COUNT}, "testsAdded": {TEST_COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If quick task fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow quick failed '{"taskId": "{NNN}", "reason": "{REASON}"}'
```

## Directory Structure

Quick tasks are stored separately from main workflow:

```
.oss/dev/quick/
├── 001-add-dark-mode-toggle/
│   ├── 001-PLAN.md
│   └── 001-SUMMARY.md
├── 002-fix-login-alignment/
│   ├── 002-PLAN.md
│   └── 002-SUMMARY.md
└── 003-update-readme/
    ├── 003-PLAN.md
    └── 003-SUMMARY.md
```

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss:login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Quality Gates (Enforced)

Despite being "quick", TDD discipline is non-negotiable:

- No production code without failing test first
- All tests must pass before each commit
- Atomic commits per task
- Branch safety (never commit to main)

## Example Usage

```bash
# Simple bug fix
/oss:quick "Fix null pointer in user service"

# Config change
/oss:quick "Add rate limiting config"

# Small feature
/oss:quick "Add copy-to-clipboard button"

# Documentation
/oss:quick "Update API docs for new endpoint"
```

## When Quick Mode is NOT Appropriate

Use full workflow (`/oss:plan` + `/oss:build`) when:

- Feature touches 5+ files
- Multiple components need coordination
- Design decisions are unclear
- Feature requires user research
- Changes affect public API
- Security-sensitive changes
