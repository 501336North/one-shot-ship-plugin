---
description: Validate built features through conversational user acceptance testing
estimated_tokens: 2000-6000
---

## Help

**Command:** `/oss:verify`

**Description:** Manual verification of completed work with structured UAT flow. Presents testable deliverables one at a time and spawns debug agents on failure.

**Workflow Position:** ideate → plan → build → **VERIFY** → ship

**Usage:**
```bash
/oss:verify [OPTIONS] [PHASE]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `PHASE` | No | Phase number to verify (auto-detects from PROGRESS.md if not provided) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--feature` | `-f` | Specify feature directory name |

**Examples:**
```bash
# Verify the current phase
/oss:verify

# Verify a specific phase
/oss:verify 3

# Verify a specific feature
/oss:verify --feature auth-system

# Show help
/oss:verify --help
```

**Related Commands:**
- `/oss:build` - Execute implementation (run before verify)
- `/oss:debug` - Systematic debugging (spawned on failures)
- `/oss:ship` - Quality check and PR (run after verify passes)

---

# /oss:verify - User Acceptance Testing

Validate built features through conversational testing with persistent state.

## What This Command Does

1. **Extracts testable items** - Reads PROGRESS.md and SUMMARY.md for completed work
2. **Presents one test at a time** - "Can you [action]? Expected: [behavior]"
3. **Accepts plain text responses** - yes/y = pass, anything else = fail description
4. **Tracks results** - Creates/updates {phase}-UAT.md
5. **Auto-diagnoses failures** - Spawns debug agents to find root causes
6. **Creates fix plans** - Ready for re-execution via `/oss:build`

## Step 0: Check for --help Flag

If `--help` or `-h` is passed, display usage information and exit:

```
/oss:verify - User Acceptance Testing

USAGE:
  /oss:verify [PHASE]         Verify completed work for a phase
  /oss:verify --help          Display this help message

ARGUMENTS:
  PHASE    Phase number to verify (optional, auto-detects if not provided)

OPTIONS:
  --help, -h       Show this help message
  --feature, -f    Specify feature directory name

OUTPUT:
  {phase}-UAT.md in feature directory with test results

TEST FLOW:
  1. Extract testable deliverables from PROGRESS.md/SUMMARY.md
  2. Present ONE test at a time with expected behavior
  3. Accept plain text response (yes/y = pass, anything else = issue)
  4. Update UAT.md after each response
  5. On failure: spawn debug agent → create fix plan
  6. On complete: route to next step

RESPONSE FORMAT:
  "yes" or "y"     → Test passes, move to next
  "next" or "skip" → Skip this test
  Anything else    → Treated as failure description

EXAMPLES:
  /oss:verify              # Verify current phase
  /oss:verify 3            # Verify phase 3
  /oss:verify -f auth      # Verify auth feature
```

**If --help is detected, output the above and do not proceed.**

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
~/.oss/hooks/oss-log.sh init verify
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
~/.oss/hooks/oss-notify.sh --workflow verify start '{"phase": "{PHASE_NUMBER}"}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name verify
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

Execute the prompt returned by the API. The proprietary prompt contains:
- Active feature detection from `.oss/dev/active/`
- Testable item extraction from PROGRESS.md and completed work
- Interactive one-at-a-time test presentation
- Response handling (pass/fail/skip)
- UAT.md creation and updates
- Debug agent spawning on failures
- Fix plan generation for failed tests

## Step 8: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After verification is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow verify complete '{"passed": {PASS_COUNT}, "failed": {FAIL_COUNT}, "skipped": {SKIP_COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If verification has failures:
```bash
~/.oss/hooks/oss-notify.sh --workflow verify issues_found '{"failCount": {FAIL_COUNT}, "fixPlanReady": true}'
```

## UAT Document Format

The command creates `{phase}-UAT.md` in the feature directory:

```markdown
# User Acceptance Testing: Phase {N}

## Test Results

| # | Test | Expected | Result | Notes |
|---|------|----------|--------|-------|
| 1 | Login with email | Dashboard shown | ✅ PASS | - |
| 2 | Password reset | Email received | ❌ FAIL | Email not sent |
| 3 | Remember me | Stay logged in | ⏳ SKIP | Blocked by #2 |

## Failures

### Test 2: Password reset
- **Observed:** No email received after 5 minutes
- **Severity:** High
- **Diagnosis:** SMTP credentials not configured
- **Fix Plan:** See phase-3-FIX-PLAN.md
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

## Anti-Patterns

- Don't use AskUserQuestion for test responses - use plain text conversation
- Don't ask severity - infer from description
- Don't present full checklist upfront - one test at a time
- Don't run automated tests - this is manual user validation
- Don't fix issues during testing - log as gaps, diagnose after all tests

## Next Steps After Verification

| Result | Next Action |
|--------|-------------|
| All pass | `/oss:ship` - Create PR |
| Failures with fix plan | `/oss:build` - Execute fixes |
| Failures need design | `/oss:ideate` - Rethink approach |
