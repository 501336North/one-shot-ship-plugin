# DECISIONS: aarch64 / ARM64 Linux Support for oss-decrypt

## ADR-001: Build the Linux/arm64 binary on a native arm64 runner (not cross-compile)

**Date:** 2026-06-26
**Status:** Accepted (fix for the v1.2.2 regression)

### Context
v1.2.2 published `oss-decrypt-Linux-arm64` as a genuine ARM aarch64 ELF, but the binary
**crashed instantly on the GB10**:
```
Error: Cannot find module '/snapshot/dist/oss-decrypt.cjs'
```
Because it crashed, `--setup` never ran → no `credentials.enc` → `/oss:login` printed a
false "Setup Complete 🎉" (the flow didn't check the binary's exit). The acceptance gate
was NOT actually passed.

### Root cause
`vercel/pkg` compiles the bundled JS to **V8 bytecode per CPU architecture** and **cannot
cross-generate** that bytecode. We built `--target node18-linux-arm64` on the x64
`ubuntu-latest` runner, so pkg emitted an arm64 ELF wrapper but could not produce the
arm64 snapshot bytecode — the entry module ended up absent from `/snapshot`. The x64 and
macOS binaries worked because each was built on a host matching (closely enough) its
target's bytecode needs.

### Decision
Build the arm64 target on a **native arm64 runner**: `os: ubuntu-24.04-arm`
(GitHub-hosted arm64 Linux, free for public repos). pkg then generates real arm64
bytecode and a complete snapshot. Only the arm64 matrix entry changes; Darwin/x64 entries
are untouched.

### Alternatives considered
- **`pkg --no-bytecode --public`** (bundle raw JS instead of bytecode): unblocks a
  cross-build today, but ships readable source and is a workaround, not a fix. Rejected.
- **Migrate off pkg** to Node 20+ SEA or `bun build --compile` (pkg is archived):
  correct long-term, larger scope. Deferred — tracked as a follow-up, not this fix.

### Consequences
- New release tag `cli-decrypt-v1.2.3` republishes `latest` with a working arm64 binary.
- The broken v1.2.2 arm64 binary on any box reports no version (it crashes) → the hook's
  version check reads `0.0.0` < MINIMUM and **auto-reinstalls** the fixed binary on next
  run. No manual cleanup needed on the GB10.
- `MINIMUM_VERSION` stays `1.2.1` (don't force healthy x64 users to redownload).
- Regression guard added: `build-targets.test.ts` asserts the arm64 matrix entry runs on
  an `*-arm` runner.

### Verification limit
A linux/arm64 binary cannot be executed on the macOS dev host, so "does it actually run"
is proven only on the GB10. The CI now builds it natively; final proof = re-run the hook
on the box, confirm `--version` works and `--setup` generates `credentials.enc`.
