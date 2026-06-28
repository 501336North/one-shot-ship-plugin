#!/usr/bin/env bash
#
# verify-release.sh <tag> — the releaser's GATE HELPER.
#
# For each published oss-launch binary in release <tag>: download it, recompute SHA-256, cross-check
# the published `.sha256`, and emit a ready-to-commit manifest line (`<sha256>  <artifact>`) on stdout.
#
# Usage (Phase 3 of the release-hardening plan):
#   scripts/verify-release.sh oss-launch-v2.0.78 | tee hooks/oss-launch-checksums.txt
#   # → REVIEW the four hashes against the GitHub Release page, then commit via a reviewed PR.
#
# Emitting to stdout (not auto-committing) is deliberate: a human reviews before the hashes become
# trusted. Hashing is OS-agnostic, so this runs anywhere.
set -uo pipefail

TAG="${1:?usage: verify-release.sh <tag>}"
RELEASES="${OSS_LAUNCH_RELEASES_URL:-https://github.com/501336North/one-shot-ship-plugin/releases/download/$TAG}"
ARTIFACTS=(oss-launch-Darwin-arm64 oss-launch-Darwin-x64 oss-launch-Linux-x64 oss-launch-Linux-arm64)

hash_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else echo "[verify-release] no shasum/sha256sum" >&2; exit 1; fi
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

for a in "${ARTIFACTS[@]}"; do
  if ! curl -sfL "$RELEASES/$a" -o "$tmp/$a"; then
    echo "[verify-release] download failed: $a ($RELEASES/$a)" >&2; exit 1
  fi
  if ! curl -sfL "$RELEASES/$a.sha256" -o "$tmp/$a.sha256"; then
    echo "[verify-release] published checksum missing: $a" >&2; exit 1
  fi
  actual="$(hash_of "$tmp/$a")"
  published="$(awk '{print $1}' "$tmp/$a.sha256")"
  if [[ -z "$published" || "$actual" != "$published" ]]; then
    echo "[verify-release] published .sha256 does not match the binary for $a — STOP" >&2; exit 1
  fi
  printf '%s  %s\n' "$actual" "$a"
done
