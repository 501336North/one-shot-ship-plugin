---
description: Compare built UI against Figma design specs for pixel-perfect implementation
estimated_tokens: 2000-6000
---

## Help

**Command:** `/oss:visual-qa`

**Description:** Compare built output against Figma design specifications and generate a discrepancy report.

**Workflow Position:** build → **VISUAL-QA** → ship

**Usage:**
```bash
/oss:visual-qa [OPTIONS] [PATH]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `PATH` | No | Path to built components to compare |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--strictness` | | Override strictness level (strict/standard/relaxed) |

**Examples:**
```bash
# Run visual QA on entire project
/oss:visual-qa

# Compare specific components
/oss:visual-qa src/components/Dashboard/

# Use strict mode (blocking discrepancies prevent ship)
/oss:visual-qa --strictness strict
```

**Related Commands:**
- `/oss:ideate --figma` - Ideate with Figma designs (creates the Figma context)
- `/oss:design-review` - General UX/UI design review
- `/oss:ship` - Ship phase (runs visual QA automatically if Figma context exists)

---

# /oss:visual-qa - Visual QA

Compare built output against Figma design specifications.

## What This Command Does

1. **Detects Figma context** - Checks DESIGN.md and workflow state for Figma metadata
2. **Compares specs** - Delegates to figma-design-agent for design comparison
3. **Generates report** - Creates VISUAL_QA.md with discrepancies and recommendations
4. **Enforces strictness** - Blocking/warning/info based on configured strictness level

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
~/.oss/hooks/oss-log.sh init visual-qa
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow visual-qa start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name visual-qa
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

Execute the prompt returned by the API. The proprietary prompt contains:
- Figma context detection and validation
- Spec comparison via figma-design-agent
- VISUAL_QA.md report generation with discrepancies
- Strictness enforcement (strict/standard/relaxed)

## Step 8: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After visual QA is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow visual-qa complete '{"discrepancies": {COUNT}, "blocking": {BLOCKING_COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If visual QA fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow visual-qa failed '{"reason": "{REASON}"}'
```

## Step 9: Execute Chain Commands (MANDATORY)

After `oss-notify.sh --workflow visual-qa complete` runs, its stdout may contain a `---CHAIN_COMMANDS---` block. If present, **auto-execute each `CHAIN:` line in order** — no user intervention required.

**Parsing rules:**
- `CHAIN: /oss:<command> (...)` → invoke Skill tool: `skill: "oss:<command>"`
- `CHAIN: /oss:oss-custom <name> (...)` → invoke Skill tool: `skill: "oss:oss-custom"`, `args: "<name>"`

**Behavior:**
- Execute in order, one at a time
- Each chain command runs with full logging and status updates
- If a blocking chain command fails, stop the chain and report the failure
- If no `---CHAIN_COMMANDS---` block appears, skip this step
- Log each: `~/.oss/hooks/oss-log.sh write visual-qa "[CHAIN] executing /oss:<command>"`

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
# Run visual QA
/oss:visual-qa

# Compare specific component path
/oss:visual-qa src/components/Header/

# Use strict mode
/oss:visual-qa --strictness strict
```
