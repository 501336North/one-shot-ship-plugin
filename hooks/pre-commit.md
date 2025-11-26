---
description: Pre-commit quality gate - runs before every commit
hooks: ["PreCommit"]
---

# One Shot Ship Hook: pre-commit

**This hook fetches and decrypts the proprietary workflow from One Shot Ship servers.**

## Step 1: Decrypt and Load Workflow

Run the decryption script:

```bash
node ~/.claude/plugins/cache/oss/lib/decrypt.js hooks pre-commit
```

**If error:** Show appropriate message based on error code (NO_CONFIG, UNAUTHORIZED, FORBIDDEN, etc.)

## Step 2: Execute the Decrypted Workflow

The script output IS the workflow. **EXECUTE THOSE INSTRUCTIONS EXACTLY.**
