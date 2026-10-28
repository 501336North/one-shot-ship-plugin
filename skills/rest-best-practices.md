---
description: RESTful API design best practices
---

# REST Best Practices Skill

## Fetch from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type skills --name rest-best-practices
```

This skill provides comprehensive guidance on REST API design:
- URL design and naming
- HTTP methods and status codes
- Pagination and versioning
- Authentication patterns
