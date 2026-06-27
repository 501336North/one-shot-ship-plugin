# DESIGN: Self-contained oss-launch (bundled Node) + loud Node preflight

**Repo:** `one-shot-ship-plugin` (plugin-only)
**Phase:** ideate → plan → build → ship
**Created:** 2026-06-27
**Origin:** the one open follow-up from per-agent model routing (see
`.oss/dev/completed/per-agent-proxy-routing-2026-06-27/TESTING.md`). On a customer's external
local-model box, `oss-launch` (and the proxy/CLIs it drives) shell out to `node`. If Node is
missing or too old, local routing silently degraded to all-cloud — the exact gap that bit DeepBlue.

---

## Problem

The launcher/proxy runtime depends on a system `node`. Two failure modes today:
1. **Node absent** → `node …/oss-launch.js` fails before any of our code runs → no guidance, and
   (if a caller falls back to plain `claude`) the session runs all-cloud with no signal.
2. **Node too old** → ESM + web streams (`Readable.fromWeb`, `fetch`) misbehave; routing breaks.

`node-guard.ts` (`checkNode(version, minMajor=18)`) exists as a pure primitive but is **wired
into nothing**. There is no `requireNode`, and `oss-launch.ts` never calls it.

## Goal

Make local routing robust on any customer box: it must NEVER **silently** degrade to all-cloud.
Ship a self-contained launcher so the common case has zero system-Node dependency, and a loud
preflight for the fallback case.

---

## Decisions (from ideation)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope | **Both together, one feature**: bundle a self-contained Node launcher AND add the loud preflight. |
| D2 | Behavior when routing configured but Node unusable (fallback path) | **Warn loudly, continue all-cloud** (exit 0). Loud, never silent; never blocks the user's work. |
| D3 | Preflight coverage (node-absent paradox) | **Bash shim + JS guard.** `bin/oss-launch` (bash) checks `command -v node` + version before invoking node; `oss-launch.ts` calls `checkNode(process.version)` for direct `node …` callers. |
| D4 | Bundling build path | **Reuse the oss-decrypt native-runner playbook** — build per-arch on native GH runners (`ubuntu-24.04-arm` + x64), avoiding the V8-bytecode cross-compile failure that broke `pkg`. See [[project_aarch64_linux_decrypt]]. |
| D5 | Minimum Node major (proposed) | **20** (LTS). dist uses `Readable.fromWeb` + web `ReadableStream` + `fetch`; 18.17+ works but 20 is the safe floor. `checkNode` default bumps 18 → 20. |

## Architecture — layered

```
caller (drain.sh / user)
        │
        ▼
  bin/oss-launch  ──►  is a bundled self-contained binary available for this arch?
        │                         │ yes                          │ no (unsupported arch / missing)
        │                         ▼                              ▼
        │                 exec the bundled binary         exec `node watcher/dist/cli/oss-launch.js`
        │                 (brings its own Node —           (system node; bash shim already checked
        │                  routing always works)            command -v node + version >= 20)
        ▼
  oss-launch (JS): checkNode(process.version) guard for direct `node …/oss-launch.js` callers
        │
        ├─ Node OK  → resolveLaunch → ensureProxy (own runtime) → exec real claude (routed)
        └─ Node bad → LOUD banner: "local routing DISABLED, running ALL-CLOUD" → continue (exit 0)
```

**Primary path:** the bundled binary *is* Node, so "Node absent" cannot disable routing. The
binary also starts the proxy using its own runtime (`process.execPath` re-invoked, or in-process)
— no system node anywhere in the routing path.

**Fallback path** (no bundled binary for the platform): run via system node. Bash shim catches
absent/old before node starts; the JS guard catches "too old" for callers that invoke
`node …/oss-launch.js` directly. Either way → **loud warn + continue all-cloud** (D2).

## Scope

**In:**
- Bundled self-contained `oss-launch` binary per arch via native-runner GH Actions workflow
  (Linux **arm64 + x64** at minimum). Released as an artifact the plugin ships/fetches, mirroring
  the oss-decrypt CLI distribution.
- The bundled binary can start `start-proxy --router` using its own runtime (no system node).
- `bin/oss-launch` bash shim: prefer the bundled binary for the arch; else fall back to system
  node AFTER a `command -v node` + version preflight (loud warn, continue).
- Wire `checkNode` into `oss-launch.ts` (`main()`), emitting the loud all-cloud banner when bad.
- Bump `checkNode` floor 18 → 20.
- `DRAIN_SH_INTEGRATION.md`: callers invoke the bundled `oss-launch` (not raw `node …`).
- Tests: bash-shim preflight (shell), JS guard wiring + banner, bundled-binary smoke
  (`oss-launch --version` / proxy `/health` with system node removed from PATH).

**Out:**
- Making the **entire** plugin Node-free (hooks + other `watcher/dist/cli/*` still use system
  node) — separate, larger effort. This feature covers only the routing/launcher path.
- macOS / Windows bundled binaries (customers running local-model boxes are Linux: GB10/servers).
  Revisit if a macOS local-model customer appears.
- Any change to the routing logic itself (shipped + acceptance-proven).

## Edge cases

- Bundled binary present but **wrong arch** (x64 on arm64) → exec fails → shim falls back to system
  node + preflight.
- System node present but **< 20** → loud warn + continue all-cloud.
- `drain.sh` calling raw `node …/oss-launch.js` and node is **absent** → node fails before our JS
  runs; mitigated by pointing drain.sh at the bundled binary / bash shim (doc update).
- Bundled binary download/verify failure → treat as "not available" → fallback path.
- `models.agents` NOT configured → Node is irrelevant to routing; no preflight noise, behave exactly
  as today (the no-impact guarantee from the shipped feature still holds).

## Open questions for /oss:plan

1. **Distribution:** does the bundled binary ship inside the plugin package, or get fetched on
   first use like the oss-decrypt CLI (`ensure-decrypt-cli.sh` pattern)? Lean: mirror oss-decrypt
   (fetch + verify + cache) to keep the plugin package small.
2. **Proxy under the bundled binary:** in-process (import start-proxy) vs spawn `process.execPath`
   with a `--router` subcommand. Lean: spawn `process.execPath` (reuses existing start-proxy entry).
3. **Min version source of truth:** is 20 right given any other CLI's constraints? Confirm against
   the lowest Node feature the dist relies on.

## Acceptance (high level)

- On a box with **no system Node**, `oss-launch -p "/oss:build …"` (via the bundled binary) routes
  local-mapped agents to Ollama exactly as the proven feature does — zero system node involved.
- On a box where the bundled binary is unavailable and system Node is missing/old, the launcher
  prints a **loud** all-cloud banner and still runs (exit 0) — never silent, never blocked.
- `models.agents` unset → no preflight, no banner, behavior identical to today.

## Last Updated: 2026-06-27 by /oss:ideate
