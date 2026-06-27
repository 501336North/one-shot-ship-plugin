# PLAN: Self-contained oss-launch (bundled Node) + loud Node preflight

**Repo:** `one-shot-ship-plugin` (plugin-only)
**Branch:** `feat/oss-launch-node-runtime/build` (cut from `origin/main`)
**Methodology:** London TDD — RED → GREEN → REFACTOR. Vitest (watcher) for JS units; shell harness
for the bash shim / fetch script; CI smoke for the bundled binary.
**Design:** see `DESIGN.md`. **Origin:** the open follow-up from per-agent model routing.

> ⛔ IRON LAW #4: branch off main. ⚠️ Vitest-overload: run TARGETED files, never the full suite in agents.

## Plan-time decisions (defaults from the parked ideate questions — revisit if needed)
- **PD1 Distribution:** fetch-on-first-use + verify + cache, mirroring `ensure-decrypt-cli.sh` /
  `release-cli-decrypt.yml`. Keeps the plugin package small.
- **PD2 Proxy under bundled binary:** spawn `process.execPath` with a `start-proxy` subcommand
  (reuses the existing start-proxy entry; no second binary).
- **PD3 Min Node major:** **20** (LTS). `checkNode` floor 18 → 20.
- **PD4 Bundler:** reuse the repo's **esbuild** standalone-CJS step (`scripts/bundle-cli.js`,
  already used for `chain-trigger.cjs`) to flatten oss-launch's ESM + dynamic `import()` into one
  `.cjs`, THEN wrap that with the runtime on native runners (mirror `release-cli-decrypt.yml`).

---

## Phase 1 — Loud Node preflight (JS). Independently shippable safety net.

- **T1 — `checkNode` floor 18 → 20.** RED: update/extend `node-guard.test.ts` so v18 → `ok:false`,
  v20 → `ok:true`; change default `minMajor` to 20. (`services/node-guard.ts`, `+ test`.)
- **T2 — pure `decidePreflight({ nodeCheck, routingConfigured })`.** Returns
  `{ route: boolean, banner?: string }`: routing-configured + node bad → `{route:false, banner:<loud
  all-cloud msg>}`; routing-configured + node ok → `{route:true}`; routing NOT configured →
  `{route:true}` (no banner — preserves the no-impact guarantee). RED first. New
  `services/node-guard.ts` export (or `launch-preflight.ts`) + test.
- **T3 — wire preflight into `runLaunch`/`main`.** When `decidePreflight` returns `route:false`:
  print the banner to **stderr**, do NOT `ensureProxy`, exec the real claude with the env UNCHANGED
  (all-cloud), exit code from claude. When `route:true`: existing routed path. Inject `nodeCheck`
  via deps for the unit test (no real node probing in the test). (`cli/oss-launch.ts`, `+ test`.)

✅ **Milestone M1 (shippable):** missing/old system Node can no longer SILENTLY degrade — it warns
loudly and runs all-cloud. (Bundling not required for this value.)

## Phase 2 — Subcommand dispatch + `--version` (prereqs for a single bundled binary)

- **T4 — `resolveEntry(argv)` → `'start-proxy' | 'launch'`.** First positional `start-proxy`
  routes to the proxy entry; else the launcher. Pure, RED first. (`cli/oss-launch.ts` or a small
  `cli/entry.ts`, + test.)
- **T5 — bundled-aware proxy spawn.** In `ensureProxy`'s `startProxy`, when running as a bundled
  binary (detect: entry is not a `*.js` script / `process.execPath` basename ≠ `node`), spawn
  `process.execPath ['start-proxy','--router','--background','--port',port]`; else keep the current
  `[startProxyJs, …]`. Test both branches' spawn args via injected spawn. (`cli/oss-launch.ts`, + test.)
- **T6 — `oss-launch --version`.** Prints the plugin version and exits 0 (needed by the Phase-4
  smoke test; cheap). RED first. (`cli/oss-launch.ts`, + test.)

## Phase 3 — `bin/oss-launch` bash shim (arch select + presence preflight)

