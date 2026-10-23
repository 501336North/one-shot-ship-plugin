# TESTING: aarch64 / ARM64 Linux Support for oss-decrypt

## Strategy
London TDD. Two unit-testable boundaries + one real-hardware acceptance gate.

### Boundary 1 — install hook (bash)
Harness: `hooks/__tests__/ensure-decrypt-cli.test.sh`. Mocks live external collaborators
(`curl`, and now `uname`) via PATH injection — never mocks the hook's own logic.

| Test | Behavior verified | RED cause (pre-fix) |
|------|-------------------|---------------------|
| `test_aarch64_installs_arm64_binary` (NEW) | aarch64 host → downloads `*-Linux-arm64`, checksum verified, exit 0 | hook errors `Unsupported architecture: aarch64` |
| `test_platform_detection` (UPDATED) | host-arch normalization handles aarch64 | would fail on real aarch64 host |
| 8 existing tests | unchanged behavior (version gate, checksum match/mismatch/missing, dir creation) | must stay green |

Mock approach for the new test:
- `setup_mock_uname Linux aarch64` → PATH `uname` returns `Linux` for `-s`, `aarch64` for `-m`.
- `setup_mock_curl` serves a fake arm64 binary + correct SHA-256 for the arm64 URL, and
  appends each requested URL to a log so we can assert it ended in `-arm64`.

### Boundary 2 — release build (cross-compile)
`packages/cli-decrypt/test/build-targets.test.ts` (vitest): after `npm run build:binary`,
assert `dist/bin/oss-decrypt-Linux-arm64` exists and `file <bin>` reports `ARM aarch64`.
Confirms `pkg` cross-compiles the new target from an x64 host. (Skip-guard if `pkg`/`file`
unavailable, but it must FAIL before Task 5 since the target isn't built yet.)

### Acceptance gate — real GB10 (manual, Task 7)
Not a unit test; the true definition of done. On the aarch64 box:
1. `/oss:login` → setup succeeds (hardware ID computed locally).
2. `~/.oss/hooks/ensure-decrypt-cli.sh` → "checksum verified", binary installed.
3. `oss-decrypt --version` → `1.2.2`.
4. `/oss:queue` / `/oss:build` → prompt decrypts; no arch error, no 404.

## How to run
```bash
# Boundary 1 (hook)
bash hooks/__tests__/ensure-decrypt-cli.test.sh   # expect 9/9 after Task 2-3

# Boundary 2 (build) — heavy; run targeted, not the full suite
cd packages/cli-decrypt && npx vitest run test/build-targets.test.ts
```

### /oss:trust regression guard (arch-independent)
Trust verification is pure Node `crypto` (Ed25519 + SHA-256) against a hardcoded public
key — deterministic across CPU arch, no native/WASM deps, `process.arch` not in the path.
So arm64 cannot diverge. Guards:
- **Existing suites must stay green** on the build:
  `packages/cli-decrypt/test/{trust-acceptance,manifest-verifier,prompt-integrity,decrypt-integrity}.test.ts`.
- **GB10 E2E (Task 7):** `oss-decrypt --verify-manifest` → signature valid + hashes
  verified; `/oss:trust` audit succeeds on the box.
Run targeted (NOT full suite, per vitest-overload rule):
```bash
cd packages/cli-decrypt && npx vitest run \
  test/manifest-verifier.test.ts test/prompt-integrity.test.ts \
  test/trust-acceptance.test.ts test/decrypt-integrity.test.ts
```

## Results
### Acceptance (RED) — 2026-06-26
`bash hooks/__tests__/ensure-decrypt-cli.test.sh` → **8/9 pass, 1 fail (expected RED)**.
New `test_aarch64_installs_arm64_binary` fails meaningfully:
`Unsupported architecture: aarch64`, exit 1, `-arm64` asset never requested. Pre-existing
8 tests still green (mock-curl URL-logging change is backward compatible).

### Build (GREEN) — 2026-06-26
- **Hook harness** (`ensure-decrypt-cli.test.sh`): **9/9 pass** after Task 2-3.
- **build-targets.test.ts** (release-asset contract): 3/3 pass after Task 5.
- **Real cross-compile proof**: `npm run build:binary` produced
  `dist/bin/oss-decrypt-linux-arm64` → `file` reports
  `ELF 64-bit LSB executable, ARM aarch64 … interpreter /lib/ld-linux-aarch64.so.1`.
  Confirms `pkg` cross-compiles a runnable aarch64 binary from the dev host.
- **Trust regression** (Task 7.5): `manifest-verifier`, `prompt-integrity`,
  `trust-acceptance`, `decrypt-integrity` + `build-targets` = **32/32 pass** in one
  vitest process. Trust path unaffected by the arch work.

### Pending (deploy)
- Task 6: tag `cli-decrypt-v1.2.2` post-merge → assert `oss-decrypt-Linux-arm64` +
  `.sha256` on `latest` via `gh release view`.
- Task 7: GB10 E2E (install + decrypt + `/oss:trust`) — final acceptance gate.

## Last Updated: 2026-06-26 by /oss:build
