# Design: Interactive Local-Model Offload (nested mini-claudish)

## Problem (verified 2026-06-20)

The 13 routable agents (`model_routing: true`) in `agents/*.md` carry a `## Step 0:
Model Routing Check` that runs `watcher/dist/cli/agent-model-check.js`, receives
`{useProxy:true, model, provider, proxyUrl:"http://localhost:3456"}`, **prints a banner,
and then keeps reasoning on the session's Anthropic backend.** The `proxyUrl` is never
consumed in the interactive client. Net effect: in any interactive session (including an
`/oss:ship` that spawns `oss:code-reviewer` via the Task tool) the configured local model
is *announced but never used*.

### Why it's not a one-line fix
A Task-spawned subagent's inference is performed by Claude Code against the **session's**
API base URL. There is **no per-subagent base-URL knob** — `model:` frontmatter only
selects a Claude tier. Independently confirmed by `MadAppGang/claudish` and the whole
claude-code-proxy family: they all set `ANTHROPIC_BASE_URL` **process-globally** and spawn
one `claude` per model; subagents inherit the parent's model; "no mechanism for routing
individual Task tool calls to different models within a single session."

## Decision

**Agent-as-orchestrator via a nested mini-claudish sub-session.** When `useProxy:true`, a
routable agent does NOT do its own reasoning. It spawns a nested headless Claude session
pointed at the local model through the existing `:3456` ModelProxy:

```
ANTHROPIC_BASE_URL=http://localhost:3456 \
OSS_OFFLOAD_ACTIVE=1 OSS_PROXY_LOG=<path> \
claude -p --model <localModel> --dangerously-skip-permissions  < <assembled-prompt>
```

The proxy translates Anthropic → ollama → `gpt-oss:120b @ deepblue (100.86.42.12:11434)`.
The nested session gets a **full agentic loop with tools** (Read/Edit/Write) in the same
working dir — so the SAME mechanism serves both agent classes:
- **Review/analysis (5):** code-reviewer, security-auditor, debugger, architecture-auditor,
  dependency-analyzer → nested session emits findings; orchestrator relays them.
- **Generative (8):** typescript-pro, python-pro, backend-architect, refactoring-specialist,
  code-simplifier, test-engineer, frontend-developer, react-specialist, nextjs-developer →
  nested session edits files directly; orchestrator summarizes.

This is exactly the mechanism the eval harness used (`claude -p` → `:3456`) and that
claudish proves works.

## Scope decisions
- **All 13 routable agents** (uniform Step 0.5).
- **Commands and skills are untouched** — they run on the session Claude tier (not routable).
- **Managed/OSSMA path is untouched** — it correctly runs on Anthropic infra.
- `fallbackEnabled: true` (already in `~/.oss/config.json`) remains a hard safety net: any
  offload failure → proceed natively on Claude. Daily use never breaks.

## Architecture (testable core, thin markdown)
Put logic in **TypeScript** (`watcher/src/cli/agent-offload.ts`), not untested bash across
13 files. Each agent markdown gets a slim uniform block that invokes the compiled CLI.

```
agent .md  Step 0.5 ──▶ node watcher/dist/cli/agent-offload.js --agent oss:<id> \
                              --prompt-file <expert+task>
                         │
                         ├─ agent-model-check → {useProxy,model,proxyUrl}
                         ├─ useProxy=false  → {offloaded:false}            (orchestrator runs natively)
                         ├─ proxy preflight (reachable? else start-proxy / fallback)
                         ├─ spawn nested `claude -p` (env: BASE_URL, OFFLOAD_ACTIVE, PROXY_LOG)
                         └─ capture → {offloaded:true, output} | fallback → {offloaded:false}
```

## Key risks → mitigations
| Risk | Mitigation |
|------|-----------|
| **Infinite nesting** (nested gpt-oss session re-triggers Step 0) | Recursion guard: `agent-model-check` returns `useProxy:false` when `OSS_OFFLOAD_ACTIVE=1`. **Task 1, do first.** |
| Proxy not running on `:3456` | Preflight health check; auto `start-proxy` (existing CLI) or fall back to native. |
| `claude -p` empty output on tiny budgets / gpt-oss reasoning channel | Adequate `max_tokens`; treat empty as failure → fallback. (CC 2.1.183 empty-output bug absent — PONG verified.) |
| Can't prove the local model was actually used | `OSS_PROXY_LOG` assertion in the acceptance test (proven technique from the eval). |
| Cold model load latency on deepblue | Pre-warm gpt-oss before live runs (out of code scope; NOTES). NOTE: gpt-oss:120b **coexists** with other models on the box — only `minimax-m2.7` and `qwen3-thinking:235B` monopolize the 128GB, so our gpt-oss path does NOT need serialization (just don't co-run it with those two hogs). |
| Nested session tool permissions | `--dangerously-skip-permissions` scoped to workdir; document blast radius. |

## Acceptance criterion (the whole point)
Spawning `oss:code-reviewer` interactively (e.g. via `/oss:ship`) with code-reviewer mapped
to `ollama/gpt-oss:120b` produces a request **logged in `OSS_PROXY_LOG` against `:3456`** —
proving the review was reasoned by gpt-oss, not Claude. With the mapping removed, no proxy
hit and native Claude runs.
