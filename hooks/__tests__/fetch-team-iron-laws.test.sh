#!/bin/bash
# oss-fetch-team-iron-laws.sh: which team's IRON LAWS configuration is asked for (ship round 4, UR10).
#
# @behavior The hook asks for /api/v1/iron-laws/team/<teamId> only when the config's top-level "teamId" is a plain
#           id (letters, digits, _ and -). Anything else (a path, a query, a fragment, a space, an encoded dot, a
#           non-string, a teamId only nested inside another object) gets the defaults endpoint. The teamId comes
#           from the same trusted read of the config as the key and the URL, never from a second read of the file.
# @business-rule The key goes only to <trusted API>/api/v1/iron-laws/...: config text cannot steer the keyed request
#           to another path of the API (../, ?, #) or read a teamId the trust check never saw.
# @boundary curl is a recorder (prints a 200 with "{}"), nothing leaves the machine; jq and the hook are real.
#
# Usage: ./hooks/__tests__/fetch-team-iron-laws.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
JQ="$(command -v jq)"

# url_for <config.json text> [jq shim dir]: runs the hook (--force: no cache) and prints the URL it asked for.
url_for() {
    rm -rf "$T/home"; mkdir -p "$T/home/.oss" "$T/bin"; chmod 700 "$T/home/.oss"
    printf '%s' "$1" > "$T/home/.oss/config.json"; chmod 600 "$T/home/.oss/config.json"
    printf '#!/bin/bash\nfor a in "$@"; do case "$a" in http*://*) printf "%%s\\n" "$a" >> "%s/urls" ;; esac; done\nprintf "{}\\n200"\n' "$T" > "$T/bin/curl"
    chmod +x "$T/bin/curl"; : > "$T/urls"
    (cd "$T" && env -i HOME="$T/home" PATH="${2:+$2:}$T/bin:${SYS_PATH:-$(dirname "$JQ"):/usr/bin:/bin}" \
        /bin/bash "$ROOT/hooks/oss-fetch-team-iron-laws.sh" --force </dev/null >/dev/null 2>&1)
    cat "$T/urls"
}
DEFAULTS='https://one-shot-ship-api.onrender.com/api/v1/iron-laws/defaults'
TEAM='https://one-shot-ship-api.onrender.com/api/v1/iron-laws/team/'

got=$(url_for '{"apiKey":"k","teamId":"team_A-1"}')
[[ "$got" == "${TEAM}team_A-1" ]] && pass "a plain teamId → the team endpoint" || fail "a plain teamId → the team endpoint" "got: $got"
got=$(url_for '{"apiKey":"k"}')
[[ "$got" == "$DEFAULTS" ]] && pass "no teamId → the defaults endpoint" || fail "no teamId → defaults" "got: $got"
for id in '../../admin' 'a/b' 'a?x=1' 'a#b' 'a b' '%2e%2e' 'a.b' ''; do
    got=$(url_for "{\"apiKey\":\"k\",\"teamId\":\"$id\"}")
    [[ "$got" == "$DEFAULTS" ]] && pass "teamId '$id' → the defaults endpoint" || fail "teamId '$id' → defaults" "got: $got"
done
got=$(url_for '{"apiKey":"k","teamId":42}')
[[ "$got" == "$DEFAULTS" ]] && pass "a non-string teamId → the defaults endpoint" || fail "a non-string teamId → defaults" "got: $got"
got=$(url_for '{"apiKey":"k","team":{"teamId":"nested"}}')
[[ "$got" == "$DEFAULTS" ]] && pass "a teamId nested in another object (jq) → the defaults endpoint" || fail "a nested teamId → defaults" "got: $got"

# Without jq: the flat "teamId": "..." shape, the same plain-id rule.
mkdir -p "$T/nojq"
for d in /usr/bin /bin; do for f in "$d"/*; do n=${f##*/}; [[ "$n" == jq || -e "$T/nojq/$n" ]] || ln -s "$f" "$T/nojq/$n"; done; done
got=$(SYS_PATH="$T/nojq" url_for '{"apiKey":"k","teamId":"t1"}')
[[ "$got" == "${TEAM}t1" ]] && pass "without jq: a plain teamId → the team endpoint" || fail "without jq: a plain teamId → team" "got: $got"
got=$(SYS_PATH="$T/nojq" url_for '{"apiKey":"k","teamId":"../x"}')
[[ "$got" == "$DEFAULTS" ]] && pass "without jq: teamId '../x' → the defaults endpoint" || fail "without jq: '../x' → defaults" "got: $got"

# One read: a jq shim swaps another config in on its first start (after the trust check read the file). A second
# read of config.json for the teamId would see the swapped-in one.
mkdir -p "$T/swap"
printf '#!/bin/bash\n[[ -f "%s/evil.json" ]] && mv -f "%s/evil.json" "%s/home/.oss/config.json"\nexec "%s" "$@"\n' "$T" "$T" "$T" "$JQ" > "$T/swap/jq"
chmod +x "$T/swap/jq"
got=$( printf '{"apiKey":"k","teamId":"evil-team"}' > "$T/evil.json"; url_for '{"apiKey":"k","teamId":"good-team"}' "$T/swap" )
rm -f "$T/evil.json"
[[ "$got" == "${TEAM}good-team" ]] && pass "the teamId comes from the same read as the key (not a second read of the file)" \
    || fail "the teamId comes from the same read as the key" "got: $got"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
