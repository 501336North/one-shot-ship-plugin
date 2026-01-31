---
description: Create Architecture Decision Records
---

## Help

**Command:** `/oss:adr`

**Description:** Create Architecture Decision Records

**Workflow Position:** any time - **ADR** (Architecture Decision Records)

**Usage:**
```bash
/oss:adr [OPTIONS] <DECISION>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `DECISION` | Yes | The architectural decision to document |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--title` | | Title for the ADR |
| `--decision` | | The chosen approach |

**Examples:**
```bash
# Create an ADR with a description
/oss:adr "Use London TDD for all new development"

# Create an ADR with explicit title and decision
/oss:adr --title "Database selection" --decision "PostgreSQL"
```

**Related Commands:**
- `/oss:api-design` - Document API design decisions
- `/oss:data-model` - Document data model decisions
- `/oss:plan` - Reference ADRs in implementation plans

---

# /oss:adr - Architecture Decision Records

Document architectural decisions with context, options, and rationale.

## What This Command Does

1. **Captures context** - Why the decision is needed
2. **Lists options** - Alternatives considered
3. **Documents decision** - Chosen approach and why
4. **Records consequences** - Trade-offs and implications

## ADR Format

Standard ADR structure:
- **Title**: Short descriptive name
- **Status**: Proposed, Accepted, Deprecated, Superseded
- **Context**: What prompted this decision
- **Decision**: What we decided to do
- **Consequences**: What this means going forward

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
~/.oss/hooks/oss-log.sh init adr
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
~/.oss/hooks/oss-notify.sh --workflow adr start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name adr
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt guides you through:
- Describing the decision context
- Listing options considered
- Documenting the chosen approach
- Recording trade-offs and consequences
- Creating ADR file in standard format

## Step 8: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (ADR created):
```bash
~/.oss/hooks/oss-notify.sh --workflow adr complete '{"adrNumber": {NUMBER}, "title": "{TITLE}"}'
```

On failure (couldn't create ADR):
```bash
~/.oss/hooks/oss-notify.sh --workflow adr failed '{"reason": "{REASON}"}'
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
/oss:adr "Use London TDD for all new development"
/oss:adr --title "Database selection" --decision "PostgreSQL"
```
