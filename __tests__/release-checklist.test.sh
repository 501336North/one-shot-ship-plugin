#!/bin/bash
# Releasing `next` to customers follows a written checklist (release channels US-008, AC-008.3).
#
# @behavior .github/PULL_REQUEST_TEMPLATE/release.md is the release PR (next -> main) template and lists the
#           four gates as checkboxes: (1) ideate -> plan -> build -> ship run on STAGING on a real repo, (2) plugin
#           version bumped from X.Y.Z-beta.N to a stable X.Y.Z, (3) the API released first or with the plugin,
#           DB migrations applied to production first, (4) main merged back into next afterwards.
#           docs/RELEASING.md describes the whole flow, including the hotfix path and its merge-back.
# @business-rule Customers get only what the maintainer deliberately releases, after it ran on STAGING.
#
# Usage: ./__tests__/release-checklist.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/.github/PULL_REQUEST_TEMPLATE/release.md"
DOC="$ROOT/docs/RELEASING.md"
RUN=0; FAILED=0
chk() { RUN=$((RUN + 1)); if eval "$2"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi; }
box() { grep -E '^- \[ \] ' "$TPL" 2>/dev/null | grep -qiE "$1"; }

chk "the release PR template exists" '[[ -f "$TPL" ]]'
chk "gate 1: the full workflow ran on STAGING on a real repo" 'box "STAGING" && box "ideate.*ship"'
chk "gate 2: version bumped from a beta to a stable version" 'box "beta" && box "stable"'
chk "gate 3: API released first or together; migrations applied to production first" 'box "API.*(first|together)" && box "migration"'
chk "gate 4: main merged back into next afterwards" 'box "merge.*back.*next|main.*into.*next"'
chk "docs/RELEASING.md exists and links the template" '[[ -f "$DOC" ]] && grep -qF "PULL_REQUEST_TEMPLATE/release.md" "$DOC"'
chk "RELEASING.md describes the hotfix path and its merge-back into next" 'grep -qi "hotfix" "$DOC" && grep -qiE "merge.*back.*next|main.*into.*next" "$DOC"'
chk "RELEASING.md says feature work targets next, never main" 'grep -qE "origin/next" "$DOC"'

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"; [[ $FAILED -eq 0 ]]
