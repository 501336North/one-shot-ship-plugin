#!/bin/bash
# A beta decrypt CLI is published as a GitHub PRE-RELEASE and never takes "Latest"; a stable one is a normal
# release (release channels T13, ship round 1 FR13).
#
# @behavior In .github/workflows/release-cli-decrypt.yml a "Classify tag" step decides from the VERSION part of
#           the tag (after "cli-decrypt-v"; every tag name itself contains a "-"): cli-decrypt-v1.3.0-beta.1 is a
#           pre-release, cli-decrypt-v1.3.0 and cli-decrypt-v1.2.4 are not. Create Release takes prerelease and
#           make_latest from that step. This test RUNS the step's shell on sample tags, not just greps its text.
# @business-rule Nothing may make a beta build GitHub's "Latest" (2026-06-28: an unrelated release took Latest and
#           new installs 404'd), and a stable security release must still become Latest.
#
# Usage: ./__tests__/release-cli-decrypt-prerelease.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF="$ROOT/.github/workflows/release-cli-decrypt.yml"
RUN=0; FAILED=0
chk() { RUN=$((RUN + 1)); if eval "$2"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi; }

# The run: block of the step named "Classify tag", de-indented.
script=$(awk '/- name: Classify tag/{f=1} f&&/run: \|/{r=1;next} r&&/^      - /{exit} r{sub(/^          /,""); print}' "$WF")
classify() {  # classify <tag>: prints the step's prerelease output
    local out; out=$(mktemp)
    GITHUB_REF_NAME="$1" GITHUB_OUTPUT="$out" bash -c "$script" >/dev/null 2>&1
    sed -n 's/^prerelease=//p' "$out"; rm -f "$out"
}
chk "a Classify tag step with a shell script exists" '[[ -n "$script" ]]'
chk "cli-decrypt-v1.3.0-beta.1 is a pre-release" '[[ "$(classify cli-decrypt-v1.3.0-beta.1)" == true ]]'
chk "cli-decrypt-v1.3.0-rc.2 is a pre-release" '[[ "$(classify cli-decrypt-v1.3.0-rc.2)" == true ]]'
chk "cli-decrypt-v1.3.0 is NOT a pre-release (a stable release can become Latest)" '[[ "$(classify cli-decrypt-v1.3.0)" == false ]]'
chk "cli-decrypt-v1.2.4 is NOT a pre-release" '[[ "$(classify cli-decrypt-v1.2.4)" == false ]]'

release="$(awk '/name: Create Release/,0' <(grep -vE '^\s*#' "$WF"))"
chk "Create Release takes prerelease from the Classify tag step" \
    'grep -qF "prerelease: \${{ steps.channel.outputs.prerelease == '"'"'true'"'"' }}" <<<"$release"'
chk "Create Release never makes a pre-release Latest" \
    'grep -qF "make_latest: \${{ steps.channel.outputs.prerelease != '"'"'true'"'"' }}" <<<"$release"'
chk "the stable path is unchanged: the release still uploads the 8 binaries and checksums" \
    '[[ $(grep -cE "artifacts/oss-decrypt-[A-Za-z]+-[a-z0-9]+(\.sha256)?/" <<<"$release") == 8 ]]'

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"; [[ $FAILED -eq 0 ]]
