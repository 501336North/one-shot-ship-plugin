# NOTES: Interactive Local-Model Offload

## Build checkpoint 2026-06-20 — testable core done, markdown rollout has a design fork

### Done (Phases 1-4), all green, tsc 0 errors
- `watcher/src/cli/agent-model-check.ts` — recursion guard at top of `checkAgentModel`:
  `OSS_OFFLOAD_ACTIVE=1 ⇒ {useProxy:false}` (depth-1 only).
- `watcher/src/cli/agent-offload.ts` — `runAgentOffload(params, deps)`:
  resolve routing → proxy preflight → spawn nested `claude -p --model <local>
  --dangerously-skip-permissions` with `env.ANTHROPIC_BASE_URL=<proxyUrl>` +
  `OSS_OFFLOAD_ACTIVE=1` → capture stdout → classify → success | fallback. Never throws.
  Pure helpers `buildOffloadInvocation` / `classifyResult` unit-tested.
- Tests: `test/acceptance/interactive-local-model-offload.acceptance.test.ts` (4),
  `test/cli/agent-offload.test.ts` (5), guard in `test/cli/agent-model-check.test.ts` (1).

### THE DESIGN FORK for Phase 5-6 (needs a decision before touching 13 markdown files)
The nested session needs the agent's **expert prompt + task context** to do the work. But in
the current agent flow the expert prompt is fetched (WebFetch) in **Step 2**, AFTER the
**Step 0** routing check. So the offload cannot fire at Step 0 — at that point we don't yet
have the prompt to feed the nested session.

**Proposed resolution:** keep Step 0 as detection + banner (unchanged), and add a uniform
**"Step 2.5: Local-Model Offload"** AFTER the expert prompt is fetched:
1. write `<expert prompt>\n\n<the task this agent was given>` to a temp prompt file
2. `node $PLUGIN_ROOT/watcher/dist/cli/agent-offload.js --agent "$AGENT_ID" --prompt-file <file>`
3. parse JSON: if `offloaded:true` → present `.output`, STOP (do not re-reason on Claude)
4. else (`offloaded:false`) → continue to the native Steps 3..n
This block is identical across all 13 agents except `$AGENT_ID`.

Open sub-questions:
- **Prompt assembly fidelity:** is "expert prompt + task text" enough for the nested session,
  or should the nested `claude -p` itself be given tool access + the repo path so generative
  agents can read more context? (Generative agents likely need `--add-dir`/cwd = repo.)
- **Output relay vs. direct edits:** review agents relay `.output`; generative agents'
  nested session edits files in-place (cwd) — the orchestrator then just reports. Confirm the
  block handles both (it does, since the nested session has tools).
- **dist build:** the markdown calls `watcher/dist/cli/agent-offload.js` — must `npm run build`
  (tsc + cli-bundle) so the compiled file exists before the block works.

### Live-proof prerequisites (Phase 7) — NOT a code blocker
- deepblue gpt-oss:120b pre-warmed; reachable at `http://100.86.42.12:11434`.
- gpt-oss **coexists** with other models — no serialization needed. Only `minimax-m2.7` and
  `qwen3-thinking:235B` monopolize the 128GB box; don't co-run those during the proof.
- Proof = `OSS_PROXY_LOG` shows a `:3456` request line when a routed agent runs.

### LIVE PROOF 2026-06-20 — partial success + one blocking design finding
Ran the real `agent-offload.js` against deepblue. Outcomes:
- ✅ **OUR OSS ModelProxy → deepblue works.** Direct Anthropic `/v1/messages` to the OSS proxy
  (port 3460, `--base-url http://100.86.42.12:11434`) returned a real `gpt-oss:120b` completion
  (`PROXY_OK`, HTTP 200). `OSS_PROXY_LOG` captured the request → proof-of-routing mechanism works.
- ✅ **Configurable port works** (env `OSS_PROXY_PORT` / config `models.proxyPort`) — avoids the
  `:3456` collision with claude-code-router. TDD'd, 23/23.
- ✅ **Bug found+fixed: ollama/ prefix.** `ollama-handler` forwarded `request.model` verbatim, so
  ollama rejected `ollama/gpt-oss:120b`. Fixed: strip `^ollama/`. TDD'd.
- ❌ **BLOCKING: `claude` CLI rejects a foreign `--model`.** `claude -p --model ollama/gpt-oss:120b`
  fails *client-side* ("model … may not exist or you may not have access") before any request is
  sent — so the nested session never reaches the proxy. The runner returned
  `{offloaded:false, fallback:true, reason:'spawn_error'}` (safety net held — never threw).

**Root cause:** the "nested mini-claudish" approach as built passes the local model id via
`claude --model`, but the Claude CLI validates `--model` against known Claude ids. CCR/claudish
avoid this: they DON'T pass a foreign `--model`; their proxy **force-overrides** the model on
every request (Router.default). Our OSS proxy instead **forwards `requestBody.model`** to the
handler (model-proxy.ts:380), so even with no `--model` it would forward claude's default id and
ollama would 404.

**Fix (two parts, both small):**
1. `model-proxy.ts` (~line 375-380): force `requestBody.model = this.config.model` (it already has
   `parsedModel`) before `handler.handle()` — proxy always serves its configured model, CCR-style.
2. `agent-offload.ts buildOffloadInvocation`: DON'T pass `--model <foreign>`; let claude use its
   default id (the proxy overrides it). Update the acceptance + unit tests (the original
   `--model ollama/gpt-oss:120b` contract was wrong — the live proof falsified it).

