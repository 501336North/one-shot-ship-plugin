#!/bin/bash
# Release workflows must not let an unrelated release take GitHub "Latest".
# @regression 2026-06-28: oss-launch-v2.0.78 became "Latest" without oss-decrypt assets; installers that
#   trusted releases/latest/download 404'd for every new user until 2026-10-09.
# The SHA-pinned softprops/action-gh-release (v1 @ de2c0eb) has no make_latest input, so the oss-launch
# workflow must re-point Latest at the newest cli-decrypt-v* release (what pre-pin plugin versions still download).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF="$ROOT/.github/workflows/build-oss-launch.yml"
step="$(awk '/name: Keep Latest on cli-decrypt/,0' "$WF")"
if grep -q "cli-decrypt-v" <<<"$step" && grep -qE 'gh release edit .*--latest' <<<"$step" && grep -q 'GH_TOKEN' <<<"$step"; then
  echo "✓ PASS: build-oss-launch.yml re-points Latest to the newest cli-decrypt release"; exit 0
else echo "✗ FAIL: build-oss-launch.yml has no 'Keep Latest on cli-decrypt' step re-pointing Latest"; exit 1; fi
