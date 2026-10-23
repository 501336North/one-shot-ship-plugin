# Progress: aarch64 / ARM64 Linux Support for oss-decrypt

## Current Phase: build (code complete; deploy + E2E pending)

## Tasks
- [x] Task 1: RED — failing aarch64 install test (test.sh + uname mock) (2026-06-26) — failed meaningfully: `Unsupported architecture: aarch64`
- [x] Task 2: GREEN — `aarch64→arm64` mapping in ensure-decrypt-cli.sh (2026-06-26) — harness 9/9
- [x] Task 3: REFACTOR — test_platform_detection aarch64-aware + header doc (2026-06-26)
- [x] Task 4: RED — build-targets.test.ts (release-asset contract) (2026-06-26) — 3 failing
- [x] Task 5: GREEN — node18-linux-arm64 in build:binary + release yml matrix/files (2026-06-26) — 3/3 pass; real `pkg` build → `ELF ARM aarch64` confirmed
- [x] Task 8 (partial): bump cli-decrypt 1.2.2 + plugin 2.0.74; fix login.md manual-install arch mapping + platform note (2026-06-26)
- [x] Task 6: DEPLOY — v1.2.2 merged (82bf162) + tagged; release published arm64 asset (2026-06-26)
- [!] Task 6b: HOTFIX — v1.2.2 arm64 binary CRASHED on GB10 (`Cannot find module '/snapshot/dist/oss-decrypt.cjs'`). Root cause: pkg cannot cross-compile V8 bytecode; arm64 was built on x64 `ubuntu-latest`. Fix = native `ubuntu-24.04-arm` runner + bump 1.2.3 + RED test guard. See DECISIONS.md ADR-001. (2026-06-26)
- [ ] Task 7: E2E — re-run hook on GB10 → `--setup` generates credentials.enc → queue/build/trust (pending box; acceptance gate, NOT yet passed — v1.2.2 false-positive login)
- [x] Task 7.5: trust regression suites pass on build (+build-targets = 33/33; full cli-decrypt suite 182/182)

## Test status (local)
- Hook harness: 9/9 pass
- cli-decrypt vitest (build-targets + 4 trust suites): 32/32 pass

## Blockers
- Task 6 needs the feature PR merged so the `cli-decrypt-v1.2.2` tag builds from main.
- Task 7 needs GB10 access (real aarch64) — final acceptance gate.

## Notes
- ALL work in `one-shot-ship-plugin` (branch `feat/aarch64-linux-decrypt-support/build`).
- /oss:trust verified arch-independent (Ed25519 + SHA-256, hardcoded pubkey, no native deps).
- Credentials machine-bound (hardware.ts hashes process.arch) → GB10 runs its OWN /oss:login.
- Release asset names are capitalized (`oss-decrypt-Linux-arm64`) via CI `--output`; local
  `build:binary` emits lowercase — same as the existing x64 pattern.

## Last Updated: 2026-06-26 by /oss:build
