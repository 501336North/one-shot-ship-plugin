---
description: Design API contracts before implementation (Outside-In starting point)
---

## Help

**Command:** `/oss:api-design`

**Description:** Design API contracts before implementation (Outside-In starting point)

**Workflow Position:** ideate -> requirements -> **API-DESIGN** -> data-model -> plan

**Usage:**
```bash
/oss:api-design [OPTIONS] <DESCRIPTION>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `DESCRIPTION` | Yes | Description of the API endpoints to design |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--resource` | | Specify the resource name (e.g., users) |
| `--operations` | | Specify operations (e.g., crud, read, write) |

**Examples:**
```bash
# Design authentication endpoints
/oss:api-design user authentication endpoints

# Design CRUD operations for a resource
/oss:api-design --resource users --operations crud
```

**Related Commands:**
- `/oss:requirements` - Extract requirements before API design
- `/oss:data-model` - Design data schemas after API design
- `/oss:contract` - Create contract tests for the API
- `/oss:acceptance` - Write acceptance tests for API endpoints

---

# /oss:api-design - Design API Contracts

Design API contracts as the starting point for Outside-In development.

## What This Command Does

1. **Defines endpoints** - RESTful or GraphQL contract
2. **Specifies request/response** - Schema definitions
3. **Documents errors** - Error codes and messages
4. **Creates OpenAPI spec** - Machine-readable contract

## Why API-First (Outside-In)

Starting with API design:
- Defines the system boundary clearly
- Enables frontend/backend parallel work
- Creates testable contract before implementation
- Drives interface discovery through mocks

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init api-design
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow api-design start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/api-design
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Identifying resources and operations
- Designing RESTful endpoints
- Defining request/response schemas
- Documenting error responses
- Generating OpenAPI specification

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (API design complete):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow api-design complete '{"endpointsDesigned": {COUNT}, "specFile": "{SPEC_FILE}"}'
```

On failure (couldn't complete API design):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow api-design failed '{"reason": "{REASON}"}'
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
/oss:api-design user authentication endpoints
/oss:api-design --resource users --operations crud
```
