---
description: Design data schemas and relationships
---

## Help

**Command:** `/oss:data-model`

**Description:** Design data schemas and relationships

**Workflow Position:** ideate -> requirements -> api-design -> **DATA-MODEL** -> plan

**Usage:**
```bash
/oss:data-model [OPTIONS] <DESCRIPTION>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `DESCRIPTION` | Yes | Description of the data model to design |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--entities` | | Comma-separated list of entity names |

**Examples:**
```bash
# Design a data model for a system
/oss:data-model user management system

# Design specific entities
/oss:data-model --entities User,Order,Product
```

**Related Commands:**
- `/oss:api-design` - Design API contracts before data model
- `/oss:plan` - Create TDD implementation plan
- `/oss:adr` - Document data model decisions

---

# /oss:data-model - Design Data Model

Design data schemas and entity relationships before implementation.

## What This Command Does

1. **Identifies entities** - Core domain objects
2. **Defines attributes** - Fields and types
3. **Maps relationships** - Foreign keys, associations
4. **Creates migrations** - Database schema changes

## Data Model in Outside-In TDD

Data model design happens after API design:
- API contracts define what data is needed
- Data model supports the API requirements
- Schema drives repository interface design
- Migrations enable incremental development

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
~/.oss/hooks/oss-log.sh init data-model
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow data-model start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/data-model
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Identifying domain entities
- Defining attributes and types
- Mapping relationships
- Creating database migrations
- Generating Prisma/TypeORM schemas

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (data model designed):
```bash
~/.oss/hooks/oss-notify.sh --workflow data-model complete '{"entitiesDesigned": {COUNT}, "migrationsCreated": {MIGRATIONS}}'
```

On failure (couldn't complete data model):
```bash
~/.oss/hooks/oss-notify.sh --workflow data-model failed '{"reason": "{REASON}"}'
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
/oss:data-model user management system
/oss:data-model --entities User,Order,Product
```
