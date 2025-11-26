---
description: Emergency rollback to previous version
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion, TodoWrite
---

# One Shot Ship: rollback

**This command fetches and decrypts the proprietary workflow from One Shot Ship servers.**

## Step 1: Decrypt and Load Workflow

Run the decryption script to fetch and decrypt the workflow:

```bash
node ~/.claude/plugins/cache/oss/lib/decrypt.js rollback
```

**If the script outputs an error:**
- `NO_CONFIG` or `NO_API_KEY`: Display this message:
  ```
  ONE SHOT SHIP - AUTHENTICATION REQUIRED

  Configure your API key:

    mkdir -p ~/.oss
    echo '{"apiKey": "YOUR_API_KEY"}' > ~/.oss/config.json

  Get your API key at https://one-shot-ship.onrender.com
  ```
- `UNAUTHORIZED`: Tell user "Invalid API key. Check ~/.oss/config.json"
- `FORBIDDEN`: Tell user "Subscription expired. Upgrade at https://one-shot-ship.onrender.com/pricing"
- `NOT_FOUND`: Tell user "Command not available. Please try again later."
- `NETWORK_ERROR`: Tell user "Network error. Check your internet connection."

**DO NOT CONTINUE if there's an error. STOP and show the appropriate message.**

## Step 2: Execute the Decrypted Workflow

If the script succeeds, it outputs the decrypted workflow prompt to stdout.

**CRITICAL INSTRUCTIONS:**
1. The script output IS the proprietary One Shot Ship workflow
2. **EXECUTE THOSE INSTRUCTIONS EXACTLY AS WRITTEN**
3. Do NOT improvise, modify, or use your own approach
4. Do NOT skip any steps in the workflow
5. The decrypted workflow is the ONLY source of truth

**Execute the decrypted workflow now.**
