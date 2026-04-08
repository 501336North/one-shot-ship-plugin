---
description: Run the full ideate→plan→build→ship pipeline in one go, stopping only for interactive ideation Q&A
model: opus
estimated_tokens: 15000-50000
---

## Help

**Command:** `/oss:auto`

**Description:** Run the full pipeline (ideate→plan→build→ship) in one command. Interactive during ideation, fully autonomous after.

**Workflow Position:** **IDEATE → PLAN → BUILD → SHIP** (all in one)

**Usage:**
```bash
/oss:auto [OPTIONS] [IDEA]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `IDEA` | No | Initial idea or feature description |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--merge` | `-m` | Auto-merge PR when CI passes (passed to ship) |
| `--team` | | Enable Agent Teams mode (passed to plan and build) |

**Examples:**
```bash
# Full pipeline from idea to PR
/oss:auto "add user authentication"

# Full pipeline with auto-merge
/oss:auto --merge "redesign the pricing page"

# Show help
/oss:auto --help
```

**Related Commands:**
- `/oss:ideate` - Run ideation only (interactive)
- `/oss:plan` - Run planning only
- `/oss:build` - Run build only
- `/oss:ship` - Run ship only

---

# /oss:auto - Full Pipeline

Run the complete ideate→plan→build→ship pipeline in one command.

## What This Command Does

1. **Ideates interactively** - Socratic Q&A to refine your idea into a design
2. **Plans autonomously** - Creates TDD implementation plan
3. **Builds autonomously** - Executes plan with RED-GREEN-REFACTOR
4. **Ships autonomously** - Quality gates, commit, PR, optional merge

## Step 1: Ensure Project Configuration

```bash
~/.oss/hooks/oss-iron-laws-sync.sh
```

## Step 2: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 3: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init auto
```

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow auto start '{"idea": "{USER_IDEA}"}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name auto
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt orchestrates the full pipeline:
- Interactive ideation with Socratic questioning
- Autonomous plan→build→ship after ideation completes
- Single branch: `feat/{feature-slug}/auto`
- Passes `--merge` and `--team` flags through to child commands

## Step 8: Update Status Line (Completion)

After auto pipeline completes:
```bash
~/.oss/hooks/oss-notify.sh --workflow auto complete '{"prNumber": {PR_NUM}, "phases": 4}'
```

If auto pipeline fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow auto failed '{"phase": "{FAILED_PHASE}", "reason": "{REASON}"}'
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

### If any phase fails
```
Auto pipeline stopped at {phase}. Fix the issue and resume with:
  /oss:{phase}
```

## Example Usage

```bash
# Full pipeline from idea to PR
/oss:auto "add user authentication"

# Full pipeline with auto-merge
/oss:auto --merge "redesign the pricing page"
```
