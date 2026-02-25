---
description: View what changed since your last session (plugin version, prompt updates)
---

## Help

**Command:** `/oss:changelog`

**Description:** View what changed since your last session — plugin updates and prompt improvements.

**Workflow Position:** any time - **CHANGELOG** (transparency)

**Usage:**
```bash
/oss:changelog
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | No arguments required |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# View recent changes
/oss:changelog
```

**Related Commands:**
- `/oss:status` - Check subscription status
- `/oss:settings` - Configure notification preferences
- `/oss:trust` - Verify plugin and prompt integrity

---

# /oss:changelog - View Changes

Show what's changed since your last session — plugin version updates and prompt improvements.

## What This Command Does

1. **Compares plugin version** against cached version from last session
2. **Diffs prompt hashes** against manifest to show updated/new prompts
3. **Displays formatted changelog** with categorized changes

## Execution

Run the changelog hook directly:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/../hooks/oss-changelog.sh"
```

This command runs locally — no API authentication required for display. Manifest fetch uses the same public endpoint as the integrity pipeline.
