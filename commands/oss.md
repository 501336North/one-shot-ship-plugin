---
name: oss
description: Execute OSS Dev Workflow commands
---

## Help

**Command:** `/oss`

**Description:** Execute OSS Dev Workflow commands

**Workflow Position:** **OSS** (meta command)

**Usage:**
```bash
/oss [SUBCOMMAND] [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | ideate, plan, build, ship, deploy, monitor, etc. |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--merge` | | Auto-merge PR (for ship command) |

**Examples:**
```bash
# Full development workflow
/oss:ideate "add user authentication"
/oss:plan "user dashboard"
/oss:build
/oss:ship --merge

# Quick deployment
/oss:deploy-staging
/oss:test-waters
/oss:deploy-production
```

**Related Commands:**
- `/oss:login` - Configure API key
- `/oss:status` - Check subscription status
- `/oss:legend` - Status line legend

---

# OSS Dev Workflow Command

World-class development workflows at your fingertips.

## Core Workflow Commands

The main development pipeline (also available as `/oss:command`):

- `/oss:ideate "<idea>"` - Transform vague ideas into concrete designs
- `/oss:plan "<feature>"` - Create TDD implementation plan
- `/oss:build` - Execute TDD plan with RED-GREEN-REFACTOR
- `/oss:ship [--merge]` - Quality check, commit, PR, optional auto-merge

## Additional Commands

### Testing
- `/oss:test-waters` - Run comprehensive E2E tests

### Deployment
- `/oss:deploy-staging` - Deploy to staging environment
- `/oss:deploy-production` - Deploy to production
- `/oss:monitor` - Monitor production health
- `/oss:rollback` - Emergency rollback

### Account
- `/oss:login` - Configure API key
- `/oss:status` - Check subscription status

## Usage Examples

```bash
# Full development workflow
/oss:ideate "add user authentication"
/oss:plan "user dashboard"
/oss:build
/oss:ship --merge

# Quick deployment
/oss:deploy-staging
/oss:test-waters
/oss:deploy-production
```

## How It Works

1. **You run a command** in Claude Code
2. **Plugin fetches proprietary prompt** from OSS API (requires subscription)
3. **Prompt executes locally** with full Claude Code capabilities
4. **You get world-class workflow** without the setup

## Requirements

- Active OSS Dev Workflow subscription (7-day free trial available)
- API key configured (run `/oss:login` first)

## First Time Setup

```bash
# Login and configure API key
/oss:login

# Start your free 7-day trial at https://www.oneshotship.com
```

## Support

- Documentation: https://www.oneshotship.com/docs
- Issues: https://github.com/agenticdev/support
- Email: support@oneshotship.com

---

## Implementation

When user runs `/oss <subcommand>`, delegate to the appropriate command or skill:

- `ideate` → /oss:ideate or skills/ideate.md
- `plan` → /oss:plan or skills/plan.md
- `build` → /oss:build or skills/build.md
- `ship` → /oss:ship or skills/ship.md
- `deploy` → skills/deploy-staging.md or skills/deploy-production.md
- `monitor` → skills/monitor.md
- `test-waters` → skills/e2e-testing.md

Each command fetches its proprietary prompt from the OSS API and executes it.
