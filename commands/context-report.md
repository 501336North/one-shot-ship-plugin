---
description: Generate build context report answering what changed, why, and what it affects
model: haiku
---

## Help

**Command:** `/oss:context-report`

**Description:** Generate a build context report that answers three critical debugging questions: What changed? Why was it built that way? What else does it affect?

**Workflow Position:** ideate → plan → build → **CONTEXT-REPORT** (auto-chained) → ship

**Usage:**
```bash
/oss:context-report
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | Auto-chained after `/oss:build` completes |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Auto-fires after /oss:build (no manual invocation needed)
/oss:context-report

# Can also be run manually to generate a report for current changes
/oss:context-report
```

**Related Commands:**
- `/oss:build` - Chains to this command on completion
- `/oss:ship` - Finalizes the draft report with commit SHA and PR number
- `/oss:debug` - Loads reports as context before investigating

---

# /oss:context-report - Generate Build Context Report

Auto-generate a structured report documenting what was built, why, and what it affects.

## What This Command Does

1. **Reads dev docs** - DESIGN.md, DECISIONS.md, PROGRESS.md
2. **Analyzes git diff** - Files modified, tests added, DB changes
3. **Scans import graph** - Downstream consumers of changed files
4. **Writes report** - `.oss/reports/builds/YYYY-MM-DDTHH-MM-{feature}.md`

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
~/.oss/hooks/oss-log.sh init context-report
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow context-report start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name context-report
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt generates a build context report from local data sources (git diff, dev docs, import graph) and writes it to `.oss/reports/builds/`.

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

```bash
~/.oss/hooks/oss-notify.sh --workflow context-report complete '{}'
```

If report generation fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow context-report failed '{}'
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
