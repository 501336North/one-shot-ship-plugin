# DESIGN: aarch64 / ARM64 Linux Support for oss-decrypt

**Repo:** `one-shot-ship-plugin` (all work lives here, NOT AgenticDevWorkflow)
**Status:** Planned
**Created:** 2026-06-26

## Problem

`/oss:queue`, `/oss:build`, `/oss:plan` (any command that decrypts a prompt) call
`~/.oss/hooks/ensure-decrypt-cli.sh`, which **hard-fails** on aarch64 Linux:

```
Error: Unsupported architecture: aarch64
Supported architectures: arm64, x64   → exit 1
```

build.md Step 4 is a hard gate (`ensure-decrypt-cli.sh || { …; exit 1; }`), so the
entire OSS pipeline cannot run on the user's GB10 box (NVIDIA GB10 / Grace, aarch64).
This locks out **all** aarch64 Linux hosts: GB10, AWS Graviton, GH200, Ampere, Pi-class.

Two independent gaps cause this:

1. **Hook gap** — `ensure-decrypt-cli.sh` normalizes `x86_64→x64` but never maps
   `aarch64→arm64` (lines 92-93). So `uname -m`=`aarch64` fails the arch validation.
2. **Release gap** — `release-cli-decrypt.yml` builds Darwin-arm64, Darwin-x64,
   Linux-x64 only. There is **no `oss-decrypt-Linux-arm64` asset** published, so even
   with the mapping fixed the download URL would 404.

## Goal

Any aarch64 Linux box can run the full OSS pipeline: the hook auto-installs a verified
`oss-decrypt-Linux-arm64` binary, and decryption succeeds end-to-end on the GB10.

## Approach (the "proper fix" — option #1)

Three coordinated changes, all in `one-shot-ship-plugin`:

### 1. Hook: add aarch64→arm64 normalization
In `ensure-decrypt-cli.sh`, alongside the existing `x86_64→x64` line:
```bash
[[ "$ARCH" == "aarch64" ]] && ARCH="arm64"
```
This makes `uname -m`=`aarch64` resolve to the published asset name
`oss-decrypt-Linux-arm64`. The existing checksum-verify + fail-closed path is unchanged.

### 2. Release: publish oss-decrypt-Linux-arm64
Add a build-matrix entry + release-files entry to `release-cli-decrypt.yml`:
```yaml
- os: ubuntu-latest
  target: node18-linux-arm64
  artifact: oss-decrypt-Linux-arm64
```
`pkg` cross-compiles `node18-linux-arm64` from the x64 ubuntu runner (it downloads the
prebuilt node base binary for the target) — the same cross-compile pattern already used
to build Darwin-x64 on the arm64 `macos-latest` runner. No emulation, no ARM runner needed.
Add `node18-linux-arm64` to `package.json` `build:binary` targets for local builds too.

### 3. Release cut + plugin bump
- Tag `cli-decrypt-v1.2.2` → workflow republishes `latest` with the arm64 asset
  (hook downloads from `releases/latest/download`, so `latest` must carry it).
- Bump plugin `version` (2.0.73 → 2.0.74) so users auto-pull the patched hook.

## Out of scope (explicitly)
- **x64-via-emulation stopgap** (box64/qemir) — rejected; the proper fix is cheap.
- **Windows arm64** — no Windows target exists today; not requested.
- **Changing the decryption logic / minimum version** — the arm64 binary is the same
  code, just a new build target. `MINIMUM_VERSION` stays `1.2.1` (the GB10 has no binary,
  so it installs `latest` = 1.2.2 fresh; no upgrade-gating needed).

## /oss:trust safety (verified, not assumed)

The user asked: will arm64 break `/oss:trust`, and is trust supported on aarch64?
**Answer: no regression, and yes — trust works identically on aarch64.** Evidence:

- **Same binary, all flags present.** Trust calls `oss-decrypt --verify-manifest`,
  `--list-prompts [--category]`, `--type/--name` (trust.md:95,161-199). The arm64 build
  is the *same source* at v1.2.2; it carries every trust flag (added in 1.2.0). No flag
  is gated by arch.
- **Trust root is arch-independent.** Manifest verification uses a hardcoded Ed25519
  public key (`cli-entry.ts:132 MANIFEST_PUBLIC_KEY`), not anything derived from
  hardware/CPU. `verifyManifestSignature` (manifest-verifier.ts:32-62) is pure Node
  `crypto.verify(null, …Ed25519…)` + SHA-256 over a canonical JSON buffer.
- **Deterministic across CPU arch.** Ed25519 + SHA-256 over `Buffer` bytes are byte-exact
  on x64 and arm64 — no floating point, no endianness-sensitive ops, no native/WASM
  addons (grep for `.node`/`.wasm`/`cpus()`/`endian` in cli-decrypt/src = empty).
- **`process.arch` is NOT in the trust path.** It appears only in
  `hardware.ts:getHardwareId()` (credential binding), never in
  manifest-verifier/integrity-pipeline/prompt-integrity/encryption/watermark.
- **The hook change cannot touch trust at runtime.** `ensure-decrypt-cli.sh` only governs
  install/update; trust invokes the already-installed binary. The one-line arch mapping
  left 8/9 pre-existing hook tests green.

The only genuine risk is the arm64 binary failing to *build or launch* — covered by the
build-artifact test (Task 4) and the GB10 E2E gate (Task 7), which now explicitly runs
`--verify-manifest` + `/oss:trust` on the box. The existing trust unit suites
(`trust-acceptance`, `manifest-verifier`, `prompt-integrity`, `decrypt-integrity`) are
arch-independent and pass on either arch; cross-compile runs them on x64 CI, and crypto
determinism guarantees parity on arm64.

## Key risks / notes
- **Credentials are machine-bound.** `hardware.ts:getHardwareId()` hashes
  `process.arch` (+ MAC/hostname/homedir). The GB10 must run its OWN `/oss:login`
  /`--setup` so the fingerprint is computed locally; copying `credentials.enc` from the
  Mac will NOT work (different arch + MAC → different hardware ID). Validation task covers this.
- **No native deps** in cli-decrypt (verified: no node-gyp/prebuild/.node) → `pkg`
  cross-compile is safe; the bundle is pure JS over the node base binary.
- **Checksum tooling** on the ARM build: workflow uses `shasum -a 256`; available on the
  x64 ubuntu runner regardless of `--target`, so the `.sha256` is generated correctly.
