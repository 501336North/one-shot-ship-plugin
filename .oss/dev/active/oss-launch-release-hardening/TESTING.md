# TESTING: oss-launch release hardening + binary build

## Strategy
Shell harness for the verify-path code (the only auto-testable surface); the release run + hash
pin-back are **gated ops** verified by humans + CI. Two-method verification is the security property
under test: a binary must pass BOTH the in-release `.sha256` AND a committed, code-reviewed hash.

## Phase 1 — shell tests (extend `hooks/__tests__/ensure-oss-launch.test.sh`)
Mock `curl` (copies fixtures by URL basename), `OSS_LAUNCH_BIN_DIR/OS/ARCH/RELEASES_URL/TAG` seams.
- **Existing (regression):** fetch+verify+cache; idempotent; in-release checksum mismatch → reject.
- **T2 committed manifest matches** → install.
- **T2 release-tamper:** in-release `.sha256` matches a swapped binary BUT the committed manifest
  hash does NOT → **reject** (nothing executable cached). ← the core defense.
- **T2 fail-closed:** manifest missing the `<OS>-<arch>` entry → reject (never trust-on-first-use).
- **T3 tag pinning:** with `OSS_LAUNCH_TAG=oss-launch-v9.9.9`, the download URL contains
  `download/oss-launch-v9.9.9/` (not `latest`).
- **T4 verify-release.sh:** given fixtures for a tag, emits a correctly-formatted
  `oss-launch-checksums.txt` (name + 64-hex per line).

## Phase 1 — workflow lint (T1)
`actionlint .github/workflows/build-oss-launch.yml` (if available) + assert **no bare `@v` tag**
remains on any `uses:` (all pinned to 40-hex SHAs with a `# vN` comment).

## Phase 2 — release build (CI gate, T5)
On tag `oss-launch-v*`: every matrix arch's node-stripped `--version` smoke passes; all 8 assets
(4 binaries + 4 `.sha256`) attached to the Release.

## Phase 3 — real-release end-to-end (T7, runnable on this Mac — hashing is OS-agnostic)
```
TAG=oss-launch-v<x>
curl -sfL ".../download/$TAG/oss-launch-Linux-arm64"        -o /tmp/b
curl -sfL ".../download/$TAG/oss-launch-Linux-arm64.sha256" -o /tmp/b.sha256
# (1) ensure-oss-launch accepts the real asset (committed manifest matches the published hash)
# (2) flip one byte of /tmp/b → ensure-oss-launch REJECTS (committed-manifest mismatch)
```

## Acceptance — DeepBlue, NO system Node (T8, other session)
drain.sh → bundled `oss-launch` on a box with Node removed. Expect the proven routing result
(0→N Ollama calls, code-reviewer/etc → gpt-oss:120b, orchestrator → Anthropic, loud fallback),
identical to the shipped per-agent-routing acceptance but with **zero system Node**.

## Results
### Phase 1 (T1–T4) — DONE & VERIFIED — 2026-06-28
- **T1** SHA-pin: `build-oss-launch-pins.test.sh` **3/3** — no bare `@vN`, every `uses:` on a 40-hex
  SHA, action-gh-release pinned (`@de2c0eb…`). All 5 actions resolved via `gh api` + dereferenced.
- **T2** two-method verify: `ensure-oss-launch.test.sh` **6/6** — incl. **release-tamper** (in-release
  .sha256 matches a swapped binary but committed manifest differs → reject) and **no-entry fail-closed**.
- **T3** tag pin: fetch targets `releases/download/<tag>/` (default `oss-launch-v2.0.77`), not `latest`.
- **T4** `verify-release.sh`: `verify-release.test.sh` **2/2** — emits 4 shasum-format lines; hashes
  match the binaries; cross-checks the published `.sha256`.
- Regression: shim 6/6, launcher/proxy vitest 18/18 — unaffected.
- Placeholder `hooks/oss-launch-checksums.txt` (comment-only) → ensure-oss-launch fail-closes until
  Phase 3 populates it (correct pre-release state).

### Gated remainder (NOT runnable here)
- **T5** (push tag → CI native-runner build) — human-initiated; CI gate.
- **T6** (review + commit the 4 published hashes; the security gate) — needs the release + human review.
- **T7** (local E2E of the verify path vs the REAL release asset + flip-byte reject) — needs the release.
- **T8** (DeepBlue, no system Node) — other session.

## Last Updated: 2026-06-28 by /oss:build (Phase 1)
