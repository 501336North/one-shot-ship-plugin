#!/bin/bash
# The channel section costs the status line (which Claude Code re-renders constantly) almost nothing (SR9).
#
# @behavior Rendering the channel section (which API, which plugin channel) starts at most two external programs,
#           the jq that reads apiUrl and the stat that checks the config's permissions (once each): no id, find,
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

# A config naming production and a beta plugin found through ~/.oss/plugin-root: the channel section renders
# a mismatch warning, so every step of it runs.
mkdir -p "$T/home/.oss" "$T/plugin/.claude-plugin" "$T/stub"; chmod 700 "$T/home/.oss"
printf '{"apiKey":"k","apiUrl":"https://one-shot-ship-api.onrender.com"}' > "$T/home/.oss/config.json"; chmod 600 "$T/home/.oss/config.json"
printf '{"name":"oss","version":"2.1.0-beta.1"}' > "$T/plugin/.claude-plugin/plugin.json"
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
# The stubbed render: the same script with no oss-api-curl.sh beside it (or in ~/.oss/hooks), so no channel section.
cp "$ROOT/hooks/oss-statusline.sh" "$T/stub/oss-statusline.sh"

render() {  # render <script> <log>: prints the status line; the shims log into <log>
    : > "$2"
    (cd "$T" && printf '{}' | env -u CLAUDE_PLUGIN_ROOT -u OSS_CONFIG_DIR HOME="$T/home" SHIM_LOG="$2" PATH="$T/shim:$PATH" \
        perl -e 'alarm 60; exec @ARGV' /bin/bash "$1" 2>/dev/null)
}

for round in 1 2; do   # twice: the count must not depend on a first-render cache
    with=$(render "$ROOT/hooks/oss-statusline.sh" "$T/with.log"); without=$(render "$T/stub/oss-statusline.sh" "$T/without.log")
    [[ "$with" == *mismatch* && "$without" != *mismatch* ]] || { fail "round $round: the channel section renders only in the full script" "with='$with' without='$without'"; continue; }
    n_with=$(wc -l < "$T/with.log"); n_without=$(wc -l < "$T/without.log"); extra=$(( n_with - n_without ))
    # The channel's own programs: what the full render started beyond the stubbed one (multiset difference).
    spawned=$(sort "$T/with.log" | comm -23 - <(sort "$T/without.log") | tr '\n' ' ')
    if (( extra <= 2 )) && [[ "$spawned" == "" || "$spawned" == "jq " || "$spawned" == "stat " || "$spawned" == "jq stat " ]]; then
        pass "round $round: the channel section starts only jq and stat, once each (started: ${spawned:-none})"
    else fail "round $round: the channel section starts only jq and stat, once each" "it started $extra: $spawned"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
