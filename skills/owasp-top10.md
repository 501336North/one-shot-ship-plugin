---
description: OWASP Top 10 security prevention guide
model: opus
---

# OWASP Top 10 Skill

## Fetch from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type skills --name owasp-top10
```

This skill provides comprehensive guidance on preventing OWASP Top 10 vulnerabilities:
- Broken Access Control
- Cryptographic Failures
- Injection
- Security Misconfiguration
