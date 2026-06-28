# DESIGN: oss-launch release hardening + binary build

**Repo:** `one-shot-ship-plugin` (plugin-only). **Created:** 2026-06-27.
**Origin:** the two tracked follow-ups from `oss-launch-node-runtime` (see that feature's
`DECISIONS.md`). The per-agent routing arc is functionally complete and field-proven (PRs #179/#181)
and the launcher/preflight shipped (PR #182, v2.0.77). **This is the deliberate, security-gated
release action that produces and trusts the actual customer binaries — not a config tweak.**

## Problem

The launcher fetches a self-contained `oss-launch` binary and executes it. Today:
- `ensure-oss-launch.sh` verifies an **in-release** `.sha256` — defends against download
  corruption/MITM, but NOT against a **tampered release** (an attacker with release-write access
  swaps both the binary and its checksum → verification passes).
- It pulls `releases/latest/download` — a new (possibly bad) `latest` auto-rolls to every box.
- `build-oss-launch.yml` uses **mutable action tags** (`softprops/action-gh-release@v1`, etc.) in a
  `contents: write` job — a retagged action could substitute artifacts at publish time.
- No binary has been built/released yet (the workflow is dormant until a `oss-launch-v*` tag).

## Goal

Make the binary's trust chain **not reduce to "whoever controls the GitHub release is honest,"** and
make releasing a **deliberate, reviewable, gated** action.

## Design — two-method verification + pinned everything

1. **Committed known-good manifest (the security gate).** A code-reviewed
   `hooks/oss-launch-checksums.txt` in the plugin repo maps `oss-launch-<OS>-<arch> → SHA-256`.
   `ensure-oss-launch.sh` verifies the downloaded binary against **this committed hash** (in addition
   to the in-release `.sha256`). A release-only compromise can't pass — the committed hash won't match
   a swapped binary. **Hashes enter the repo ONLY via a reviewed PR** ⇒ that PR *is* the release gate.
2. **Pinned release tag, not `latest`.** `ensure-oss-launch.sh` fetches from a specific
   `oss-launch-v<x>` tag (the one whose hashes are committed), so a fresh `latest` can't auto-deploy.
3. **SHA-pinned GitHub Actions.** Pin every `uses:` to a full commit SHA (`@<sha> # vN`), especially
   `softprops/action-gh-release` in the write-capable release job. (`pkg@5.8.1` already pinned.)

## Release flow (gated sequence)

```
A. Harden (PR)         SHA-pin actions in build-oss-launch.yml.            ← reviewed
B. Tag → CI            push tag oss-launch-v<x> → build 4 native binaries  ← workflow's own
                       + checksums + GitHub Release.                          node-stripped smoke
C. Pin-back (PR)       capture the 4 published SHA-256s, review them, commit ← reviewed: the GATE
                       hooks/oss-launch-checksums.txt + point ensure at the
                       tag. bump plugin version.
D. Field acceptance    DeepBlue re-run with NO system Node via bundled
                       oss-launch (other session).
```

Phase C is the security gate: a binary becomes *trusted* by customers only after its hash is
code-reviewed into the repo.

## Decisions
- **Committed-manifest over code-signing (cosign/minisign).** Simpler, code-reviewable, no key
  management, fits the existing GitHub-Releases pattern. Signing noted as a future hardening if the
  threat model escalates.
- **Plugin-only.** Binaries are not IP (the proxy/launcher is open infra); distribution stays on
  GitHub Releases like `oss-decrypt`. No API change, no prompt change.
- **Keep the in-release `.sha256` too** — defends the download path (corruption/MITM) even before the
  committed-manifest check; both must pass (fail-closed).

## Scope
**In:** SHA-pin actions; committed checksum manifest + two-method verify in ensure-oss-launch.sh;
pin to a release tag; the tag/release run; the pin-back PR; version bump; docs.
**Out:** code-signing; migrating off the archived `pkg` (note as future); macOS/Windows customer
support (Linux arm64/x64 are the targets); any API involvement.

## Last Updated: 2026-06-27 by /oss:plan
