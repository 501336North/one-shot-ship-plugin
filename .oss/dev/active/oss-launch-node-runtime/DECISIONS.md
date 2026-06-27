# DECISIONS: Self-contained oss-launch

## ADR-001: Runtime wrap = pkg + node18 target + static imports (spike-validated)
**Context:** D4 chose "reuse the oss-decrypt native-runner playbook." That playbook is
`esbuild → .cjs → pkg --target node18-<os>-<arch>` on native runners (arm64 on `ubuntu-24.04-arm`,
because pkg compiles JS→V8 bytecode per CPU arch and cannot cross-generate it).

**Spike findings (validated locally on darwin-arm64, node-stripped):**
- pkg's snapshot **cannot execute dynamic `import()`** → "Invalid host defined options". Fix:
  `oss-launch.ts` `main()` now uses **static top-level imports** (esbuild compiles them to `require`,
  which pkg runs). No dynamic `import()` remains on the launcher path.
- esbuild CJS bundle has no `import.meta.url` → banner-shim to a `__filename` file URL.
- A relocated binary can't read `plugin.json` → **embed the version** at bundle time via esbuild
  `define: __OSS_LAUNCH_VERSION__`.
- pkg base tops out at **node18** (vercel/pkg). The bundled binary therefore ships Node 18. Since the
  launcher's own floor is 20, the **bundled binary trusts its embedded runtime** (skips the
  floor-20 self-check); the floor-20 check applies only to the **system-node fallback** path. Node 18
  is functionally sufficient for the dist (web ReadableStream / Readable.fromWeb / fetch all present).

**Decision:** pkg + node18 target, static imports, banner+version `define`. Rejected: bun
`--compile` (runtime ≠ Node semantics) and Node SEA (immature ESM/asset story) — and both diverge
from the proven decrypt pipeline.

**Proof:** `oss-launch-arm64 --version` → `oss-launch 2.0.x` and `oss-launch-arm64 start-proxy
--router` → `/health` 200, both with `node` stripped from PATH.

## ADR-002: Behavior when routing configured but Node unusable = warn + all-cloud (not hard-fail)
Per ideate D2. The bundled binary makes "Node absent" impossible on the happy path; the
warn-and-continue path is the rare fallback (no bundled binary for the arch AND system Node
missing/old). Loud (stderr banner), never silent, never blocks the user's work.

## ADR-003: Artifact naming = oss-launch-<OS>-<arch> released; cached as oss-launch-<arch>
Release artifacts disambiguate OS (`oss-launch-Linux-arm64`, …) like oss-decrypt. `ensure-oss-launch.sh`
fetches the matching OS+arch and caches it as `~/.oss/bin/oss-launch-<arch>` (one OS per box), so the
bash shim stays simple (arch-only lookup).

## Tracked follow-ups BEFORE the first `oss-launch-v*` release tag (security defense-in-depth)
From the ship security audit (both GO, these are defense-in-depth, not active vulns — the binary
distribution is dormant until a tag is pushed):
1. **SHA-pin `softprops/action-gh-release`** (and ideally the `actions/*`) in build-oss-launch.yml —
   it runs in the `contents: write` release job; a retagged `@v1` could substitute artifacts.
2. **Embed a known-good SHA-256 / pin a tag** instead of `releases/latest/download` in
   ensure-oss-launch.sh, so integrity doesn't reduce entirely to "whoever controls the release is
   honest." Can only be done once the first binary exists (commit the reviewed hash).
Applied at ship: robust `__OSS_BUNDLED__` build flag (was execPath-basename guess), bash realpath
self-skip, `pkg@5.8.1` pin.

## Last Updated: 2026-06-27 by /oss:build + ship hardening
