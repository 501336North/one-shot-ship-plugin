---
description: Multi-perspective code review (correctness, security, performance, maintainability)
estimated_tokens: 3000-10000
---

## Help

**Command:** `/oss:review`

**Description:** Multi-perspective code review (correctness, security, performance, maintainability)

**Workflow Position:** build -> **REVIEW** -> ship

**Usage:**
```bash
/oss:review [OPTIONS] [FILE_PATH]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `FILE_PATH` | No | Specific file or directory to review |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--focus` | | Focus area: security, performance, correctness, maintainability |

**Examples:**
```bash
# Review all staged changes
/oss:review

# Review a specific file
/oss:review src/services/auth.ts

# Focus on security review
/oss:review --focus security
```

**Related Commands:**
- `/oss:build` - Build phase that precedes review
- `/oss:ship` - Ship after review passes
- `/oss:audit` - Deep security audit
- `/oss:tech-debt` - Technical debt analysis

---

# /oss:review - Code Review

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
~/.oss/hooks/oss-log.sh init review
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow review start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name review
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

Execute the code review prompt.

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success:
```bash
~/.oss/hooks/oss-notify.sh --workflow review complete '{}'
```

On failure:
```bash
~/.oss/hooks/oss-notify.sh --workflow review failed '{"error": "{ERROR_MESSAGE}"}'
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
/oss:review
/oss:review src/services/auth.ts
/oss:review --focus security
```
