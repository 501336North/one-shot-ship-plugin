---
description: Create development documentation structure for a feature
model: haiku
---

## Help

**Command:** `/oss:docs`

**Description:** Create development documentation structure for a feature

**Workflow Position:** any time - **DOCS** generation

**Usage:**
```text
/oss:docs [OPTIONS] <FEATURE_NAME>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `FEATURE_NAME` | Yes | Name of the feature for documentation |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Create docs for user authentication feature
/oss:docs "user-authentication"

# Create docs for payment integration
/oss:docs "payment-integration"
```

**Related Commands:**
- `/oss:plan` - Create TDD implementation plan
- `/oss:ideate` - Transform ideas into designs
- `/oss:adr` - Create Architecture Decision Records

---

# /oss:docs - Create Dev Docs

Create a development documentation structure for feature branch + context preservation.

## What This Command Does

1. **Creates feature branch** - Creates isolated branch for development
2. **Sets up dev docs** - Creates documentation structure in `dev/active/`
3. **Preserves context** - Enables context recovery across compactions

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
~/.oss/hooks/oss-log.sh init docs
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow docs start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name docs
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Feature branch creation
- Documentation structure setup
- Context preservation configuration

## Step 7: Update Status Line (Completion)

On success only. If the command failed (the prompt sent `failed`), do not send `complete`.

**You MUST update the workflow status on completion.**

```bash
~/.oss/hooks/oss-notify.sh --workflow docs complete '{}'
```

## Example Usage

```bash
/oss:docs "user-authentication"
/oss:docs "payment-integration"
```
