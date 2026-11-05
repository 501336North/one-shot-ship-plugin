---
description: Multi-perspective code review (correctness, security, performance, maintainability)
model: opus
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
| `--team` | | Enable Agent Teams mode for parallel multi-perspective review (Pro+ only) |

**Examples:**
```bash
# Review all staged changes
/oss:review

# Review a specific file
/oss:review src/services/auth.ts

# Focus on security review
/oss:review --focus security

# Review with Agent Teams (parallel reviewers + debate)
/oss:review --team
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
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
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

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow review start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

If `--team` flag is present in the arguments:
```bash
~/.oss/bin/oss-decrypt --type commands --name review-team
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

Otherwise (default):
```bash
~/.oss/bin/oss-decrypt --type commands --name review
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

Execute the code review prompt.

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success:
```bash
~/.oss/hooks/oss-notify.sh --workflow review complete '{}'
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
