# Notes: hook-test-hermetic

- **Callers wait for EOF, not for exit.** Node's execSync and Claude Code's hook runner return when every holder of the stdout/stderr pipe has closed it. `cmd &` inherits both pipes. Redirect the subshell itself: `( … ) </dev/null >/dev/null 2>&1 &`.
- **First exec of a new file on macOS** goes through syspolicyd/XProtect: 0.3–0.5 s idle, unbounded under load. A warm-up exec, or `bash file`, avoids it. vitest's per-test timeout cannot interrupt a synchronous execSync.
- **Production analytics:** until T5 and T10 land, any hook test run with a real `~/.oss/config.json` sends `analytics/track` events. The user was told on 2026-10-28; T16 files the server-side follow-up.
- **Plan-time grep for background jobs:** `grep -nE '(\)|[^&|<>])\s*&\s*$' hooks/*.sh`. Sites are in PLAN T4.

## T4 sweep (2026-10-29, /oss:build)
Commands used:
- `grep -nE '(\)|[^&|<>])\s*&\s*$' hooks/*.sh` finds background jobs.
- `grep -nE '\b(curl|oss_api_curl)\b' hooks/*.sh` finds network calls.
- `grep -o 'hooks/[a-z-]*\.sh' hooks.json` lists the registered hooks.

| Site | Outcome |
|---|---|
| oss-notify.sh:266 analytics, :364 update notice | Fixed in T1 and T2 |
| oss-session-start.sh:341/347 notify launches | Fixed in T3 |
| oss-log.sh:424-436 `agent` state updates (4 subshells) | T4a: detach |
| oss-session-start.sh:270-286 opt-in health check | T4b: detach, summary goes to health-check.log (D3) |
| oss-notify.sh:110 `find \| sort \| tail` under pipefail | T4c: non-fatal lookup |
| oss-login.sh:15 key check, no time limit (/oss:login hangs on a hung API) | T4d: `-m 10` |
| oss-notify.sh:33, oss-session-start.sh:27 `run_with_timeout "$@" &` | Safe: waited in the foreground by design; its timer is already detached |
| oss-notification.sh:50/56/63, oss-stop.sh:53/60 `&>/dev/null &` | Safe: stdout and stderr already detached; stdin is not a pipe the caller waits on |
| oss-session-start-new.sh, oss-session-start-test.sh | Unreachable: not in hooks.json, never called (removal is in FOLLOWUPS) |
| check-updates.sh:84, oss-changelog.sh:61 | Bounded already (`--max-time 3`) |
| oss-session-start.sh:142 subscription | Bounded already (`-m 2`) |
| oss-iron-laws-sync.sh:169 | Bounded already (`--connect-timeout 2 -m 4`) |
| oss-fetch-team-iron-laws.sh:101 | Bounded already (`--max-time 10`) |
| oss-push-metrics.sh:91 | Bounded already (`--max-time $TIMEOUT_SECONDS`) |
| ensure-decrypt-cli.sh:190/207 | Bounded against stalls (`--connect-timeout 15 --speed-limit 1024 --speed-time 60`). No total cap, on purpose: it is a binary download on slow links |
| fetch-iron-laws.sh:64, no time limit | Not on a live path: no command or hook runs it (commands/__tests__/no-iron-laws-fetch.test.sh). It only remains in the oss-setup-permissions allowlist and in the two unreachable session-start copies |
| ensure-oss-launch.sh:56/61, no time limit | Not on a live path: no caller (only mentioned in a comment of ensure-decrypt-cli.sh and in oss-launch-checksums.txt) |

## Last Updated: 2026-10-29 08:10 CST by /oss:build (T4 sweep)