Shell tests via the repo's `*.test.sh` harness (see `hooks/__tests__/`). The shim's contract:
- **T7 — bundled binary present → exec it.** If `~/.oss/bin/oss-launch-<arch>` exists + executable,
  `exec` it with `"$@"`. (arch via `uname -m` → `arm64`/`x64` mapping, reuse the decrypt hook's map.)
- **T8 — no binary, node present → exec the JS launcher.** `exec node "$DIR/watcher/dist/cli/oss-launch.js" "$@"`
  (the JS guard from T3 then handles too-old). 
- **T9 — no binary, node ABSENT → loud warn + exec real claude (all-cloud).** Resolve the real
  `claude` on PATH (skip self), print the loud banner to stderr, `exec claude "$@"`. Never silent,
  never blocked. (`bin/oss-launch`, + `bin/__tests__/oss-launch.test.sh`.)

## Phase 4 — Bundle to standalone + per-arch binary build (CI)

- **T10 — extend `scripts/bundle-cli.js` to emit `dist/cli/oss-launch.cjs`** (esbuild,
  `platform:node target:node20 format:cjs bundle:true`). Verify it flattens the dynamic `await
  import()` calls in `main()`. Validated by: `node dist/cli/oss-launch.cjs --version` works with NO
  relative-import resolution. (+ a build assertion test.)
- **T11 — SPIKE: runtime wrap.** Decide SEA (`--experimental-sea-config`) vs `pkg` to turn
  `oss-launch.cjs` into a self-contained binary on a native runner. Acceptance of the spike: a binary
  that runs `--version` AND starts the router proxy with **`node` removed from PATH**. Record the
  choice in `DECISIONS.md`.
- **T12 — `.github/workflows/build-oss-launch.yml`.** Matrix on **native** runners
  (`ubuntu-24.04-arm` + x64), mirroring `release-cli-decrypt.yml` (avoids the V8-bytecode
  cross-compile failure). Build, checksum, attach binaries to the release/tag.
- **T13 — bundled-binary smoke (CI).** With `node` stripped from PATH: `oss-launch-<arch> --version`
  → 0; start `start-proxy --router` via the binary, `curl /health` → 200; assert per-agent dispatch
  is reachable. Zero system-node involved = PASS.

## Phase 5 — Distribution: fetch + verify + cache (mirror oss-decrypt)

- **T14 — `hooks/ensure-oss-launch.sh`.** Detect arch, fetch the matching release binary, verify
  checksum (+ signature if decrypt does), cache to `~/.oss/bin/oss-launch-<arch>`, `chmod +x`.
  Idempotent; existing install untouched. Shell test with mocked `curl` + fake binary + checksum.
- **T15 — shim auto-install.** `bin/oss-launch` calls `ensure-oss-launch.sh` (best-effort) before
  the T7 presence check, mirroring `ensure-decrypt-cli.sh`. Falls through to T8/T9 on failure.

## Phase 6 — Docs + ship prep

- **T16 — `DRAIN_SH_INTEGRATION.md`:** callers invoke the bundled `oss-launch`; add the behavior
  matrix (bundled binary / system-node-old / node-absent → routed / warn+all-cloud / warn+all-cloud)
  and the min-Node note.
- **T17 — `.claude-plugin/plugin.json` patch bump.**

---

## Task → file → verified-by

| Phase | Tasks | Core file(s) | Verified by |
|-------|-------|-------------|-------------|
| 1 | T1–T3 | node-guard.ts, oss-launch.ts | floor=20; decidePreflight; warn+all-cloud on bad node (vitest, DI) |
| 2 | T4–T6 | oss-launch.ts | subcommand routing; bundled spawn args; --version (vitest) |
| 3 | T7–T9 | bin/oss-launch | arch select / node-present / node-absent (shell harness) |
| 4 | T10–T13 | scripts/bundle-cli.js, .github/workflows/ | standalone cjs; binary runs w/o system node (smoke) |
| 5 | T14–T15 | hooks/ensure-oss-launch.sh, bin/oss-launch | fetch+verify+cache (shell, mocked curl) |
| 6 | T16–T17 | DRAIN_SH_INTEGRATION.md, plugin.json | docs matrix; version bump |

## Sequencing
Phase 1 → 2 → 3, then 4 → 5 (4 unblocks 5: need a built binary to fetch/cache), 6 last.
Phase 1 is an independent shippable milestone (M1) — can ship before 2–6 if we want the safety net out fast.

## Key risks
- **R1 (highest): ESM + dynamic `import()` under the runtime wrap.** Mitigated by pre-bundling to
  CJS with the existing esbuild step (T10) before SEA/pkg. T11 spike must prove the wrapped binary
  actually runs (node-stripped) before T12 invests in the matrix.
- **R2: native-runner availability/cost** for `ubuntu-24.04-arm` — already used by
  release-cli-decrypt.yml, so proven.
- **R3: arch matrix creep.** Scope is Linux arm64 + x64 only (DESIGN out-of-scope: macOS/Windows).

## Acceptance (from DESIGN)
1. No system Node on the box → `oss-launch` (bundled) routes local agents to Ollama exactly as the
   proven feature — zero system node in the routing path.
2. No bundled binary for the arch + system Node missing/old → **loud** all-cloud banner, still runs
   (exit 0). Never silent, never blocked.
3. `models.agents` unset → no preflight, no banner, behavior identical to today.

## Last Updated: 2026-06-27 by /oss:plan
