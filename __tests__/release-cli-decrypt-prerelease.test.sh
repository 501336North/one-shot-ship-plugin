#!/bin/bash
# A beta decrypt CLI is published as a GitHub PRE-RELEASE and never takes "Latest" (release channels T13, ADR-005).
#
# @behavior In .github/workflows/release-cli-decrypt.yml, the Create Release step marks a tag with a pre-release
#           part (cli-decrypt-v1.3.0-beta.1: the version contains "-") as a pre-release and NOT latest; a stable
#           tag (cli-decrypt-v1.3.0) is a normal release that may become latest, exactly as today.
# @business-rule Stable installs pin their own tag, but nothing may ever make a beta build GitHub's "Latest":
#           2026-06-28 an unrelated release took "Latest" and every new install 404'd until 2026-10-09.
#
# Usage: ./__tests__/release-cli-decrypt-prerelease.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF="$ROOT/.github/workflows/release-cli-decrypt.yml"
code="$(grep -vE '^\s*#' "$WF")"
step="$(awk '/name: Create Release/,0' <<<"$code")"
RUN=0; FAILED=0
chk() { RUN=$((RUN + 1)); if eval "$2"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi; }

chk "Create Release marks a tag whose version has a pre-release part as a pre-release" \
    'grep -qF "prerelease: \${{ contains(github.ref_name, '"'"'-'"'"') }}" <<<"$step"'
chk "Create Release never makes such a tag Latest (make_latest is false for it)" \
    'grep -qF "make_latest: \${{ !contains(github.ref_name, '"'"'-'"'"') }}" <<<"$step"'
chk "the stable path is unchanged: the release still uploads the 8 binaries and checksums" \
    '[[ $(grep -cE "artifacts/oss-decrypt-[A-Za-z]+-[a-z0-9]+(\.sha256)?/" <<<"$step") == 8 ]]'

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"; [[ $FAILED -eq 0 ]]
