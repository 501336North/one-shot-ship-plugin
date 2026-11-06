---
description: Create a versioned release with changelog
model: haiku
---

## Help

**Command:** `/oss:release`

**Description:** Create a versioned release with changelog

**Workflow Position:** stage -> deploy -> **RELEASE** (versioned)

**Usage:**
```bash
/oss:release [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--version` | | Version bump type: major, minor, patch |

**Examples:**
```bash
# Create release with auto-detected version
/oss:release

# Create a patch release
/oss:release --version patch

# Create a minor release
/oss:release --version minor
```

**Related Commands:**
- `/oss:deploy` - Deploy before creating release
- `/oss:monitor` - Monitor after release
- `/oss:rollback` - Rollback if release has issues

---

# /oss:release - Create Release

Create a versioned release with automated changelog generation.

## What This Command Does

1. **Version bump** - Semantic versioning
2. **Changelog** - Generate from commits
3. **Tag** - Create git tag
4. **Publish** - Push release

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init release
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow release start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name release
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Version determination (major/minor/patch)
- Changelog generation
- Git tagging
- Release publishing

## Step 7: Update Status Line (Completion)

On success only. If the command failed (the prompt sent `failed`), do not send `complete`.

**You MUST update the workflow status on completion.**

```bash
~/.oss/hooks/oss-notify.sh --workflow release complete '{}'
```

## Command Chain

```
/oss:stage       → Deploy to staging, QA testing
    ↓
/oss:deploy      → Deploy to production
    ↓
/oss:release     → Create versioned release (YOU ARE HERE)
    ↓
/oss:monitor     → Watch production health
```

**Previous**: `/oss:deploy` (production deployed)
**Next**: `/oss:monitor` (ongoing health monitoring)

## Permission Denied Fallback

If permission is denied for `npm publish` or release commands, your release is prepared:

```text
⚠️ Permission denied for npm publish.

Release package prepared. To publish manually:
  npm publish
  git push --tags

Changelog generated:
  - CHANGELOG.md updated
  - Version bumped to {version}
  - Git tag created: v{version}
```

Run the commands shown above to complete the release manually.

## Example Usage

```bash
/oss:release
/oss:release --version patch
/oss:release --version minor
```
