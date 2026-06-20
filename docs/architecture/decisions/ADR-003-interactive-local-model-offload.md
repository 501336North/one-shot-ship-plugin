# ADR-003: Interactive per-agent local-model offload via nested `claude -p` through the OSS ModelProxy

**Status:** Accepted (2026-06-20)

## Context

Routable OSS agents (`model_routing: true`) could be *mapped* to a local model in
`~/.oss/config.json` (`models.agents`), but in the interactive client that mapping only printed
a banner — the agent still reasoned on Claude. We wanted an opted-in agent (e.g. `code-reviewer`)
to actually **run its work on a local model** (e.g. `gpt-oss:120b` on a networked Ollama box) to
cut cost, while keeping the default experience 100% native Claude.

A Task-spawned subagent's inference is performed by Claude Code against the **session's** API
base URL; there is **no per-subagent base-URL knob** (`model:` frontmatter only selects a Claude
tier). Confirmed independently by `claude-code-router` / claudish, which set `ANTHROPIC_BASE_URL`
**process-globally** and run one `claude` per model.

## Decision

When an agent is mapped to a non-Claude model, a new **Step 2.5** in the agent prompt calls
`watcher/dist/cli/agent-offload.js`, which spawns a **nested `claude -p` session** pointed at our
own **OSS ModelProxy** via `ANTHROPIC_BASE_URL`. The proxy translates Anthropic ↔ Ollama and
force-selects the configured local model, so the nested session runs entirely on the local model —
**with full tool use** (it can read/edit files), proven live. `OSS_OFFLOAD_ACTIVE=1` guards against
infinite nesting.

We use **our own ModelProxy**, not claude-code-router, because customers won't have CCR installed.
The proxy port is **configurable** (`models.proxyPort`, default `8473`, NOT `3456` which CCR uses).
The runner **auto-starts** the proxy on demand (reading the remote Ollama URL from
`models.apiKeys.ollama`).

## Alternatives considered

1. **Direct `/v1/messages` relay** (no nested Claude): simpler and proven, but the local model
   gets a single completion with **no tool loop** — crippled for generative agents. Rejected in
   favour of the fuller nested approach.
2. **Use claude-code-router as the transport:** rejected — third-party dependency customers lack;
   also collides on port 3456.
3. **Session-global base URL** (claudish-style): routes the *whole* session to one model, not
   per-agent. Defeats "cheapest model per component."

## Making the nested CLI boot against our minimal proxy (the hard part)

The Claude CLI is strict; live testing surfaced a chain of requirements our proxy had to satisfy
(each invisible to mocked tests):
- Force the configured model (CLI rejects a foreign `--model`; runner passes none).
- Answer `HEAD /` reachability + tolerate `/v1/messages?beta=true`.
- Stream **Anthropic SSE** with **early-flush + keepalive** (buffered SSE → idle-timeout retry loop).
- **Flatten array-form `content`/`system`** to strings (Ollama 500s on arrays — the real blocker).
- Translate **tool-use** both ways (Anthropic `tools` ↔ Ollama; `tool_calls` → `tool_use`;
  `tool_result` history round-trip; SSE `input_json_delta`).

## Consequences

- **Default users (no mapping) are unaffected:** `agent-offload` resolves routing first and returns
  `{offloaded:false, reason:'native'}` before any spawn/proxy — verified live. No proxy, no network,
  ~80ms. The only all-users surface is the no-op Step 2.5 block in the 13 agent prompts.
- **Opted-in users** get review *and* tool-driving agents on local models (proven: nested gpt-oss
  used the `Read` tool to read a file and report its contents).
- **`fallbackEnabled`** keeps it safe: any offload failure degrades to native Claude; the runner
  never throws into the agent.
- **Plugin-only change** — the API/web/db are untouched; the served expert prompt is unchanged and
  simply fed to the local model instead of Claude.
- Scope boundary: a single proxy serves one model; multiple *different* local models per session
  would need one proxy per port (deferred — current configs map all offloaded agents to one model).
