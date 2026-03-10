---
description: UX/UI design review and heuristic evaluation
---

## Help

**Command:** `/oss:design-review`

**Description:** UX/UI design review and heuristic evaluation

**Workflow Position:** build -> **DESIGN-REVIEW** (UX/UI)

**Usage:**
```bash
/oss:design-review [OPTIONS] [PATH]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `PATH` | No | Path to components to review |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--focus` | | Focus area (mobile, desktop, accessibility) |

**Examples:**
```bash
# Run design review on entire project
/oss:design-review

# Review specific components
/oss:design-review src/components/Dashboard/

# Focus on mobile design
/oss:design-review --focus mobile
```

**Related Commands:**
- `/oss:a11y` - Accessibility audit
- `/oss:review` - Code review
- `/oss:build` - Build phase

---

# /oss:design-review - Design Review

UX/UI design review and heuristic evaluation.

## What This Command Does

1. **Heuristic evaluation** - Nielsen's 10 usability heuristics
2. **Consistency check** - Design system compliance
3. **User flow analysis** - Task completion paths
4. **Accessibility review** - Design accessibility check
5. **Mobile responsiveness** - Cross-device review

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
~/.oss/hooks/oss-log.sh init design-review
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow design-review start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name design-review
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Usability heuristic evaluation
- Design consistency audit
- User experience assessment
- Improvement recommendations

## Example Usage

```bash
/oss:design-review
/oss:design-review src/components/Dashboard/
/oss:design-review --focus mobile
```
