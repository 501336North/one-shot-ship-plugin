---
description: UI quality review — usability heuristics, visual quality, design system compliance, interaction states
---

## Help

**Command:** `/oss:ui-review`

**Description:** Comprehensive UI quality review combining usability heuristics, visual quality assessment, design system compliance, and interaction state validation.

**Workflow Position:** ideate → plan → build → **UI-REVIEW** → ship

**Usage:**
```bash
/oss:ui-review [OPTIONS] [PATH]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `PATH` | No | Path to components or pages to review |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--skip-visual` | | Skip screenshot capture, code-only review |

**Examples:**
```bash
# Review UI from the current build
/oss:ui-review

# Review specific components
/oss:ui-review src/components/Dashboard/

# Code-only review (no screenshots)
/oss:ui-review --skip-visual

# Show help
/oss:ui-review --help
```

**Related Commands:**
- `/oss:ui-ux` - Proactive design intelligence (run before build)
- `/oss:a11y` - Deep accessibility audit (WCAG compliance)
- `/oss:visual-qa` - Compare against Figma designs
- `/oss:build` - Build phase (auto-triggers this review for UI tasks)

---

# /oss:ui-review - UI Quality Review

Comprehensive UI quality review for post-build validation.

## What This Command Does

1. **Nielsen's 10 usability heuristics** - System status, consistency, error prevention, etc.
2. **Visual quality check** - Typography, color, spacing, layout, motion
3. **Design system compliance** - Token usage, palette consistency, type scale
4. **Interaction states** - Hover, focus, disabled, loading, empty, error
5. **Accessibility quick-check** - Keyboard nav, focus indicators, ARIA, contrast
6. **Screenshot capture** - Visual evidence when display tools available

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
~/.oss/hooks/oss-log.sh init ui-review
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow ui-review start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name ui-review
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Nielsen's 10 usability heuristic evaluation
- Visual quality assessment (typography, color, spacing, layout, motion)
- Design system compliance checking
- Interaction states review
- Accessibility quick-check
- Screenshot capture (when display tools available)

## Step 7: Update Status Line (Complete)

**Completion (after review completes):**
```bash
~/.oss/hooks/oss-notify.sh --workflow ui-review complete '{"issues": {count}}'
```

**Failure (if review cannot proceed):**
```bash
~/.oss/hooks/oss-notify.sh --workflow ui-review failed '{"reason": "{reason}"}'
```

## Example Usage

```bash
/oss:ui-review
/oss:ui-review src/components/Dashboard/
```
