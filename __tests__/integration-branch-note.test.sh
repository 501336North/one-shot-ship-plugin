#!/bin/bash
# Agents in this repo branch from `next`, not `main` (release channels, ADR-004).
#
# @behavior CLAUDE.md tells agents that `next` is the integration branch: feature branches start from
#           origin/next, and `main` changes only by a release PR or a hotfix PR. The note sits OUTSIDE the
#           IRON LAWS block, which /oss:login re-syncs from the API (customers' copy of Law #4 is unchanged).
# @business-rule Customers keep getting only what the maintainer releases: work merges into `next`, and
#           `main` (what customers install) moves only by a deliberate release.
#
# Usage: ./__tests__/integration-branch-note.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
F="$ROOT/CLAUDE.md"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = 0 pass / 1 fail
    RUN=$((RUN + 1))
    if [[ "$2" == 0 ]]; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi
}

start=$(grep -n 'IRON LAWS START' "$F" | head -1 | cut -d: -f1)
end=$(grep -n 'IRON LAWS END' "$F" | head -1 | cut -d: -f1)
note=$(grep -n '^## Branching in this repo' "$F" | head -1 | cut -d: -f1)

[[ -n "$note" ]]; check "CLAUDE.md has a 'Branching in this repo' section" $?
[[ -n "$note" && -n "$start" && -n "$end" ]] && { (( note < start )) || (( note > end )); }
check "the section is outside the synced IRON LAWS block" $?

section=""
[[ -n "$note" ]] && section=$(awk -v s="$note" 'NR > s && /^## / { exit } NR >= s' "$F")
grep -qF 'origin/next' <<<"$section"; check "it says feature branches start from origin/next" $?
grep -qiE 'release PR' <<<"$section" && grep -qiE 'hotfix' <<<"$section"
check "it says main changes only by a release PR or a hotfix PR" $?

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
