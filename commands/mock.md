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
~/.oss/hooks/oss-log.sh init mock
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
~/.oss/hooks/oss-notify.sh --workflow mock start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name mock
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt guides you through:
- Identifying interfaces to mock
- Generating type-safe mocks
- Adding verification support
- Creating test fixtures

## Step 8: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success:
```bash
~/.oss/hooks/oss-notify.sh --workflow mock complete '{"mocksCreated": {COUNT}}'
```

On failure:
```bash
~/.oss/hooks/oss-notify.sh --workflow mock failed '{"reason": "{REASON}"}'
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
