---
description: Quality check, commit, create PR, and optionally auto-merge
---

## Help

**Command:** `/oss:ship`

**Description:** Complete finalization workflow - quality check, commit, PR, and optional merge.

**Workflow Position:** ideate → plan → build → **SHIP**

**Usage:**
```bash
/oss:ship [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | - | Ships all staged changes from the current feature branch |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--merge` | `-m` | Auto-merge PR when CI passes |
| `--message` | | Custom commit message (overrides auto-generated) |
| `--quick` | `-q` | Skip agent-based quality gates, only run tests and build |
| `--no-checks` | | Skip ALL quality checks (emergency hotfixes only) |
| `--draft` | `-d` | Create draft PR instead of ready for review |
| `--team` | | Enable Agent Teams mode for parallel quality gates with auto-fix (Pro+ only) |

**Examples:**
```bash
# Ship with manual merge (default)
/oss:ship

# Ship and auto-merge when CI passes
/oss:ship --merge

# Ship with custom commit message
/oss:ship --message "feat: add user authentication"

# Fast shipping (skip agent reviews)
/oss:ship --quick

# Ship with Agent Teams (parallel quality gates + auto-fix)
/oss:ship --team

# Show help
/oss:ship --help
```

**Related Commands:**
- `/oss:build` - Run before to complete TDD implementation
- `/oss:review` - Multi-perspective code review (included in ship)
- `/oss:stage` - Deploy to staging after ship
- `/oss:deploy` - Deploy to production after staging validation

---

# /oss:ship - Push to GitHub

Complete finalization workflow - quality check, docs, commit, PR, and optional merge.

## What This Command Does

1. **Parallel agent quality gates** - Code review, performance audit, security audit (3 agents in parallel)
2. **Runs tests & build** - `npm test` and `npm run build`
3. **Updates documentation** - Ensures docs are current
4. **Creates commit** - Proper conventional commit message
5. **Opens PR** - With comprehensive description
6. **Auto-merges** - Optional with `--merge` flag

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
~/.oss/hooks/oss-log.sh init ship
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
~/.oss/hooks/oss-notify.sh --workflow ship start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

If `--team` flag is present in the arguments:
```bash
~/.oss/bin/oss-decrypt --type workflows --name ship-team
```

Otherwise (default):
```bash
~/.oss/bin/oss-decrypt --type workflows --name ship
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt orchestrates the full shipping workflow:

### Quality Checks (Configurable via workflow config)

**Quality gates are now configurable per team via the dashboard.**

The workflow engine reads your team's `quality_gates` configuration (fetched from the API):
- `parallel`: Whether to run agents in parallel (default: true)
- `agents`: List of agents to spawn for quality checks
- `all_must_pass`: Whether all agents must pass (default: true)

All configured agents must complete successfully before proceeding to git operations.

**Default quality_gates configuration:**
```json
{
  "quality_gates": {
    "parallel": true,
    "agents": ["code-reviewer", "performance-engineer", "security-auditor"],
    "all_must_pass": true
  }
}
```

**Execution Pattern:**
The workflow engine will:
1. Fetch your team's workflow config from the API
2. Spawn each agent in the `quality_gates.agents` list
3. Run them in parallel if `parallel: true`
4. Aggregate results and check `all_must_pass`
5. Stop with failure if any required agent fails

To customize your quality gates, visit the dashboard at https://www.oneshotship.com/dashboard/workflows

You can add agents, remove agents, or change whether all must pass.

**After all agents pass, also run:**
- `npm test` - Full test suite
- `npm run build` - Build verification
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

## Step 8: Update Status Line (Progress)

**You MUST update the workflow status at each stage.**

After quality checks pass:
```bash
~/.oss/hooks/oss-notify.sh --workflow ship quality_passed '{"checks": ["code-review", "performance", "security", "tests", "build"]}'
```

After PR is created:
```bash
~/.oss/hooks/oss-notify.sh --workflow ship pr_created '{"prNumber": {PR_NUM}, "prTitle": "{PR_TITLE}"}'
```

After PR is merged (with `--merge` flag):
```bash
~/.oss/hooks/oss-notify.sh --workflow ship merged '{"branch": "{BRANCH}", "prNumber": {PR_NUM}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` and `merged` events.

If shipping fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow ship failed '{"blocker": "{REASON}"}'
```

## Command Orchestration

After this command completes, the workflow engine will:
1. Evaluate conditions from your team's workflow config (fetched from the API)
2. Execute any chained commands (e.g., stage, deploy)
3. Spawn configured agents for post-ship tasks
4. Stop at checkpoints for human review (if configured)

Your team's workflow config controls:
- `quality_gates`: Which agents run for quality checks (configurable list)
- `chains_to`: Which commands run after shipping (e.g., stage, deploy)
- `checkpoint`: Whether to pause for human review (human/auto)

To customize your workflow, visit the dashboard at https://www.oneshotship.com/dashboard/workflows

## Execute Chain Commands (MANDATORY)

After `oss-notify.sh --workflow ship complete` runs, its stdout may contain a `---CHAIN_COMMANDS---` block. If present, **auto-execute each `CHAIN:` line in order** — no user intervention required.

**Parsing rules:**
- `CHAIN: /oss:<command> (...)` → invoke Skill tool: `skill: "oss:<command>"`
- `CHAIN: /oss:oss-custom <name> (...)` → invoke Skill tool: `skill: "oss:oss-custom"`, `args: "<name>"`

**Behavior:**
- Execute in order, one at a time
- Each chain command runs with full logging and status updates
- If a blocking chain command fails, stop the chain and report the failure
- If no `---CHAIN_COMMANDS---` block appears, skip this step
- Log each: `~/.oss/hooks/oss-log.sh write ship "[CHAIN] executing /oss:<command>"`

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
- `--quick` - Skip agent-based quality gates, only run `npm test` and `npm run build`
- `--no-checks` - Skip ALL quality checks (not recommended, use for hotfixes only)
- `--draft` - Create draft PR instead of ready for review

### Quality Check Modes

| Flag | Agents | Tests | Build | Use Case |
|------|--------|-------|-------|----------|
| (default) | ✅ code-reviewer, performance-auditor, security-auditor | ✅ | ✅ | Standard shipping |
| `--quick` | ❌ | ✅ | ✅ | Fast iteration, trusted changes |
| `--no-checks` | ❌ | ❌ | ❌ | Emergency hotfixes only |

## Permission Denied Fallback

If permission is denied for `git push` or PR creation, your work is preserved:

```
⚠️ Permission denied for git push.

PR prepared but not pushed. To complete manually:
  git push -u origin {branch-name}
  gh pr create --title "{title}" --body "{body}"

Files staged and committed:
  - [list of committed files]
```

Run the commands shown above to complete the shipping process manually.
