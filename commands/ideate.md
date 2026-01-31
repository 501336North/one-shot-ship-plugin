---
description: Transform vague ideas into concrete, actionable designs through collaborative questioning
estimated_tokens: 2000-8000
---

## Help

**Command:** `/oss:ideate`

**Description:** Transform vague ideas into concrete, actionable designs through Socratic questioning.

**Workflow Position:** **IDEATE** → plan → build → ship

**Usage:**
```bash
/oss:ideate [OPTIONS] [IDEA]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `IDEA` | No | Initial idea or feature description to explore |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Start ideation for a new feature
/oss:ideate "user authentication system"

# Ideate without a specific topic (will ask what you want to build)
/oss:ideate

# Show help
/oss:ideate --help
```

**Related Commands:**
- `/oss:requirements` - Extract user stories and acceptance criteria from ideation output
- `/oss:plan` - Create TDD implementation plan from requirements
- `/oss:api-design` - Design API contracts (if applicable)
- `/oss:data-model` - Design database schema (if applicable)

**Domain Detection:**
The command automatically detects what you're building and asks targeted questions:
- **UI Domain**: Accessibility, responsive design, component library, animations
- **API Domain**: Authentication, rate limiting, versioning, error formats
- **CLI Domain**: Argument parsing, output format, interactive mode, config files
- **Data Domain**: Persistence, migrations, backups, retention policies
- **Auth Domain**: Session vs tokens, MFA, password policies, OAuth providers

---

# /oss:ideate - Extract Requirements

Transform vague ideas into concrete, actionable designs through Socratic questioning.

## What This Command Does

1. **Clarifies your idea** - Asks probing questions to understand what you really want
2. **Explores edge cases** - Identifies scenarios you might have missed
3. **Defines scope** - Helps you decide what's in and out of scope
4. **Creates actionable output** - Produces a clear requirements document

## Step 1: Ensure Project Configuration

**Check if CLAUDE.md exists:**

```bash
test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
```

**If MISSING, create minimal project configuration:**

```bash
cat > CLAUDE.md << 'EOF'
# Project Development Guide

This project uses OSS Dev Workflow for world-class software delivery.

## Development Commands

- `/oss:ideate` - Design and plan features
- `/oss:plan` - Create TDD implementation plans
- `/oss:build` - Execute plans with TDD
- `/oss:ship` - Quality check, commit, PR

## Agent Delegation (MANDATORY)

**ALWAYS delegate specialized work to the appropriate agent using the Task tool.**

When implementing code, use these specialized agents:

| Technology | Agent (`subagent_type`) |
|------------|-------------------------|
| React/Next.js | `nextjs-developer`, `react-specialist` |
| TypeScript | `typescript-pro` |
| Python | `python-pro` |
| Go | `golang-pro` |
| iOS/Swift | `ios-developer`, `swift-macos-expert` |
| visionOS | `visionos-developer` |
| Backend | `backend-architect` |
| Database | `database-optimizer` |
| Testing | `test-engineer`, `qa-expert` |
| Security | `security-auditor` |
| DevOps | `deployment-engineer` |
| Code Review | `code-reviewer` |

**Never write specialized code yourself when an agent exists for it.**

## Quality Standards

- All code changes require tests written FIRST (TDD)
- All tests must pass before commits
- All PRs require CI checks to pass
- Delegate to specialized agents for domain expertise

---

*Powered by [OSS Dev Workflow](https://www.oneshotship.com)*
EOF
```

## Step 2: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 3: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init ideate
```

## Step 4: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 5: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow ideate start '{"idea": "{USER_IDEA}"}'
```

## Step 6: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 7: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name ideate
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 8: Execute the Fetched Prompt

Execute the prompt returned by the API. The proprietary prompt contains:
- Idea analysis and clarification
- **Domain detection** (UI, API, CLI, Data, Auth) based on keywords
- **Domain-specific gray area questions** (4 deep questions per detected domain)
- Edge case exploration
- Scope definition (in/out)
- DESIGN.md creation with decisions
- CONTEXT.md creation with domain-specific decisions

## Step 9: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After ideation is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow ideate complete '{"requirementsCount": {COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If ideation fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow ideate failed '{"reason": "{REASON}"}'
```

## Command Orchestration

After this command completes, the workflow engine will:
1. Evaluate conditions from your team's workflow config (fetched from the API)
2. Execute the next commands in the chain based on those conditions
3. Spawn any configured agents for additional processing
4. Stop at checkpoints for human review (if configured)

Your team's workflow config controls:
- `chains_to`: Which commands run next (e.g., requirements, api-design, data-model, adr)
- `agents`: Which agents to spawn (e.g., code-simplifier, frontend-design)
- `checkpoint`: Whether to pause for human review (human/auto)

Conditions like `has_api_work`, `has_db_work`, and `has_ui_work` are evaluated automatically
based on the design content and changed files.

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

## Example Usage

```bash
# Start ideation for a new feature
/oss:ideate "user authentication system"

# Ideate without a specific topic (will ask what you want to build)
/oss:ideate
```
