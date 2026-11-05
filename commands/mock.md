---
description: Generate type-safe mocks for collaborators (London TDD)
---

## Help

**Command:** `/oss:mock`

**Description:** Create type-safe mocks for collaborators in London TDD.

**Workflow Position:** plan → acceptance → build: [ red (uses **MOCK**) → green → refactor ] → integration → ship

**Usage:**
```bash
/oss:mock [OPTIONS] [INTERFACE]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `INTERFACE` | No | Interface or class to mock |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--type` | `-t` | Mock type: stub, mock, spy, fake |

**Examples:**
```bash
# Generate mock for a service
/oss:mock UserRepository

# Generate specific mock type
/oss:mock UserRepository --type spy

# Show help
/oss:mock --help
```

**Related Commands:**
- `/oss:red` - Uses mocks to design interfaces
- `/oss:integration` - Validates mocks match real behavior
- `/oss:contract` - Consumer-driven contract testing

---

# /oss:mock - Generate Mocks

Create type-safe mocks for collaborators in London TDD.

## What This Command Does

1. **Analyzes interfaces** - Understands what to mock
2. **Generates mocks** - Type-safe implementations
3. **Adds verification** - Support for verify() calls
4. **Adds stubbing** - Support for when().thenReturn()

## Mock Types Generated

- **Stubs** - Return canned responses
- **Mocks** - Stubs + verification
- **Spies** - Real implementation + recording
- **Fakes** - Simplified working implementations

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
~/.oss/hooks/oss-log.sh init mock
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow mock start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name mock
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt guides you through:
- Identifying interfaces to mock
- Generating type-safe mocks
- Adding verification support
- Creating test fixtures

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success:
```bash
~/.oss/hooks/oss-notify.sh --workflow mock complete '{}'
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
# Generate mock for interface
/oss:mock UserRepository

# Generate mocks for service dependencies
/oss:mock AuthService --all-deps

# Generate fake implementation
/oss:mock UserRepository --fake
```
