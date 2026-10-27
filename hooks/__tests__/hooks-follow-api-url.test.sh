#!/bin/bash
# Every hook that calls the OSS API sends its request to the API the config names (release channels, US-002).
#
# @behavior With no apiUrl in the OSS config a hook calls the production API (customers, US-001). With apiUrl
#           set to another valid API (staging, or a loopback DEV API) it calls that API and never production.
#           With an apiUrl that breaks the shared rule (oss_api_url: https, or plain http only for loopback; no
#           user@, query or fragment) it calls nothing at all.
# @business-rule One answer to "where does the key go": oss_api_url in hooks/oss-api-curl.sh (IRON LAW #1b).
#           A hook that hard-codes the host can leak a STAGING session's key to production, or a customer's key
#           to a server their config never named.
#
# A fake curl on PATH records the scheme://host of every URL it is handed and fails, so nothing leaves the
# machine. Hooks run in a throwaway HOME with OSS_CONFIG_DIR pointing at its own config.json.
#
# Usage: ./hooks/__tests__/hooks-follow-api-url.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROD="https://one-shot-ship-api.onrender.com"
LOOP="http://127.0.0.1:9"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# How each hook is driven so that it makes its API call (measured 2026-10-26).
# oss-iron-laws-sync.sh is not here since FR15: it makes no API call of its own; the decrypt CLI fetches the
# verified laws, and the CLI's address rule is tested in packages/cli-decrypt. iron-laws-sync-safety.test.sh
# proves the hook never runs curl for the laws.
#   name | arguments
CASES=(
    "oss-session-start.sh|"
    "oss-push-metrics.sh|{\"event\":\"t\"}"
    "oss-fetch-team-iron-laws.sh|"
    "fetch-iron-laws.sh|"
    "oss-changelog.sh|"
    "check-updates.sh|"
    "oss-session-start-new.sh|"
    "oss-session-start-test.sh|"
)

# Runs one hook with the given config.json content; prints the distinct hosts it called (one per line).
# With $4 = "split", the config goes to a separate OSS_CONFIG_DIR and $HOME/.oss/config.json has no key, so a
# request only happens if the hook reads the key from the same file oss_api_url reads the URL from.
hosts_called() {  # $1 = hook, $2 = argument (may be empty), $3 = config.json content, $4 = "" or "split"
    local sb cfgdir; sb="$(mktemp -d)"; mkdir -p "$sb/home/.oss" "$sb/mock" "$sb/proj" "$sb/alt"
    cfgdir="$sb/home/.oss"
    if [[ "${4:-}" == split ]]; then cfgdir="$sb/alt"; printf '%s' '{}' > "$sb/home/.oss/config.json"; fi
    printf '%s' "$3" > "$cfgdir/config.json"
    # check-updates fetches the manifest only on a later run with a cached plugin version.
    local extra=()
    if [[ "$1" == check-updates.sh ]]; then
        printf '%s' '{"name":"oss","version":"9.9.9"}' > "$sb/plugin.json"
        printf '%s' '{"lastPluginVersion":"9.9.9","lastCheckedAt":"2026-01-01T00:00:00Z","manifestVersion":0,"manifestHashes":{},"promptSignatures":{}}' > "$cfgdir/update-state.json"
        extra=(OSS_PLUGIN_JSON="$sb/plugin.json")
    fi
    cat > "$sb/mock/curl" <<CURL
#!/bin/sh
for a in "\$@"; do
  case "\$a" in http://*|https://*) printf '%s\n' "\$a" | sed -E 's#^(https?://[^/]*).*#\\1#' >> "$sb/hosts";; esac
done
exit 22
CURL
    chmod +x "$sb/mock/curl"; : > "$sb/hosts"
    local args=(); [[ -n "$2" ]] && args=("$2")
    (cd "$sb/proj" && HOME="$sb/home" OSS_CONFIG_DIR="$cfgdir" CLAUDE_PROJECT_DIR="$sb/proj" \
        PATH="$sb/mock:$PATH" CLAUDE_PLUGIN_ROOT="$ROOT" env ${extra[@]+"${extra[@]}"} \
        perl -e 'alarm 25; exec @ARGV' bash "$ROOT/hooks/$1" ${args[@]+"${args[@]}"} </dev/null >/dev/null 2>&1)
    sort -u "$sb/hosts"; rm -rf "$sb"
}

for c in "${CASES[@]}"; do
    hook="${c%%|*}"; arg="${c#*|}"

    got="$(hosts_called "$hook" "$arg" '{"apiKey":"k-test"}')"
    if [[ "$got" == "$PROD" ]]; then pass "$hook: no apiUrl → calls production"
    else fail "$hook: no apiUrl → calls production" "called: [$(tr '\n' ' ' <<<"$got")]"; fi

    got="$(hosts_called "$hook" "$arg" "{\"apiKey\":\"k-test\",\"apiUrl\":\"$LOOP\"}")"
    if [[ "$got" == "$LOOP" ]]; then pass "$hook: apiUrl = loopback → calls only the loopback API"
    else fail "$hook: apiUrl = loopback → calls only the loopback API" "called: [$(tr '\n' ' ' <<<"$got")]"; fi

    got="$(hosts_called "$hook" "$arg" '{"apiKey":"k-test","apiUrl":"http://api.example.com"}')"
    if [[ -z "$got" ]]; then pass "$hook: invalid apiUrl (plain http, not loopback) → calls nothing"
    else fail "$hook: invalid apiUrl (plain http, not loopback) → calls nothing" "called: [$(tr '\n' ' ' <<<"$got")]"; fi

    got="$(hosts_called "$hook" "$arg" "{\"apiKey\":\"k-test\",\"apiUrl\":\"$LOOP\"}" split)"
    if [[ "$got" == "$LOOP" ]]; then pass "$hook: OSS_CONFIG_DIR set → key and URL both come from it"
    else fail "$hook: OSS_CONFIG_DIR set → key and URL both come from it" "called: [$(tr '\n' ' ' <<<"$got")]"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
