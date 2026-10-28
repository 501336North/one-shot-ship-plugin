---
description: London-style TDD methodology (Outside-In, Mockist)
---

# London TDD Skill

## Fetch from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type skills --name london-tdd
```

This skill provides comprehensive guidance on London-style Test-Driven Development including:
- Outside-In development workflow
- Mock-based design discovery
- Behavior verification patterns
- RED-GREEN-REFACTOR cycle
