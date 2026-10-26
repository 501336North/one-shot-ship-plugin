---
name: ship
description: Quality check, commit, create PR, and optionally merge. Use for finalizing work.
---

# OSS Ship

Complete finalization workflow - quality check, docs, commit, PR.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type workflows --name ship
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates:
- Final quality checks (tests, lint, build)
- Documentation updates
- Git commit with proper message
- Pull request creation
- Optional auto-merge (with --merge flag)

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
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

```
/oss ship
/oss ship --merge
```

Finalizes work with quality gates and creates PR.