**Architecture note:** a single proxy serves ONE model (started with `--model`). Today every
offloaded agent in your config maps to `gpt-oss:120b`, so one proxy is fine. Multiple DIFFERENT
local models per session would need one proxy per model (per-port) + per-model `proxyUrl` from
agent-model-check — defer until needed.

### Pre-existing tech debt (not mine, flag for ship)
`ollama-handler.test.ts` emits an unhandled rejection from `listModels` (line 114, `response.models.map`
on an undefined mock response). 16/16 assertions still pass deterministically. Unrelated to this feature.

### CHOICE 2 (user-selected 2026-06-20): make OSS proxy complete enough for nested claude -p
Discovery spike (instrumented probe capturing claude's startup requests) BOUNDED the scope —
no longer open-ended. Claude's full surface against the proxy:
1. **`HEAD /`** reachability probe. Proxy 404s it → claude reports "model may not exist" (this,
   not a model-list check, was the real cause). Fix: 200 on HEAD / (and GET /).
2. **`/v1/messages?beta=true`** — claude appends a query string; proxy uses `url === '/v1/messages'`
   (exact, model-proxy.ts:285) → 404. Fix: match path ignoring query.
3. **SSE streaming** — captured request has `stream:true` (always). Proxy returns plain JSON →
   claude retries ~10× then fails. Fix: emit Anthropic SSE events (message_start →
   content_block_start → content_block_delta* → content_block_stop → message_delta → message_stop),
   translating from ollama streaming (NDJSON). THE substantial piece.
4. **tool-use** — request also carries `tools`, `system`, `thinking`. For gpt-oss to read/edit
   files (Choice 2's whole point over relay) the proxy must translate Anthropic tool-use ↔ ollama
   tool-calling. Largest + most uncertain (gpt-oss:120b tool reliability via ollama). Sub-phase,
   assess after 1-3 boot the session.

Phased: P-A items 1-2 (boot reachability), P-B item 3 (streaming → text answers), P-C item 4
(tool-use → full agentic). All proxy-side fixes already landed (force-model, ollama-prefix strip,
configurable port) remain valid regardless.

### CHOICE 2 PROGRESS (2026-06-20) — nested claude BOOTS + routes to gpt-oss; last mile = real streaming
- ✅ P-A done (TDD): proxy answers `HEAD /` (reachability) + matches `/v1/messages` ignoring query
  string (`?beta=true`). model-proxy.ts. The "model may not exist" error is GONE.
- ✅ P-B done (TDD, unit): proxy emits Anthropic SSE event sequence when `stream:true`
  (writeSseResponse). 43/43 model-proxy tests, tsc 0.
- ✅ PROVEN live: a nested `claude -p` against the proxy now BOOTS and routes real requests to
  gpt-oss@deepblue (11 calls logged). gpt-oss returns a CLEAN response to a claude-style request
  (tools+system): `stop_reason:end_turn`, `content:"NESTED_OK"`. Model + translation are correct.
- ⚠️ LAST MILE: writeSseResponse is BUFFERED — it awaits the full ollama response (~40s) then emits
  the SSE burst. Claude sees ~40s of silence (no time-to-first-byte) and retries → 11-call loop, no
  final output. FIX: real incremental streaming — emit `message_start`/`content_block_start`
  immediately, keepalive (ping) during inference, stream `content_block_delta`s as ollama produces
  them (ollama stream:true → NDJSON), then stop. Requires ollama-handler streaming support.
- Item 4 (tool-use translation) NOT yet needed for boot+text; revisit only if agents must let
  gpt-oss drive tools.

### Ship quality-gate review (2026-06-20) — fixed + deferred
Code-reviewer + security-auditor (native) reviewed the diff. No critical/high; invariants verified
(default-OFF native, never-throws, no `any`, no command injection — all spawns use array argv,
no shell:true; HTTPS honored for remote ollama). FIXED before ship:
- **Security: don't leak real Anthropic creds to nested session** — `stripModelEnv` now sets a dummy
  `ANTHROPIC_API_KEY` + drops `ANTHROPIC_AUTH_TOKEN` (nested talks only to the local proxy).
- **CR L1: stringified tool-call arguments** — `transformFromOllama` JSON-parses string `arguments`
  into an object (Anthropic tool_use.input must be an object).
DEFERRED hardening (none ship-blocking; opted-in path or deferred multi-model scope):
- Base URL is read from USER config only (`loadOllamaBaseUrlFromConfig`), not project config — so a
  malicious repo can't redirect offload traffic (a safety property), but project-configured remote
  ollama is ignored. Future: scheme allowlist + explicit project-vs-user base-URL precedence.
- Reachability probe hits `/` (always 200), not `/health` — proxy-up-but-ollama-down passes preflight,
  wastes one nested spawn, then falls back. Fail-fast via `/health` is a future improvement.
- Stale proxy can serve the WRONG model after a model change (reachability can't distinguish model) —
  tie to the deferred multi-model-per-port work (key PID/probe by model).
- Minor: ping-after-close race (add `res.on('close')`); `classifyResult` trusts exit-0 stdout;
  `generateId` duplicated in 3 files; `parseInt` radix; openrouter key not under `models.apiKeys`.

### Guardrails honored
- Default-OFF: no `models.agents` mapping ⇒ `useProxy:false` ⇒ zero behavior change (customers safe).
- OSSMA/managed path untouched. Commands/skills untouched.
- `fallbackEnabled` safety net preserved (any failure → native Claude).
