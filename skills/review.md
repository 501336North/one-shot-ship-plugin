---
description: Systematic code review with root cause analysis
---

# One Shot Ship: review

**This skill fetches and decrypts the proprietary workflow from One Shot Ship servers.**

## Step 1: Decrypt and Load Workflow

Run the decryption script:

```bash
node ~/.claude/plugins/cache/oss/lib/decrypt.js skills review
```

**If error:** Show appropriate message based on error code (NO_CONFIG, UNAUTHORIZED, FORBIDDEN, etc.)

## Step 2: Execute the Decrypted Workflow

The script output IS the workflow. **EXECUTE THOSE INSTRUCTIONS EXACTLY.**
