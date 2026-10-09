#!/bin/bash
# The oss-launch release job must keep GitHub "Latest" on the EXACT oss-decrypt release the plugin pins.
# @regression 2026-06-28: oss-launch-v2.0.78 became "Latest" without oss-decrypt assets; installers that
#   trusted releases/latest/download 404'd for every new user until 2026-10-09.
# Single source of truth (IRON LAW #1b): the tag is read from hooks/ensure-decrypt-cli.sh, never "newest
# cli-decrypt-v*" (an unreviewed tag push could otherwise become Latest for pre-pin plugin versions).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF="$ROOT/.github/workflows/build-oss-launch.yml"
code="$(grep -vE '^\s*#' "$WF")"                         # ignore commented-out lines
release_job="$(awk '/^  release:/,0' <<<"$code")"
step="$(awk '/name: Keep Latest on cli-decrypt/,0' <<<"$release_job")"
RUN=0; FAILED=0
chk() { ((RUN++)); if eval "$2"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; ((FAILED++)); fi; }
chk "release job checks out the repo (to read the pinned tag)" 'grep -q "uses: actions/checkout@[0-9a-f]\{40\}" <<<"$release_job"'
chk "step reads the tag from hooks/ensure-decrypt-cli.sh" 'grep -q "hooks/ensure-decrypt-cli.sh" <<<"$step"'
chk "step marks that tag Latest" 'grep -qE "gh release edit \"\\\$tag\" .*--latest" <<<"$step"'
chk "step never picks the newest release" '! grep -q "gh release list" <<<"$step"'
chk "step fails loudly with ::error:: if the tag cannot be read" 'grep -q "::error::" <<<"$step"'
chk "step has a timeout" 'grep -qE "timeout-minutes: [0-9]+" <<<"$step"'
chk "step runs even if Create Release failed after taking Latest" 'grep -q "if: always()" <<<"$step"'
chk "release checkout does not persist the write token" 'grep -A3 "uses: actions/checkout" <<<"$release_job" | grep -q "persist-credentials: false"'
chk "tag read takes a single line" 'grep -q "head -n1" <<<"$step"'
echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"; [[ $FAILED -eq 0 ]]
