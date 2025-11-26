---
description: Pre-push quality gate - runs before every push
hooks: ["PrePush"]
---

# One Shot Ship Hook: pre-push

**This hook fetches and decrypts the proprietary workflow from One Shot Ship servers.**

## Step 1: Decrypt and Load Workflow

Run the decryption script:

```bash
node ~/.claude/plugins/cache/oss/lib/decrypt.js hooks pre-push
```

**If error:** Show appropriate message based on error code (NO_CONFIG, UNAUTHORIZED, FORBIDDEN, etc.)

## Step 2: Execute the Decrypted Workflow

The script output IS the workflow. **EXECUTE THOSE INSTRUCTIONS EXACTLY.**
