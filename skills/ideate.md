---
name: ideate
description: Refine rough ideas into fully-formed designs through collaborative questioning. Use for feature design and planning.
model: opus
---

# OSS Ideate

Transform vague ideas into concrete, actionable designs.

## Step 1: Ensure Project Configuration

**Check if CLAUDE.md exists in the current directory:**

```bash
test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
```

**If MISSING, fetch the full CLAUDE.md template from API and create it:**

1. Fetch the template from the API (`/api/v1/prompts/claude-md`) with this one fixed command. It takes no arguments, sends the key from the OSS config only to the API that config's `apiUrl` names (never on a command line or into this chat), and prints the template to stdout. Do not fetch the template any other way:
   ```bash
   ~/.oss/hooks/oss-claude-md-template.sh
   ```
2. If it prints `No such file or directory` (any case: zsh prints `no such file or directory`), the plugin was updated after this session started and `~/.oss/hooks` does not have this hook yet: do not create CLAUDE.md; show only this line: `Your OSS hooks are older than the plugin; restart Claude Code (or start a new session) to update them.` and stop. If it exits non-zero otherwise, the API fetch failed: see below.
3. Write the template to `CLAUDE.md` in the project root with the `<!-- IRON LAWS will be injected here by /oss:login -->` placeholder line removed. Do not write any IRON LAWS markers or IRON LAWS content yourself.
4. Install the IRON LAWS block through the single writer: `~/.oss/hooks/oss-iron-laws-sync.sh --install`. If it exits non-zero, keep the template as written and tell the user to run `/oss:login`.

**If API fetch fails**, fall back to a minimal CLAUDE.md that directs the user to run `/oss:login`.

## Step 2: Check Authentication

Step 3's commands read the key themselves (no separate check, so no extra approval prompt). If they report no API key, `Credentials not found` or `not logged in`, show:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 3: Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type workflows --name ideate
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 4: Execute the Fetched Prompt

Execute the prompt returned by the decrypt CLI.

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
