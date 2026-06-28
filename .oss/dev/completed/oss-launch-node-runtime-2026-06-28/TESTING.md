# TESTING: Self-contained oss-launch (bundled Node) + loud preflight

## Strategy
London TDD. Three test surfaces:
1. **Vitest (watcher)** — pure/DI units: `checkNode` floor, `decidePreflight`, `resolveEntry`,
   bundled-aware spawn args, `--version`. No real node probing or process spawning — inject deps.
2. **Shell harness** (`bin/__tests__/`, `hooks/__tests__/` style) — the `bin/oss-launch` shim and
   `ensure-oss-launch.sh`: mock `command -v node`, `uname -m`, `curl`, and a fake binary on PATH.
3. **CI smoke** — the bundled binary on native runners with **`node` removed from PATH**.

## Targeted vitest (NOT full suite)
```bash
cd watcher && npx vitest run \
  test/services/node-guard.test.ts \
  test/cli/oss-launch.test.ts \
  test/cli/oss-launch-run.test.ts \
  test/cli/oss-launch-deps.test.ts
```

## Key behaviors asserted
- **Preflight (T1–T3):** node v18 → not-ok; v20 → ok. routing-configured + node-bad →
  `decidePreflight.route=false` + loud banner; routing-configured + node-ok → route=true;
  routing-NOT-configured → route=true, no banner (no-impact guarantee preserved). `runLaunch` on
  route=false: no `ensureProxy`, env UNCHANGED, banner on stderr, claude still exec'd.
- **Subcommand/spawn (T4–T6):** `resolveEntry(['start-proxy',…])='start-proxy'`; bundled mode spawns
  `process.execPath start-proxy --router …`, script mode spawns `[startProxyJs,…]`; `--version` → 0.
- **Bash shim (T7–T9):** bundled binary present → exec'd; absent+node-present → `node …oss-launch.js`;
  absent+node-absent → loud stderr banner + `exec claude` (all-cloud), never silent.
- **Distribution (T14):** arch detected; binary fetched + checksum-verified + cached +chmod; idempotent.

## CI smoke (the real proof — mirrors the per-agent-routing acceptance)
With `node` removed from PATH on the runner:
```bash
oss-launch-<arch> --version          # exits 0 (binary brings its own node)
oss-launch-<arch> start-proxy --router --port 18473 &   # binary runs the proxy
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18473/health   # 200
```
PASS = both work with zero system node. This is the customer-box guarantee.

## Acceptance (end-to-end, deferred to a local-model box like DeepBlue)
Re-run the per-agent-routing acceptance VERIFY commands
(`.oss/dev/completed/per-agent-proxy-routing-2026-06-27/TESTING.md`) but with **no system Node** on
the box, launched via the bundled `oss-launch`. Expect: 0→N Ollama calls, per-agent dispatch, loud
fallback — identical to the proven run, now with zero Node dependency.

## Results
### Build (Phases 1–3 + T10) — 2026-06-27
- **108 vitest** green: node-guard (8), oss-launch-entry (6), oss-launch-run (4), oss-launch-deps
  (6), oss-launch (4), start-proxy (23), start-proxy-router (7), model-proxy (45),
  proxy-router-mode (5). `tsc --noEmit` clean.
- **5 shell** green: `bin/__tests__/oss-launch.test.sh` (bundled-present / node-present / node-absent).
- **Smoke (node-script + standalone .cjs):** `oss-launch --version` → `oss-launch 2.0.76`;
  `oss-launch start-proxy --router` and `oss-launch.cjs start-proxy --router` → proxy up, `/health`
  200, single run. node-script `start-proxy.js` still auto-runs (no regression).
- M1 safety net proven via unit: routing-configured + bad Node → `route:false` + loud banner,
  no `ensureProxy`, env unchanged, exit 0; unconfigured → route, no banner.

### Phase 4–6 (T11–T17) — DONE & VERIFIED — 2026-06-27
- **T11 runtime-wrap spike (pkg + node18 + static imports):** built a self-contained binary from
  `oss-launch.cjs` and ran it with **`node` stripped from PATH** → `--version` = `oss-launch 2.0.77`
  AND `start-proxy --router` → `/health` 200. R1 fully retired. Surfaced + fixed: pkg can't run
  dynamic `import()` (→ static imports), import.meta.url banner shim, embedded version. See
  DECISIONS ADR-001 + NOTES.
- **T12/T13 CI workflow:** `build-oss-launch.yml` (native arm64 runner, pkg, checksums, release +
  in-workflow node-stripped `--version` smoke). Mirrors release-cli-decrypt.yml. Runs on tag.
- **T14 ensure-oss-launch.sh:** shell test 3/3 — fetch+verify+cache, idempotent, **fail-closed on
  checksum mismatch**.
- **T15 shim auto-install:** shell test 6/6 (incl. T15 — ensure populates binary → shim execs it).

### Final regression @ 2.0.77
**145 vitest** (launch/proxy/node-guard/route/passthrough/log) + **9 shell** (shim 6, ensure 3) +
tsc clean + node-stripped pkg binary smoke (`--version` + proxy `/health` 200). Nothing skipped.

### Still requires a real box (acceptance, as before)
The Linux native-runner *builds* run in CI (tag `oss-launch-v*`); the DeepBlue end-to-end re-run
(now with **no system Node** on the box) is the final field acceptance — same VERIFY commands as the
shipped per-agent-routing feature, launched via the bundled `oss-launch`.

## Last Updated: 2026-06-27 by /oss:build (all 17 tasks)
