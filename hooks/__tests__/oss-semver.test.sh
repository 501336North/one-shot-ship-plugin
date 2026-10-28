#!/bin/bash
# Versions compare by SemVer 2.0 precedence, so a beta build sorts BELOW its release (release channels T19).
#
# @behavior oss_semver_cmp A B (hooks/oss-semver.sh) prints -1, 0 or 1 as A is lower than, equal to or higher than
#           B: numeric parts compare as numbers, a pre-release (2.1.0-beta.1) is lower than its release (2.1.0),
#           pre-release identifiers compare left to right (numbers as numbers, below words), and build metadata
#           (+...) is ignored. A string that is not X.Y.Z[-pre][+build] is refused (rc 2, nothing printed).
# @business-rule `next` ships 2.1.0-beta.N and the release PR bumps to 2.1.0: the bump gate must see that as
#           an increase. `sort -V` ranks 2.1.0-beta.1 above 2.1.0 and would block the first release.
#
# Usage: ./hooks/__tests__/oss-semver.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

cmp() { (source "$ROOT/hooks/oss-semver.sh" 2>/dev/null && oss_semver_cmp "$1" "$2"); }

# a | b | expected
while IFS='|' read -r a b want; do
    [[ -z "$a" || "$a" == \#* ]] && continue
    got=$(cmp "$a" "$b"); rc=$?
    if [[ "$rc" == 0 && "$got" == "$want" ]]; then pass "cmp $a $b = $want"; else fail "cmp $a $b = $want" "got '$got' rc=$rc"; fi
done <<'ROWS'
2.0.94|2.0.94|0
2.0.94|2.0.95|-1
2.0.95|2.0.94|1
2.0.94|2.1.0-beta.1|-1
2.1.0-beta.1|2.1.0|-1
2.1.0|2.1.0-beta.1|1
2.1.0-beta.1|2.1.0-beta.2|-1
2.1.0-beta.9|2.1.0-beta.10|-1
2.1.0-alpha.1|2.1.0-beta.1|-1
2.1.0-beta|2.1.0-beta.1|-1
2.1.0-1|2.1.0-beta|-1
10.0.0|9.9.9|1
2.1.0+build.5|2.1.0|0
1.0.0-rc.1+x|1.0.0-rc.1|0
ROWS

for bad in "" "2.1" "v2.1.0" "2.1.0-" "2.1.0-beta..1" "2.01.0" "2.1.0 x" '2.1.0;touch PWNED'; do
    got=$(cmp "$bad" "2.1.0"); rc=$?
    if [[ "$rc" == 2 && -z "$got" ]]; then pass "refuses '$bad'"; else fail "refuses '$bad'" "got '$got' rc=$rc"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
