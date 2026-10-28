#!/bin/bash
# The channel section costs the status line (which Claude Code re-renders constantly) almost nothing (SR9).
#
# @behavior Rendering the channel section (which API, which plugin channel) starts at most two external programs,
#           the jq that reads apiUrl and the stat that checks the config's permissions (once each), and none at all
#           for production (no apiUrl) with a stable plugin, which shows nothing (TR7): no id, find,
#           tr, head or sed per render. Counted, not timed, so the test
#           is not flaky: every counted tool on PATH is a shim that logs its own start, and the full status line
#           is rendered twice, with and without the channel section; the difference is the channel's cost.
# @business-rule The status line must stay instant; a swimlane marker that slows every render is a regression
#           customers pay for on every keystroke.
#
# Usage: ./hooks/__tests__/statusline-channel-cost.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# Every tool the channel code could reach for, shimmed to log its name, then run the real one.
mkdir -p "$T/shim"
for c in id find tr head tail sed awk jq stat dirname basename cat grep cut wc realpath readlink ls date; do
    real=$(command -v "$c") || continue
    printf '#!/bin/bash\necho %s >> "$SHIM_LOG"\nexec %s "$@"\n' "$c" "$real" > "$T/shim/$c"; chmod +x "$T/shim/$c"
done

# The plugin is found through ~/.oss/plugin-root; each case below writes its own config and plugin version.
mkdir -p "$T/home/.oss" "$T/plugin/.claude-plugin" "$T/stub"; chmod 700 "$T/home/.oss"
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
# The stubbed render: the same script with no oss-api-curl.sh beside it (or in ~/.oss/hooks), so no channel section.
cp "$ROOT/hooks/oss-statusline.sh" "$T/stub/oss-statusline.sh"

render() {  # render <script> <log>: prints the status line; the shims log into <log>
    : > "$2"
    (cd "$T" && printf '{}' | env -u CLAUDE_PLUGIN_ROOT -u OSS_CONFIG_DIR HOME="$T/home" SHIM_LOG="$2" PATH="$T/shim:$PATH" \
        perl -e 'alarm 60; exec @ARGV' /bin/bash "$1" 2>/dev/null)
}

cost_case() {  # cost_case <config json> <plugin version> <expected channel text or ""> <allowed spawn lists, |-separated> <label>
    printf '%s' "$1" > "$T/home/.oss/config.json"; chmod 600 "$T/home/.oss/config.json"
    printf '{"name":"oss","version":"%s"}' "$2" > "$T/plugin/.claude-plugin/plugin.json"
    local round with without extra spawned
    for round in 1 2; do   # twice: the count must not depend on a first-render cache
        with=$(render "$ROOT/hooks/oss-statusline.sh" "$T/with.log"); without=$(render "$T/stub/oss-statusline.sh" "$T/without.log")
        if [[ -n "$3" ]]; then
            [[ "$with" == *"$3"* && "$without" != *"$3"* ]] || { fail "$5, round $round: the channel section renders only in the full script" "with='$with' without='$without'"; continue; }
        else
            [[ "$with" == "$without" ]] || { fail "$5, round $round: no channel section" "with='$with' without='$without'"; continue; }
        fi
        extra=$(( $(wc -l < "$T/with.log") - $(wc -l < "$T/without.log") ))
        # The channel's own programs: what the full render started beyond the stubbed one (multiset difference).
        spawned=$(sort "$T/with.log" | comm -23 - <(sort "$T/without.log") | tr '\n' ' ')
        if [[ "|$4|" == *"|$spawned|"* ]] && (( extra <= 2 )); then pass "$5, round $round (started: ${spawned:-none})"
        else fail "$5, round $round" "it started $extra: '$spawned' (allowed: $4)"; fi
    done
}
# A beta plugin and a config naming production: the section renders a mismatch warning, so every step of it runs.
cost_case '{"apiKey":"k","apiUrl":"https://one-shot-ship-api.onrender.com"}' 2.1.0-beta.1 mismatch '|jq |stat |jq stat ' \
    "beta plugin + production apiUrl: the channel section starts only jq and stat, once each"
cost_case '{"apiKey":"k","apiUrl":"https://one-shot-ship-api-staging.onrender.com"}' 2.1.0 STAGING '|jq |stat |jq stat ' \
    "stable plugin + staging apiUrl: the channel section starts only jq and stat, once each"
# jq reads "api\u0055rl" as apiUrl: a config that names it with an escape is not "no apiUrl" (it still says STAGING).
cost_case '{"apiKey":"k","api\u0055rl":"https://one-shot-ship-api-staging.onrender.com"}' 2.1.0 STAGING '|jq |stat |jq stat ' \
    "stable plugin + an escaped apiUrl naming staging: still shown"
# TR7: most customers, production (no apiUrl) and a stable plugin: nothing to show, so nothing is started.
cost_case '{"apiKey":"k"}' 2.1.0 "" '' \
    "stable plugin + no apiUrl (production): the channel section starts no program"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
