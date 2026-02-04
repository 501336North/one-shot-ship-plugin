---
description: Analyze existing codebase and generate development documentation
estimated_tokens: 3000-8000
---

## Help

**Command:** `/oss:onboard`

**Description:** Analyze an existing codebase and generate development documentation that captures architecture, patterns, and conventions.

**Workflow Position:** **ONBOARD** → ideate → plan → build → ship (run once per project)

**Usage:**
```bash
/oss:onboard [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | - | Analyzes the current directory |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--force` | `-f` | Regenerate docs even if already onboarded |

**Examples:**
```bash
# Onboard the current project
/oss:onboard

# Force regenerate documentation
/oss:onboard --force

# Show help
/oss:onboard --help
```

**Related Commands:**
- `/oss:ideate` - Design features (uses generated docs for context)
- `/oss:plan` - Create TDD plans (uses generated docs for context)
- `/oss:tech-debt` - Identify technical debt (uses generated docs)

**Generated Output:**
```
.oss/
├── docs/
│   ├── ARCHITECTURE.md      # System overview, patterns
│   ├── DATA_MODEL.md        # Entities, relationships
│   ├── API_CONTRACTS.md     # Endpoints, shapes
│   ├── CONVENTIONS.md       # Coding standards detected
│   └── TECH_STACK.md        # Dependencies, versions
└── context/
    └── project-summary.json # Machine-readable for agents
```

---

# /oss:onboard - Analyze Existing Codebase

Analyze an existing codebase and generate comprehensive development documentation.

## What This Command Does

1. **Detects project type** - Identifies languages, frameworks, and tools
2. **Analyzes architecture** - Maps components, patterns, and data flow
3. **Documents conventions** - Captures naming, structure, and coding patterns
4. **Generates documentation** - Creates 5 markdown files + JSON summary

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
~/.oss/hooks/oss-log.sh init onboard
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow onboard start '{}'
```

## Step 5: Check if Already Onboarded

```bash
~/.oss/hooks/oss-onboard-check.sh .
```

**If returns "onboarded" and --force not specified:**
```
Project already onboarded. Use --force to regenerate documentation.
Existing docs at: .oss/docs/
```

## Step 6: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 7: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name onboard
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 8: Execute the Fetched Prompt

The prompt guides codebase analysis with:
- Project structure analysis
- Tech stack detection
- Architecture pattern recognition
- Data model documentation
- Convention capture
- API surface mapping
- Test coverage assessment

## Step 9: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After onboarding is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow onboard complete '{"docsGenerated": 5, "projectType": "{TYPE}"}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If onboarding fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow onboard failed '{"error": "{REASON}"}'
```

## Command Orchestration

After this command completes, the workflow engine will:
1. Store generated documentation for use by subsequent commands
2. Update the session context with project information
3. Mark the project as "onboarded" in .oss/context/

Your team's workflow config controls:
- `chains_to`: Which commands run next (typically none for onboard)
- `checkpoint`: Whether to pause for human review (human/auto)

To customize your workflow, visit the dashboard at https://www.oneshotship.com/dashboard/workflows

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

### If detection fails
```
Could not detect project type. This may be a very unusual project structure.
Consider running /oss:ideate to describe your project manually.
```

## Example Usage

```bash
# Onboard an existing project
/oss:onboard

# Force regenerate documentation
/oss:onboard --force
```

## Flags

- `--force` - Regenerate docs even if `.oss/docs/` already exists

## Important Notes

- This is an analysis command - it does NOT modify your code
- Run once per project (subsequent runs require --force)
- Generated docs are stored in `.oss/docs/` (add to .gitignore if preferred)
- Machine-readable context in `.oss/context/project-summary.json`
- Subsequent `/oss:*` commands automatically use generated context
