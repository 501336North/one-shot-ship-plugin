---
description: Cloud cost analysis and optimization
---

## Help

**Command:** `/oss:cost`

**Description:** Cloud cost analysis and optimization

**Workflow Position:** any time - **COST** analysis

**Usage:**
```bash
/oss:cost [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--provider` | | Cloud provider (aws, gcp, azure) |
| `--period` | | Time period (e.g., last-30-days) |

**Examples:**
```bash
# Analyze cloud costs
/oss:cost

# Analyze AWS costs
/oss:cost --provider aws

# Analyze last 30 days
/oss:cost --period last-30-days
```

**Related Commands:**
- `/oss:monitor` - Monitor production health
- `/oss:deploy` - Deploy infrastructure
- `/oss:bench` - Performance benchmarking

---

# /oss:cost - Cost Analysis

Cloud cost analysis and FinOps optimization.

## What This Command Does

1. **Cost breakdown** - Analyze spend by service
2. **Waste detection** - Find unused resources
3. **Right-sizing** - Identify over-provisioned resources
4. **Savings opportunities** - Reserved instances, spot
5. **Budget alerts** - Cost anomaly detection

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
~/.oss/hooks/oss-log.sh init cost
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow cost start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name cost
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Cloud cost analysis
- Resource optimization recommendations
- Savings calculation
- Budget monitoring setup

## Step 7: Update Status Line (Completion)

On success only. If the command failed (the prompt sent `failed`), do not send `complete`.

**You MUST update the workflow status on completion.**

```bash
~/.oss/hooks/oss-notify.sh --workflow cost complete '{}'
```

## Example Usage

```bash
/oss:cost
/oss:cost --provider aws
/oss:cost --period last-30-days
```
