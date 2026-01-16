---
description: Extract user stories and acceptance criteria from ideas
---

## Help

**Command:** `/oss:requirements`

**Description:** Extract user stories and acceptance criteria from ideas

**Workflow Position:** ideate -> **REQUIREMENTS** -> api-design -> plan

**Usage:**
```bash
/oss:requirements [OPTIONS] <IDEA>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `IDEA` | Yes | The idea, PRD, or feature description to analyze |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--from` | | Read input from a file (e.g., prd.md) |

**Examples:**
```bash
# Extract requirements from a text description
/oss:requirements "users should be able to share files with each other"

# Extract requirements from a PRD file
/oss:requirements --from prd.md
```

**Related Commands:**
- `/oss:ideate` - Transform vague ideas into concrete designs (precedes requirements)
- `/oss:api-design` - Design API contracts from requirements
- `/oss:plan` - Create TDD implementation plan from requirements

---

# /oss:requirements - Extract Requirements

Transform vague ideas into structured user stories with acceptance criteria.

## What This Command Does

1. **Analyzes input** - Parses ideas, PRDs, or feature descriptions
2. **Extracts user stories** - Who/What/Why format
3. **Defines acceptance criteria** - Testable conditions
4. **Identifies edge cases** - Error scenarios, boundary conditions

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
~/.oss/hooks/oss-log.sh init requirements
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow requirements start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/requirements
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Parsing input for key requirements
- Creating user stories in standard format
- Defining testable acceptance criteria
- Documenting edge cases and error scenarios

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (requirements extracted):
```bash
~/.oss/hooks/oss-notify.sh --workflow requirements complete '{"storiesCount": {COUNT}, "criteriaCount": {CRITERIA}}'
```

On failure (couldn't extract requirements):
```bash
~/.oss/hooks/oss-notify.sh --workflow requirements failed '{"reason": "{REASON}"}'
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

## Example Usage

```bash
/oss:requirements "users should be able to share files with each other"
/oss:requirements --from prd.md
```
