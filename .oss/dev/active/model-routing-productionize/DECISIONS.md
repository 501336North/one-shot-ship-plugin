# DECISIONS (ADRs) — Model-Routing Productionization

## DR-001: Remote ollama via `apiKeys.ollama` + `--base-url` (not a new top-level key)
Reuse the existing `models.apiKeys.ollama` config slot as the ollama base URL (it is unused for true
auth since local ollama needs no key), plus a `--base-url` CLI override for `start-proxy`. Keeps the
config surface small and back-compatible. Default stays `http://localhost:11434`.

## DR-002: Per-request routing log is opt-in via `OSS_PROXY_LOG`
Logging writes a JSON line per `/v1/messages` only when `OSS_PROXY_LOG` is set (default off in normal
use; the eval/CI sets it). Avoids noisy disk writes for ordinary users while keeping routing verifiable.

## DR-003: Routed-agent banner is emitted by the agent Step-0, sourced from `agent-model-check`
The routing decision already runs in each routable agent's Step-0 (`agent-model-check.js`). Centralize the
human string there (new `banner` field) so all agents print an identical, correct banner; agent files just
echo it. Avoids 13 divergent hand-written banners.

## DR-004 (OPEN — needs confirmation at build): session-model banner via HOOK, not API prompt
The chosen scope was "API command prompts emit the session model." **Finding during planning:** a served
command prompt (plain text) cannot reliably know the exact session model string (e.g. "Opus 4.8 (1M
context)") — only the harness knows it, delivered to hooks as `.model.display_name` (this is exactly how
the statusline gets it). A model asked to "state your model" is unreliable/often wrong.
**Recommendation:** implement AC4 as a small **plugin hook** (e.g. UserPromptSubmit) that prints a
one-line `🤖 OSS model: <display_name>` banner into the output — accurate, plugin-only, works on every
surface (terminal, VS Code, web). This diverges from the "API repo" part of the original scope selection.
→ **Confirm at /oss:build:** Hook approach (recommended) vs. attempt an API-prompt directive (less accurate).
Phase 3 is planned for the hook approach; if rejected, re-plan Phase 3 for the API repo.


## DR-004 RESOLVED (2026-06-18): per-AGENT banner, NOT a session hook
Investigation (claude-code-guide): `UserPromptSubmit` hooks do NOT receive the model; only `SessionStart`
(model ID) and the statusLine (`.model.display_name`) do. A SessionStart banner is once-per-session — but
the model VARIES PER AGENT within a session (code-reviewer→gpt-oss, test-engineer→Claude tier), so a
session-level banner is wrong. **Resolution:** make `agent-model-check` ALWAYS emit a `banner`, and have
every routable agent's Step-0 echo it unconditionally. Routed → `🤖 OSS model: <model> (<provider>)`;
native → the agent's frontmatter tier `🤖 OSS model: <Tier> (claude)`, or `Claude (session default)` for
inherit agents (which genuinely run on the session model — not nameable here). No hook, no API repo, plugin-only.
Known UX note: 9 of 13 routable agents have no `model:` frontmatter → they show "session default" (truthful).
