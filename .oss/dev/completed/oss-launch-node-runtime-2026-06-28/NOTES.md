# NOTES: build findings (Phases 1–3 + T10)

## esbuild CJS bundle ↔ ESM source (the R1 risk, mostly retired)
`scripts/bundle-cli.js` now also emits `dist/cli/oss-launch.cjs`. Two gotchas surfaced and were fixed:

1. **`import.meta.url` doesn't exist in a CJS bundle.** The launcher uses it for self-path +
   main-module detection. Fix: esbuild `define: { 'import.meta.url': '__ossImportMetaUrl' }` +
   `banner: const __ossImportMetaUrl = require('url').pathToFileURL(__filename).href`. (esbuild
   `define` values must be an identifier/JSON, not an expression — hence the banner indirection.)
   `oss-launch.ts` `isMainModule` also extended to accept `.cjs` and the bundled-binary case
   (argv[1] undefined + execPath contains oss-launch).

2. **Double-run of start-proxy inside the bundle.** esbuild inlines `start-proxy.ts` (it's a
   relative dynamic import). With the shared `import.meta.url` shim, start-proxy's OWN
   `isMainModule` guard fired at import time AND oss-launch's dispatch called `main()` again →
   "port in use" → `process.exit(1)` killed the process. Fix: start-proxy's auto-run guard now
   matches only the real start-proxy entry (`endsWith start-proxy.js/.cjs/.ts`) — dropped the
   generic `import.meta.url === file://argv[1]` clause that collided in the bundle.

**Verified:** `node dist/cli/oss-launch.cjs --version` → `oss-launch 2.0.76`; `… start-proxy --router`
runs the proxy in-process, single run, stays alive, `/health` 200. So the ESM→CJS + dynamic-import
flatten works — the remaining T11 unknown is purely the runtime-wrap (SEA/pkg), not the bundle.

## Subcommand dispatch lifetime
`oss-launch start-proxy …` dispatches to `start-proxy.main()` and returns `undefined` (not 0) so the
entrypoint does NOT `process.exit` — a foreground proxy stays alive on its HTTP server; a
`--background` run resolves and exits naturally. Caught via smoke (foreground proxy was being killed).

## Open for the CI session (T11+)
- SEA vs pkg wrap of `oss-launch.cjs` on native runners. Watch: the relocated binary's `--version`
  reads `plugin.json` via a relative path that won't resolve once the binary lives in `~/.oss/bin/`
  → embed the version at bundle time (esbuild `define`) instead.
- `proxySpawnArgs({bundled:true})` re-invokes `process.execPath start-proxy …`; under `--background`
  the start-proxy background path spawns `process.execPath [start-proxy.js…]` which won't exist in a
  bundled binary — the background spawn must also use the subcommand form. Validate in the spike.

## Last Updated: 2026-06-27 by /oss:build
