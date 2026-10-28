#!/bin/bash
# Every hook that sends the OSS API key reads it through the shared reader (oss_api_key / _oss_cfg_key in
# hooks/oss-api-curl.sh), never with a grep of its own (ship round 3, TR9; IRON LAW #1b).
#
# @behavior With an ordinary config (`{"apiKey": "..."}`) each hook sends that key, as before. With a config the
#           shared reader refuses, the hook sends no key at all:
#             - two "apiKey" fields (a nested one too) and no jq to tell them apart;
#             - a key with a backslash escape and no jq (the grep would send half of it);
#             - only a NESTED "apiKey" (jq present: there is no top-level key, so there is no key);
#             - a world-writable config.json (anyone on the machine could have written the key or the URL).
# @business-rule One answer to "which key, from which file, may we send": the reader in oss-api-curl.sh, which
#           checks the file's trust, reads it once, and refuses an ambiguous key. A hook with its own grep
#           answers differently (TR5/TR6 fixed the helper; this keeps every hook on it).
#
# A recording curl on PATH writes the key of every keyed call (curl --config - on stdin) and fails, so nothing
# leaves the machine. Hooks run in a throwaway HOME with OSS_CONFIG_DIR pointing at its own config.json.
#
# Usage: ./hooks/__tests__/hooks-read-key-via-helper.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

#   name | argument
HOOKS=(
    "oss-push-metrics.sh|{\"event\":\"t\"}"
    "oss-fetch-team-iron-laws.sh|"
    "oss-session-start.sh|"
    "oss-session-start-new.sh|"
    "oss-session-start-test.sh|"
)

# A bin directory with the system tools but no jq (the no-jq cases): /usr/bin has a jq of its own.
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/nojq"
for d in /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        n=${f##*/}
        [[ "$n" == jq || -e "$WORK/nojq/$n" ]] || ln -s "$f" "$WORK/nojq/$n"
    done
done
NOJQ_PATH="$WORK/nojq"
JQ_PATH="$(dirname "$(command -v jq)"):/usr/bin:/bin:/usr/sbin:/sbin"

# Runs one hook; prints the keys it sent (one line per keyed curl call).
keys_sent() {  # $1 hook, $2 argument, $3 config.json content, $4 "jq" | "nojq", $5 config mode
    local sb; sb="$(mktemp -d "$WORK/sb.XXXXXX")"; mkdir -p "$sb/home/.oss" "$sb/mock" "$sb/proj"
    printf '%s' "$3" > "$sb/home/.oss/config.json"; chmod "$5" "$sb/home/.oss/config.json"
    cat > "$sb/mock/curl" <<CURL
#!/bin/bash
prev=""
for a in "\$@"; do
  if [[ "\$prev" == --config && "\$a" == - ]]; then
    sed -n 's/^header = "Authorization: Bearer \(.*\)"\$/\1/p' >> "$sb/keys"
  fi
  prev="\$a"
done
exit 22
CURL
    chmod +x "$sb/mock/curl"; : > "$sb/keys"
    local path="$NOJQ_PATH"; [[ "$4" == jq ]] && path="$JQ_PATH"
    local args=(); [[ -n "$2" ]] && args=("$2")
    (cd "$sb/proj" && env -i HOME="$sb/home" OSS_CONFIG_DIR="$sb/home/.oss" CLAUDE_PROJECT_DIR="$sb/proj" \
        PATH="$sb/mock:$path" CLAUDE_PLUGIN_ROOT="$ROOT" TMPDIR="$sb" \
        /usr/bin/perl -e 'alarm 25; exec @ARGV' /bin/bash "$ROOT/hooks/$1" ${args[@]+"${args[@]}"} </dev/null >/dev/null 2>&1)
    cat "$sb/keys"
}

check() {  # $1 hook, $2 arg, $3 label, $4 config, $5 jq|nojq, $6 mode, $7 expected keys sent ("" = none)
    local got; got="$(keys_sent "$1" "$2" "$4" "$5" "$6" | sort -u)"
    if [[ "$got" == "$7" ]]; then pass "$1: $3"
    else fail "$1: $3" "expected [${7}] sent [$(tr '\n' ' ' <<<"$got")]"; fi
}

for c in "${HOOKS[@]}"; do
    hook="${c%%|*}"; arg="${c#*|}"
    # Controls: an ordinary config still sends its key, with and without jq (customers see no change).
    check "$hook" "$arg" "ordinary config, no jq → sends the key" '{"apiKey": "k-flat"}' nojq 600 "k-flat"
    check "$hook" "$arg" "ordinary config, jq → sends the key" '{"apiKey": "k-flat"}' jq 600 "k-flat"
    # Refusals.
    check "$hook" "$arg" "nested + top-level apiKey, no jq → sends no key" \
        '{"apiKey": "k-top", "team": {"apiKey": "k-nested"}}' nojq 600 ""
    check "$hook" "$arg" "apiKey with a backslash escape, no jq → sends no key" \
        '{"apiKey": "k-a\"b"}' nojq 600 ""
    check "$hook" "$arg" "only a nested apiKey, jq → sends no key" '{"team": {"apiKey": "k-nested"}}' jq 600 ""
    check "$hook" "$arg" "world-writable config → sends no key" '{"apiKey": "k-flat"}' jq 666 ""
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
