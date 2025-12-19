---
description: Quality check, commit, create PR, and optionally auto-merge
---

# /oss:ship - Push to GitHub

Complete finalization workflow - quality check, docs, commit, PR, and optional merge.

## Context Management

> **🚦 Context Gate Active**
>
> If conversation history exceeds 20 turns, this command will be **blocked**.
> You must either:
> 1. Run `/clear` first, then re-run (recommended)
> 2. Use `--force` flag to bypass: `/oss:ship --force`
>
> Why? Quality gates should run with unbiased perspective.
> State is loaded from `~/.oss/dev/active/{feature}/` docs and git status.

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init ship
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Send Start Notification

**You MUST execute this notification command before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ship start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name ship
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 4: Execute the Fetched Prompt

The prompt orchestrates the full shipping workflow:

### Quality Checks (Parallelized Agent Delegation)

**MANDATORY: Launch these 4 specialized agents IN PARALLEL using the Task tool.**

All agents must complete successfully before proceeding to git operations.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PARALLEL QUALITY GATES                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
│  │ code-reviewer   │  │ performance-    │  │ security-       │       │
│  │                 │  │ auditor         │  │ auditor         │       │
│  │ • Code quality  │  │ • Performance   │  │ • OWASP Top 10  │       │
│  │ • Test coverage │  │ • Memory leaks  │  │ • Dependency    │       │
│  │ • Best practices│  │ • Bundle size   │  │   vulnerabilities│      │
│  │ • Type safety   │  │ • Query perf    │  │ • Secret leaks  │       │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘       │
│           │                    │                    │                 │
│           ▼                    ▼                    ▼                 │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                     AGGREGATE RESULTS                        │     │
│  │  All 3 agents must report: ✅ PASS or provide fixes         │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Agent 1: Code Reviewer** (`subagent_type: code-reviewer`)
```
Prompt: "Review the staged changes for this PR. Check:
1. Code correctness and logic errors
2. Test coverage for new/changed code
3. TypeScript type safety (no 'any' types)
4. Best practices and coding standards
5. Potential bugs or edge cases

Report format:
- PASS: All checks passed
- FAIL: [List specific issues that must be fixed]

Focus on the changes in: [list staged files]"
```

**Agent 2: Performance Auditor** (`subagent_type: performance-auditor`)
```
Prompt: "Audit the staged changes for performance issues. Check:
1. N+1 query patterns in database operations
2. Memory leaks or unbounded growth
3. Bundle size impact (new dependencies)
4. Algorithmic complexity (O(n²) or worse)
5. Missing caching opportunities

Report format:
- PASS: No performance regressions detected
- WARN: [Non-blocking suggestions]
- FAIL: [Critical issues that must be fixed]

Focus on the changes in: [list staged files]"
```

**Agent 3: Security Auditor** (`subagent_type: security-auditor`)
```
Prompt: "Security audit the staged changes. Check:
1. OWASP Top 10 vulnerabilities (XSS, injection, etc.)
2. Hardcoded secrets or API keys
3. Dependency vulnerabilities (npm audit)
4. Input validation and sanitization
5. Authentication/authorization issues

Report format:
- PASS: No security issues found
- FAIL: [Critical vulnerabilities that must be fixed]

Focus on the changes in: [list staged files]"
```

**Execution Pattern:**
```typescript
// Launch all 3 agents in parallel (single message with multiple Task tool calls)
const results = await Promise.all([
  Task({ subagent_type: 'code-reviewer', prompt: '...' }),
  Task({ subagent_type: 'performance-auditor', prompt: '...' }),
  Task({ subagent_type: 'security-auditor', prompt: '...' })
]);

// Aggregate results
const allPassed = results.every(r => r.status === 'PASS');
if (!allPassed) {
  // Report failures and STOP - do not proceed to git operations
  notify('ship', 'failed', { blocker: 'Quality gates failed' });
  return;
}
```

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

## Step 6: Send Completion Notifications

**You MUST execute the appropriate notification commands at each stage.**

After quality checks pass:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ship quality_passed '{"checks": ["code-review", "performance", "security", "tests", "build"]}'
```

After PR is created:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ship pr_created '{"prNumber": {PR_NUM}, "prTitle": "{PR_TITLE}"}'
```

After PR is merged (with `--merge` flag):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ship merged '{"branch": "{BRANCH}", "prNumber": {PR_NUM}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` and `merged` events.

If shipping fails:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow ship failed '{"blocker": "{REASON}"}'
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
- `--quick` - Skip agent-based quality gates, only run `npm test` and `npm run build`
- `--no-checks` - Skip ALL quality checks (not recommended, use for hotfixes only)
- `--draft` - Create draft PR instead of ready for review

### Quality Check Modes

| Flag | Agents | Tests | Build | Use Case |
|------|--------|-------|-------|----------|
| (default) | ✅ code-reviewer, performance-auditor, security-auditor | ✅ | ✅ | Standard shipping |
| `--quick` | ❌ | ✅ | ✅ | Fast iteration, trusted changes |
| `--no-checks` | ❌ | ❌ | ❌ | Emergency hotfixes only |
