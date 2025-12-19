---
description: Transform vague ideas into concrete, actionable designs through collaborative questioning
---

# /oss:ideate - Extract Requirements

Transform vague ideas into concrete, actionable designs through Socratic questioning.

## Context Management

> **🚦 Context Gate Active**
>
> If conversation history exceeds 20 turns, this command will be **blocked**.
> You must either:
> 1. Run `/clear` first, then re-run (recommended)
> 2. Use `--force` flag to bypass: `/oss:ideate --force`
>
> Why? Fresh context = CLAUDE.md (with IRON LAWS) as primary guidance = deterministic results.

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init ideate
```

## Step 4: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Send Start Notification

**You MUST execute this notification command before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ideate start '{"idea": "{USER_IDEA}"}'
```

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name ideate
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

Execute the prompt returned by the API to guide the user through ideation.

## Step 7: Send Completion Notification

**You MUST execute the appropriate notification command.**

After ideation is complete:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ideate complete '{"requirementsCount": {COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If ideation fails:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ideate failed '{"reason": "{REASON}"}'
```

## Command Chain (after ideation complete)

After ideation is complete, execute these commands in sequence:
1. `/oss:requirements` - Extract user stories, acceptance criteria
2. `/oss:api-design` - Design API contracts (if applicable)
3. `/oss:data-model` - Design database schema (if applicable)
4. `/oss:adr` - Record architecture decisions
5. `/oss:plan` - Create TDD implementation plan

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
