---
description: Mocking patterns for London TDD (ts-mockito, Jest, Vitest)
---

# Mocking Patterns Skill

## Fetch from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type skills --name mocking-patterns
```

This skill provides comprehensive guidance on mocking including:
- Stubs, Mocks, Spies, and Fakes
- ts-mockito patterns
- Jest/Vitest mock patterns
- Verification best practices
