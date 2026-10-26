---
name: release
description: Full production release workflow with version bumps and changelog. Use for releases.
model: haiku
---

# OSS Release

Full production release with version management.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

```bash
~/.oss/bin/oss-decrypt --type workflows --name release
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates:
- Version bump (major/minor/patch)
- Changelog generation
- Git tagging
- Release notes
- Deployment trigger

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Example Usage

```
/oss release
```

Creates a production release.
