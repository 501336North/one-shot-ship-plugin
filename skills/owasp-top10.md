---
description: OWASP Top 10 security prevention guide
model: opus
---

# OWASP Top 10 Skill

## Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type skills --name owasp-top10
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

This skill provides comprehensive guidance on preventing OWASP Top 10 vulnerabilities:
- Broken Access Control
- Cryptographic Failures
- Injection
- Security Misconfiguration
