# TESTING: Per-Agent Model Routing via Launcher + Smart Proxy

## Strategy
London TDD. Unit-test the pure pieces (route resolver, pass-through, fallback, launcher logic)
with mocked collaborators (mock Anthropic upstream, mock Ollama, mock spawn/fetch). The agent
markers get a completeness/contract test. The DeepBlue run is the real acceptance gate.

## Unit / integration suites (Mac, targeted vitest — NOT full suite)
```bash
cd watcher && npx vitest run \
  test/services/anthropic-passthrough.test.ts \
  test/services/agent-route-resolver.test.ts \
  test/services/routing-log.test.ts \
  test/agents/agent-markers.test.ts \
  test/cli/oss-launch.test.ts \
  test/cli/agent-model-check.test.ts \
  test/services/model-proxy.test.ts
```

Key behaviors asserted:
- **Pass-through** forwards inbound `authorization` (OAuth bearer) UNCHANGED to Anthropic and
  does NOT override the model; streaming bytes piped through; unknown paths forwarded (catch-all).
- **resolveRoute**: `OSS-ROUTE-AGENT:code-reviewer` + `models.agents.code-reviewer=ollama/gpt-oss:120b`
  → `{ollama, gpt-oss:120b}`; `test-engineer`→`claude` → `{anthropic}`; unmarked → `{anthropic}`.
- **Marker completeness**: every routable agent `.md` carries exactly one matching marker.
- **Fallback**: ollama throws + `fallbackEnabled` → request completes via Anthropic; log records
  `fallback` + reason. `fallbackEnabled:false` → error surfaced.
- **Loud log**: one JSON line per request decision; logging failure never breaks the request.
- **Launcher**: `models.agents` set → sets `ANTHROPIC_BASE_URL`+`OSS_PROXY_ROUTING=1`, reuses a
  healthy proxy, execs the REAL claude (not itself); unset → execs claude unchanged (no proxy).
- **Node guard**: missing node → loud non-zero exit.
- **Legacy reconcile**: `OSS_PROXY_ROUTING=1` → `agent-model-check` returns `useProxy:false`.

## ACCEPTANCE — DeepBlue (aarch64), the real gate
Config in `~/.oss/config.json`: `models.default="claude"`, `fallbackEnabled=true`,
`models.apiKeys.ollama="http://deepblue.tail1cda39.ts.net:11434"` (or the box's URL),
`models.agents` mapping code-reviewer → `ollama/gpt-oss:120b` and test-engineer → `claude`.

drain.sh change (one line): call the launcher instead of claude:
```bash
# was:  timeout 7200 claude       -p "/oss:queue drain" --dangerously-skip-permissions >> "$LOG" 2>&1
# now:  timeout 7200 oss-launch   -p "/oss:queue drain" --dangerously-skip-permissions >> "$LOG" 2>&1
#   where oss-launch = node "$PLUGIN_ROOT/watcher/dist/cli/oss-launch.js"  (exact path documented at ship)
```

Pre-warm the model (ops, avoids first-call timeout):
```bash
curl -s "$OLLAMA/api/chat" -d '{"model":"gpt-oss:120b","messages":[{"role":"user","content":"hi"}],"stream":false}' >/dev/null
```

Run a build/review that invokes a local-routed agent, then VERIFY (the exact commands):
```bash
OLLAMA="http://deepblue.tail1cda39.ts.net:11434"   # or localhost on the box

# 1. During the run, the model is loaded/serving:
curl -s "$OLLAMA/api/ps" | grep gpt-oss:120b        # MUST appear

# 2. Ollama received inference (chat/generate) during the window:
journalctl --user -u ollama --since "-10 min" | grep -E "POST /api/(chat|generate)"   # MUST show hits

# 3. OSS routing log shows the per-agent decisions:
tail -n 200 ~/.oss/logs/*/model-routing.log 2>/dev/null | grep -E "route=ollama.*code-reviewer"   # MUST appear
tail -n 200 ~/.oss/logs/*/model-routing.log 2>/dev/null | grep -E "route=anthropic.*test-engineer" # MUST appear
```

**PASS:** code-reviewer drove `gpt-oss:120b` inference on Ollama; test-engineer hit Anthropic;
no manual proxy start, no manual env export.
**FAIL:** zero Ollama traffic (today's state) — that is the regression this feature eliminates.

## No-impact guarantee for Anthropic-only users (explicit acceptance)
The feature is **opt-in via `models.agents`**. Encoded as failing acceptance tests:
- `test/cli/oss-launch.test.ts` — no `models.agents` (or absent/empty) → `useProxy=false`, env
  has NO `ANTHROPIC_BASE_URL`, NO `OSS_PROXY_ROUTING`, original env preserved verbatim → claude
  runs exactly as today.
- `test/services/agent-route-resolver.test.ts` — default is ALWAYS Anthropic pass-through;
  unmarked requests and configs without `models.agents` never touch Ollama.

## Results
### Acceptance (RED) — 2026-06-27
`npx vitest run test/cli/oss-launch.test.ts test/services/agent-route-resolver.test.ts`
→ **2 files failed (modules don't exist yet)** — canonical outside-in RED. 9 tests defined
across the two boundaries (launcher decision + proxy route decision), centering the
Anthropic-only no-impact guarantee. Turns green once `resolveLaunch` + `resolveRoute` are built.
_Remaining results filled during /oss:build + DeepBlue acceptance run._

## Last Updated: 2026-06-27 by /oss:plan
