# Notes: hook-test-hermetic

- **Callers wait for EOF, not for exit.** Node's execSync and Claude Code's hook runner return when every holder of the stdout/stderr pipe has closed it. `cmd &` inherits both pipes. Redirect the subshell itself: `( … ) </dev/null >/dev/null 2>&1 &`.
- **First exec of a new file on macOS** goes through syspolicyd/XProtect: 0.3–0.5 s idle, unbounded under load. A warm-up exec, or `bash file`, avoids it. vitest's per-test timeout cannot interrupt a synchronous execSync.
- **Production analytics:** until T5 and T10 land, any hook test run with a real `~/.oss/config.json` sends `analytics/track` events. The user was told on 2026-10-28; T16 files the server-side follow-up.
- **Plan-time grep for background jobs:** `grep -nE '(\)|[^&|<>])\s*&\s*$' hooks/*.sh`. Sites are in PLAN T4.

## Last Updated: 2026-10-28 by /oss:plan
