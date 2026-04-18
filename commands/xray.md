---
description: Comprehensive codebase risk triage — severity-rated findings across security, performance, architecture, dependencies, and points of interest
---

## Help

**Command:** `/oss:xray`

**Description:** Codebase risk triage — scan for security vulnerabilities, performance issues, architectural risks, dependency problems, and points of interest. Severity-rated findings with suggested fix tasks.

**Workflow Position:** onboard → **XRAY** → ideate → plan → build → ship

**Usage:**
```bash
/oss:xray [OPTIONS]
```

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Run full codebase risk triage
/oss:xray

# Show help
/oss:xray --help
```

**Related Commands:**
- `/oss:onboard` - Run before for smarter context-aware analysis
- `/oss:audit` - Deep security-specific audit (narrower scope)
- `/oss:tech-debt` - Ongoing technical debt tracking
- `/oss:plan` - Create fix plan from xray findings

---

# /oss:xray - Codebase Risk Triage

Comprehensive codebase risk scanner. One scan, full assessment.

## What This Command Does

1. **Assesses scope** - Counts scannable files, warns on large codebases
2. **Launches 5 agents** - Parallel scan across all risk categories
3. **Aggregates findings** - Severity-rated, deduplicated, ranked
4. **Generates report** - XRAY-{date}.md with executive summary and fix tasks
5. **Tracks progress** - Re-run shows what changed since last scan

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
~/.oss/hooks/oss-log.sh init xray
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow xray start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name xray
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt orchestrates the full xray scan:
- Scope assessment and large codebase warning
- 5-agent parallel swarm (one per risk category)
- Finding aggregation and severity ranking
- Report generation with executive summary
- Previous scan diff (if re-running)

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After scan completes:
```bash
~/.oss/hooks/oss-notify.sh --workflow xray complete '{"findings": {TOTAL}, "critical": {N}, "high": {N}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If scan fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow xray failed '{"reason": "{REASON}"}'
```

## Step 8: Execute Chain Commands (MANDATORY)

After `oss-notify.sh --workflow xray complete` runs, its stdout may contain a `---CHAIN_COMMANDS---` block. If present, **auto-execute each `CHAIN:` line in order** — no user intervention required.

**Parsing rules:**
- `CHAIN: /oss:<command> (...)` → invoke Skill tool: `skill: "oss:<command>"`
- `CHAIN: /oss:oss-custom <name> (...)` → invoke Skill tool: `skill: "oss:oss-custom"`, `args: "<name>"`

**Behavior:**
- Execute in order, one at a time
- Each chain command runs with full logging and status updates
- If a blocking chain command fails, stop the chain and report the failure
- If no `---CHAIN_COMMANDS---` block appears, skip this step
- Log each: `~/.oss/hooks/oss-log.sh write xray "[CHAIN] executing /oss:<command>"`

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
# Run full codebase risk triage
/oss:xray
```

## Output

Generates `XRAY-{date}.md` with:
- Executive summary (overall risk, finding counts, top concern, quick wins)
- Findings by severity (CRITICAL → HIGH → MEDIUM → LOW)
- Findings by category matrix
- What Changed section (if re-running)
- Suggested fix tasks (TDD-ready)
