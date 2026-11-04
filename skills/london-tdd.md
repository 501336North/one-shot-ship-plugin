---
description: London-style TDD methodology (Outside-In, Mockist)
---

# London TDD Skill

## Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. If it exits 75, the download is still in progress: run the same step again to continue.

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step || { case $? in 75) exit 75;; esac; echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type skills --name london-tdd
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

This skill provides comprehensive guidance on London-style Test-Driven Development including:
- Outside-In development workflow
- Mock-based design discovery
- Behavior verification patterns
- RED-GREEN-REFACTOR cycle
