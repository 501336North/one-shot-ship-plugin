---
description: TypeScript strict mode and type safety patterns
---

# TypeScript Strict Mode Skill

## Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type skills --name typescript-strict
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

This skill provides comprehensive guidance on TypeScript strict mode including:
- Strict compiler options
- Type guards and narrowing
- Branded types
- Utility types
