---
description: Create distinctive, production-grade frontend interfaces with high design quality
---

## Help

**Command:** `/oss:ui-ux`

**Description:** Proactive design intelligence for building distinctive UI — style selection, color palettes, typography, UX guidelines, and pre-delivery checklists.

**Workflow Position:** ideate → plan → **UI-UX** → build

**Usage:**
```bash
/oss:ui-ux [OPTIONS] [PATH]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `PATH` | No | Path to components or pages to design |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Run design intelligence for current feature
/oss:ui-ux

# Design specific components
/oss:ui-ux src/components/Dashboard/

# Show help
/oss:ui-ux --help
```

**Related Commands:**
- `/oss:design-review` - Post-hoc UX audit (review existing UI)
- `/oss:a11y` - Accessibility audit
- `/oss:build` - Build phase (auto-triggers `frontend-design` agent for UI tasks)

---

# /oss:ui-ux - Design Intelligence

Proactive design intelligence for building distinctive, high-quality user interfaces.

## What This Command Does

1. **Style selection** - Choose distinctive design direction for your product type
2. **Design system generation** - Create design tokens and component patterns
3. **Color palette** - Build accessible color systems with dark/light mode
4. **Typography** - Select fonts, scale, and hierarchy
5. **UX guidelines** - Priority-ordered rules from accessibility to data visualization
6. **Pre-delivery checklist** - Visual, interaction, layout, and accessibility verification

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
~/.oss/hooks/oss-log.sh init ui-ux
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow ui-ux start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name ui-ux
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Design system token generation
- Style selection guidance
- Color palette and typography systems
- Priority-ordered UX guidelines
- Pre-delivery quality checklist

## Step 7: Update Status Line (Complete)

**Completion (after UI/UX work completes):**
```bash
~/.oss/hooks/oss-notify.sh --workflow ui-ux complete '{}'
```

**Failure (if UI/UX cannot proceed):**
```bash
~/.oss/hooks/oss-notify.sh --workflow ui-ux failed '{"reason": "{reason}"}'
```

## Example Usage

```bash
/oss:ui-ux
/oss:ui-ux src/components/Dashboard/
```
