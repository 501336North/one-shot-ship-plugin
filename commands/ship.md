---
description: Quality check, commit, create PR, and optionally auto-merge
---

# /oss:ship - Push to GitHub

Complete finalization workflow - quality check, docs, commit, PR, and optional merge.

## What This Command Does

1. **Runs quality checks** - Tests, lint, build
2. **Updates documentation** - Ensures docs are current
3. **Creates commit** - Proper conventional commit message
4. **Opens PR** - With comprehensive description
5. **Auto-merges** - Optional with `--merge` flag

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Send Start Notification

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Shipping" "Running quality checks..." "low"
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/ship
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt orchestrates the full shipping workflow:

### Quality Checks
- Run test suite
- Run linter
- Run build
- All must pass before proceeding

### Documentation
- Update relevant docs
- Generate changelog entry
- Update version if needed

### Git Operations
- Stage relevant changes
- Create conventional commit
- Push to remote
- Create pull request

## Git Command Best Practices

**IMPORTANT:** Use plain `git` commands when in the project working directory.

```bash
# ✅ CORRECT - Use plain git (single approval)
git status
git add .
git commit -m "feat: message"
git push -u origin branch-name

# ❌ AVOID - Using -C flag (requires approval each time)
git -C /full/path/to/repo status
git -C /full/path/to/repo push
```

The working directory is already set to your project. Using `-C` with full paths creates unique command strings that each require separate approval in Claude Code.

### Optional: Auto-Merge
With `--merge` flag:
- Wait for CI checks
- Auto-merge when green
- Delete feature branch

## Step 6: Send Completion Notifications

After quality checks pass:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Quality Passed" "All checks passed" "high"
```

After PR is created:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "PR Created" "PR #{number} ready for review" "high"
```

After PR is merged (with `--merge` flag):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Shipped!" "PR merged successfully" "high"
```

If shipping fails:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Ship Failed" "Check quality gates or CI status" "critical"
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

### If quality checks fail
```
Quality checks failed. Fix issues before shipping:
- Tests: npm test
- Lint: npm run lint
- Build: npm run build
```

## Example Usage

```bash
# Ship with manual merge
/oss:ship

# Ship and auto-merge when CI passes
/oss:ship --merge

# Ship with custom commit message
/oss:ship --message "feat: add user authentication"
```

## Flags

- `--merge` - Auto-merge PR when CI passes
- `--message <msg>` - Custom commit message (overrides auto-generated)
- `--no-checks` - Skip quality checks (not recommended)
- `--draft` - Create draft PR instead of ready for review
