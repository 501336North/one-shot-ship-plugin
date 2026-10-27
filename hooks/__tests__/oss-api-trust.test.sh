#!/bin/bash
# oss_api_url sends the key only to a trusted OSS API, by the same rule as the CLI and the watcher (ship round 1:
# FR4, FR5, FR6, FR7).
#
# @behavior For every row of packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json, oss_api_url prints the
#           row's canonical origin when it is trusted (production, staging, loopback http; trailing "/", ":443"
#           and host case normalised) and refuses (rc 1, nothing printed) otherwise. Without jq, a config that
#           names an apiUrl is refused, never silently read as production. The config file itself is refused
#           when it is a symlink or world-writable (and its key is not read); group-writable is accepted.
#           A loopback apiUrl additionally needs a config.json and directory no other user can write (SR2).
# @business-rule The OSS API key goes only to an OSS API. A look-alike or custom host never receives it, and a
#           missing tool never hides that a session is pointed at STAGING.
#
# Usage: ./hooks/__tests__/oss-api-trust.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
TABLE="$ROOT/packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.oss"; chmod 700 "$T/.oss"

call() {  # call <function> [PATH override]: prints output, sets RC
    OUT=$(HOME="$T" PATH="${2:-$PATH}" "$SH" -c 'source "$1"; '"$1" _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
}

n=$(jq length "$TABLE")
for (( i = 0; i < n; i++ )); do
    url=$(jq -r ".[$i].apiUrl" "$TABLE"); trusted=$(jq -r ".[$i].trusted" "$TABLE"); canon=$(jq -r ".[$i].canonical // \"\"" "$TABLE")
    jq -n --arg u "$url" '{apiKey:"k",apiUrl:$u}' > "$T/.oss/config.json"; chmod 600 "$T/.oss/config.json"
    call oss_api_url
    if [[ "$trusted" == true ]]; then
        [[ "$RC" == 0 && "$OUT" == "$canon" ]] && pass "trusted: $url -> $canon" || fail "trusted: $url -> $canon" "rc=$RC out='$OUT'"
    else
        [[ "$RC" != 0 && -z "$OUT" ]] && pass "refused: $url" || fail "refused: $url" "rc=$RC out='$OUT'"
    fi
done

# FR5: no jq. A PATH with every command but jq.
mkdir -p "$T/nojq"; IFS=: read -ra dirs <<< "$PATH"
for d in "${dirs[@]}"; do for f in "$d"/*; do b=${f##*/}; [[ "$b" == jq || -e "$T/nojq/$b" ]] || ln -s "$f" "$T/nojq/$b" 2>/dev/null; done; done
printf '{"apiKey":"k","apiUrl":"https://one-shot-ship-api-staging.onrender.com"}' > "$T/.oss/config.json"
call oss_api_url "$T/nojq"
[[ "$RC" != 0 && -z "$OUT" ]] && pass "without jq, a config that names an apiUrl is refused (never read as production)" \
    || fail "without jq, a config that names an apiUrl is refused" "rc=$RC out='$OUT'"
for cfg in '{"apiKey":"k","apiUrl":""}' '{"apiKey":"k","apiUrl":null}' '{"apiKey":"k", "apiUrl" : ""}'; do
    printf '%s' "$cfg" > "$T/.oss/config.json"; call oss_api_url "$T/nojq"
    [[ "$RC" == 0 && "$OUT" == "https://one-shot-ship-api.onrender.com" ]] && pass "without jq, an empty or null apiUrl still means production ($cfg)" \
        || fail "without jq, an empty or null apiUrl still means production ($cfg)" "rc=$RC out='$OUT'"
done
printf '{"apiKey":"k"}' > "$T/.oss/config.json"
call oss_api_url "$T/nojq"
[[ "$RC" == 0 && "$OUT" == "https://one-shot-ship-api.onrender.com" ]] && pass "without jq, a config with no apiUrl still means production" \
    || fail "without jq, a config with no apiUrl still means production" "rc=$RC out='$OUT'"

# FR7: the config file's trust.
printf '{"apiKey":"secret-k","apiUrl":"https://one-shot-ship-api.onrender.com"}' > "$T/real.json"
for m in 666 646; do
    cp "$T/real.json" "$T/.oss/config.json"; chmod "$m" "$T/.oss/config.json"
    call oss_api_url; r1=$RC; o1=$OUT; call oss_api_key; r2=$RC; o2=$OUT
    [[ "$r1" != 0 && -z "$o1" && "$r2" != 0 && -z "$o2" ]] && pass "a world-writable config ($m) is refused for the URL and the key" \
        || fail "a world-writable config ($m) is refused" "url rc=$r1 '$o1' key rc=$r2 '$o2'"
done
cp "$T/real.json" "$T/.oss/config.json"; chmod 664 "$T/.oss/config.json"
call oss_api_key; r2=$RC; o2=$OUT; call oss_api_url
[[ "$RC" == 0 && "$r2" == 0 && "$o2" == secret-k ]] && pass "a group-writable config (664, umask 002) is accepted" \
    || fail "a group-writable config (664) is accepted" "url rc=$RC key rc=$r2"
rm -f "$T/.oss/config.json"; ln -s "$T/real.json" "$T/.oss/config.json"
call oss_api_url; r1=$RC; o1=$OUT; call oss_api_key
[[ "$r1" != 0 && -z "$o1" && "$RC" != 0 && -z "$OUT" ]] && pass "a symlinked config is refused for the URL and the key" \
    || fail "a symlinked config is refused" "url rc=$r1 '$o1' key rc=$RC '$OUT'"

# SR2: a LOOPBACK apiUrl (where the key goes to whatever listens on this machine's port) is trusted only when no one
# but the user can write config.json or its directory; production/staging keep the FR7 rule (group-writable accepted).
loopback_case() {  # loopback_case <url> <file mode> <dir mode> <want: trusted|refused> <label>
    rm -f "$T/.oss/config.json"; printf '{"apiKey":"k","apiUrl":"%s"}' "$1" > "$T/.oss/config.json"; chmod "$2" "$T/.oss/config.json"; chmod "$3" "$T/.oss"
    call oss_api_url; chmod 700 "$T/.oss"; chmod 600 "$T/.oss/config.json"
    if [[ "$4" == trusted ]]; then [[ "$RC" == 0 && -n "$OUT" ]] && pass "$5" || fail "$5" "rc=$RC out='$OUT'"
    else [[ "$RC" != 0 && -z "$OUT" ]] && pass "$5" || fail "$5" "rc=$RC out='$OUT'"; fi
}
loopback_case http://localhost:3001 664 700 refused "a group-writable config (664) cannot point the key at loopback"
loopback_case http://127.0.0.1:9 600 775 refused "a loopback apiUrl in a group-writable directory (775) is refused"
loopback_case "http://[::1]:8080" 600 707 refused "a loopback apiUrl in a world-writable directory (707) is refused"
loopback_case http://localhost:3001 600 700 trusted "a loopback apiUrl in a private config (600 in 700) is trusted"
loopback_case https://one-shot-ship-api.onrender.com 664 700 trusted "production with a group-writable config (664) is still trusted"
loopback_case https://one-shot-ship-api-staging.onrender.com 600 775 trusted "staging in a group-writable directory (775) is still trusted (directory not checked)"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
