# Progress: Self-contained oss-launch (bundled Node) + loud preflight

## Current Phase: build COMPLETE — ALL 17 TASKS DONE & VERIFIED LOCALLY → next: /oss:ship
(Only the Linux native-runner *builds* run in CI on tag `oss-launch-v*`; the build+pkg+smoke steps
are locally validated on darwin-arm64, and the workflow mirrors the proven release-cli-decrypt.yml.)

## Tasks
### Phase 1 — Loud Node preflight (JS) — shippable milestone M1 ✅
- [x] T1: checkNode floor 18 → 20 (node-guard.test.ts, RED→GREEN)
- [x] T2: pure decidePreflight({nodeCheck, routingConfigured})
- [x] T3: wire preflight into runLaunch/main (warn + all-cloud, never silent; no-impact preserved)
### Phase 2 — Subcommand dispatch + --version ✅
- [x] T4: resolveEntry(argv) → 'start-proxy' | 'launch' (+ fixed: dispatch returns undefined so a
      foreground proxy isn't killed by process.exit)
- [x] T5: bundled-aware proxy spawn (proxySpawnArgs, pure + wired)
- [x] T6: oss-launch --version
### Phase 3 — bin/oss-launch bash shim ✅ (shell harness, 5/5)
- [x] T7: bundled binary present → exec it (arch map arm64/x64)
- [x] T8: no binary, node present → exec JS launcher
- [x] T9: no binary, node absent → loud warn + exec real claude (all-cloud)
### Phase 4 — Bundle + per-arch binary build (CI)
- [x] T10: extend bundle-cli.js → oss-launch.cjs (esbuild). VERIFIED: standalone .cjs runs
      `--version` AND the proxy in-process (single run, /health 200). De-risks R1.
- [x] T11: SPIKE runtime wrap → **pkg + node18 + static imports** (see DECISIONS ADR-001).
      VALIDATED locally node-stripped: binary `--version` + proxy `/health` 200, zero system Node.
- [x] T12: `.github/workflows/build-oss-launch.yml` — native runners (arm64 on ubuntu-24.04-arm),
      mirrors release-cli-decrypt.yml. (Runs in CI on tag `oss-launch-v*`.)
- [x] T13: node-stripped `--version` smoke baked into the workflow + validated locally.
### Phase 5 — Distribution
- [x] T14: `hooks/ensure-oss-launch.sh` (fetch + verify + cache, fail-closed) — shell test 3/3.
- [x] T15: shim auto-install wiring (OSS_LAUNCH_ENSURE) — shell test T15 green.
### Phase 6 — Docs + ship
- [x] T16: DRAIN_SH_INTEGRATION.md behavior matrix + min-Node note.
- [x] T17: plugin.json 2.0.76 → 2.0.77 (embedded into the bundle via esbuild define).

## Verified this session
- 108 vitest (node-guard 8, oss-launch-entry 6, run 4, deps 6, start-proxy 23+7, model-proxy 45,
  proxy-router-mode 5) + 5 shell + tsc clean.
- M1 safety net works: routing-configured + bad Node → loud all-cloud, never silent; no-impact
  for unconfigured users preserved.
- Standalone esbuild .cjs proves the ESM→CJS + dynamic-import flatten works (R1 largely retired).

## Key build findings (see NOTES.md)
- esbuild CJS bundle has no `import.meta.url` → banner-shimmed to a `__filename` file URL.
- start-proxy's auto-run guard double-fired inside the bundle → tightened to match only the real
  start-proxy entry (dropped the generic import.meta.url clause).

## Blockers / boundary
- T11–T15 need a real cross-arch build + native CI runners (cannot be validated on this Mac).
  Recommend a dedicated CI session: spike SEA vs pkg on `oss-launch.cjs`, wire build-oss-launch.yml
  (mirror release-cli-decrypt.yml), then the node-stripped smoke + the fetch/cache script.

## Last Updated: 2026-06-27 by /oss:build (Phases 1–3 + T10)
