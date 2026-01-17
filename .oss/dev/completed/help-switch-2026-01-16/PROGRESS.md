# Progress: Comprehensive --help Support for All Commands

## Current Phase: build (COMPLETE)

## Summary

Added standardized `## Help` sections to all 53 OSS Dev Workflow commands, enabling users to run `/oss:cmd --help` to learn about each command's purpose, options, workflow position, and related commands.

## Tasks

- [x] Phase 1: Core commands (ideate, plan, build, ship) - completed 2026-01-13
- [x] Phase 2: TDD commands (red, green, refactor, mock, acceptance, integration) - completed 2026-01-13
- [x] Phase 3: Design commands (requirements, api-design, data-model, adr, contract) - completed 2026-01-13
- [x] Phase 4: Quality commands (test, review, bench, load, audit, a11y, tech-debt) - completed 2026-01-13
- [x] Phase 5: Deployment commands (stage, deploy, release, smoke) - completed 2026-01-13
- [x] Phase 6: Operations commands (monitor, incident, rollback, debug, trace, postmortem) - completed 2026-01-13
- [x] Phase 7: Utility commands (login, status, models, settings, telegram, webhook, watcher, queue, legend, docs) - completed 2026-01-13
- [x] Phase 8: Specialized commands (iterate, chaos, cost, design-review, experiment, feature-flag, license, privacy, retro, oss, oss-audio) - completed 2026-01-13

## Test Results

- **Help documentation tests**: 585 tests passing
- **Full test suite**: 2260 tests passing (increased from 1721)
- **Zero regressions**

## Files Modified

### Test File
- `watcher/test/help-documentation.test.ts` - New test file with 585 assertions

### Command Files (53 total)
All files in `/Users/ysl/dev/one-shot-ship-plugin/commands/*.md` now include standardized `## Help` sections.

## Help Section Structure

Each command now has this structure at the top:

```markdown
## Help

**Command:** `/oss:command-name`

**Description:** Brief description of the command

**Workflow Position:** Shows position in workflow (e.g., ideate → plan → **BUILD** → ship)

**Usage:**
/oss:command-name [OPTIONS] [ARGUMENTS]

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| ... | ... | ... |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| ... | ... | ... |

**Examples:**
# Example usage
/oss:command-name "example"

**Related Commands:**
- `/oss:related-cmd` - Description of relationship

---
```

## Blockers
- None

## Last Updated: 2026-01-13 18:53 by /oss:build
