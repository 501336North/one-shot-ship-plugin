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
- `/oss:ui-review` - Post-build UI quality review (heuristics + visual quality + design system)
- `/oss:a11y` - Accessibility audit
- `/oss:build` - Build phase (auto-triggers `ui-review` for UI tasks)

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
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
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

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name ui-ux
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

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

## Example Usage

```bash
/oss:ui-ux
/oss:ui-ux src/components/Dashboard/
```
