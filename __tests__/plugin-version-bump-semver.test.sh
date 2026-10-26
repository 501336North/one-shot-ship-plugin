#!/bin/bash
# The version-bump gate (__tests__/plugin-version-bump.test.sh) orders versions by SemVer (release channels T19).
#
# @behavior With shipped paths changed, the gate accepts a version that is higher by SemVer precedence and
#           refuses one that is not: 2.0.94 -> 2.1.0-beta.1 (first beta on next), 2.1.0-beta.1 -> 2.1.0-beta.2,
#           and 2.1.0-beta.2 -> 2.1.0 (the release) pass; 2.1.0 -> 2.1.0-beta.3 and an unchanged version fail.
# @business-rule The release PR (next -> main) bumps 2.1.0-beta.N to 2.1.0; a gate using `sort -V` ranks the
#           beta higher and would block every release.
#
# Each row runs the real gate script in a throwaway repo whose origin/main holds the base version.
# Usage: ./__tests__/plugin-version-bump-semver.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

gate() {  # $1 = origin/main version, $2 = working-tree version; prints the gate's exit code
    local t; t="$(mktemp -d)"
    (cd "$t" && git init -q && git config user.email t@t && git config user.name t
     mkdir -p .claude-plugin hooks __tests__
     cp "$ROOT/__tests__/plugin-version-bump.test.sh" __tests__/
     cp "$ROOT/hooks/oss-semver.sh" hooks/ 2>/dev/null
     printf '{"name":"oss","version":"%s"}\n' "$1" > .claude-plugin/plugin.json; echo a > hooks/x.sh
     git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD
     printf '{"name":"oss","version":"%s"}\n' "$2" > .claude-plugin/plugin.json; echo b > hooks/x.sh
     bash __tests__/plugin-version-bump.test.sh >/dev/null 2>&1; echo $?)
    rm -rf "$t"
}

for row in "2.0.94 2.1.0-beta.1 0" "2.1.0-beta.1 2.1.0-beta.2 0" "2.1.0-beta.2 2.1.0 0" "2.1.0 2.1.0-beta.3 1" "2.1.0 2.1.0 1" "2.0.94 2.0.95 0"; do
    set -- $row
    rc=$(gate "$1" "$2")
    want=$([[ "$3" == 0 ]] && echo accepts || echo refuses)
    if [[ "$rc" == "$3" ]]; then pass "gate $want $1 -> $2"; else fail "gate $want $1 -> $2" "rc=$rc"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
