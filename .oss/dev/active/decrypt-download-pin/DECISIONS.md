# Decisions: decrypt-download-pin
- 2026-10-09: Pin to `cli-decrypt-v1.2.3`, not 1.2.1 (MINIMUM_VERSION): 1.2.3 is the first release whose Linux-arm64 binary runs (1.2.2 arm64 crashed, see aarch64-linux-decrypt-support ADR-001). MINIMUM_VERSION stays 1.2.1 (separate concern; not bumped here).
- 2026-10-09: login.md calls the hook instead of its own curl: one downloader, and login gains SHA-256 verification.
- 2026-10-09: Release-side guard via `gh release edit --latest=false` because the SHA-pinned softprops action (v1 @ de2c0eb) has no `make_latest` input.
