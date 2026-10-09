# Notes: decrypt-download-pin

- Archived model-frontmatter-routing (build COMPLETE) during plan Phase 0. Other regex matches were false positives (aarch64: E2E pending; interactive-local-model-offload: plan complete; login-setup-verification: code complete; model-routing-productionize: 2nd PR pending; per-model-think-control: box validation pending) and were left active.
- cli-decrypt-v1.2.3's Darwin-arm64 binary self-reports `v1.2.1`. Harmless with MINIMUM_VERSION=1.2.1, but raising MINIMUM_VERSION above a binary's self-reported version makes the hook re-download on every command.
- Since 2026-06-28, an existing customer re-running /oss:login had a working binary overwritten by GitHub's "Not Found" page (old inline `curl -sL` to latest, no status/checksum check). Fixed by Task 2; the Latest flip (Task 0) covers older plugin versions.
- Customer safety: existing installs (binary ≥ MINIMUM_VERSION) never download, so none of the new checks run for them.
