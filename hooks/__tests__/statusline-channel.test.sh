#!/bin/bash
# The status line says which swimlane this session is in (release channels US-005).
#
# @behavior The first section of the status line names the channel from the API address actually in use
#           (oss_api_url, the same rule every call follows) and the plugin's version:
#             production + stable plugin   -> no channel section (customers see no change)
#             staging/localhost + beta     -> "⚠ STAGING"
#             staging/localhost + stable   -> "⚠ STAGING" and a mismatch warning
#             production + beta plugin     -> a mismatch warning (never the word STAGING)
#             invalid apiUrl               -> "⚠ apiUrl invalid" (never STAGING, never blank)
#           Without jq the section still renders, before "[jq required]" (SR8).
# @business-rule The maintainer must never confuse testing with real work, and a half-switched machine
#           (plugin from one channel, API of the other) must be visible at a glance.
#
# Usage: ./hooks/__tests__/statusline-channel.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROD="https://one-shot-ship-api.onrender.com"
STAGING="https://one-shot-ship-api-staging.onrender.com"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# line <apiUrl or ""> <plugin version> [PATH] [link|twolines]: the rendered status line for that config and plugin.
line() {
    local sb; sb="$(mktemp -d)"; mkdir -p "$sb/home/.oss" "$sb/plugin/.claude-plugin"
    if [[ "$1" == "{"* ]]; then printf '%s' "$1" > "$sb/home/.oss/config.json"   # a whole config
    elif [[ -n "$1" ]]; then printf '{"apiKey":"k","apiUrl":"%s"}' "$1" > "$sb/home/.oss/config.json"
    else printf '{"apiKey":"k"}' > "$sb/home/.oss/config.json"; fi
    printf '{"name":"oss","version":"%s"}' "$2" > "$sb/plugin/.claude-plugin/plugin.json"
    case "${4:-}" in   # ~/.oss/plugin-root: plain, or one that fails the `oss-value.sh root` checks (SR5)
        link) printf '%s\n' "$sb/plugin" > "$sb/elsewhere"; ln -s "$sb/elsewhere" "$sb/home/.oss/plugin-root" ;;
        twolines) printf '%s\n/tmp\n' "$sb/plugin" > "$sb/home/.oss/plugin-root" ;;
        *) printf '%s\n' "$sb/plugin" > "$sb/home/.oss/plugin-root" ;;
    esac
    chmod 600 "$sb/home/.oss/config.json"
    (cd "$sb" && printf '{}' | env -u CLAUDE_PLUGIN_ROOT -u OSS_CONFIG_DIR HOME="$sb/home" PATH="${3:-$PATH}" \
        /usr/bin/perl -e 'alarm 20; exec @ARGV' /bin/bash "$ROOT/hooks/oss-statusline.sh" 2>/dev/null)
    rm -rf "$sb"
}
first_section() { printf '%s\n' "${1%% | *}"; }

l=$(line "" 2.0.94)
if [[ -n "$l" && "$l" != *STAGING* && "$l" != *mismatch* && "$l" != *"apiUrl invalid"* ]]; then pass "production + stable: no channel section"
else fail "production + stable: no channel section" "got '$l'"; fi

l=$(line "$STAGING" 2.1.0-beta.1)
if [[ "$(first_section "$l")" == "⚠ STAGING" ]]; then pass "staging + beta: the first section is '⚠ STAGING'"
else fail "staging + beta: the first section is '⚠ STAGING'" "got '$l'"; fi

for lb in "http://localhost:3001" "http://127.0.0.1:9" "http://[::1]:8080"; do
    l=$(line "$lb" 2.1.0-beta.1)
    if [[ "$(first_section "$l")" == *STAGING* ]]; then pass "localhost ($lb) + beta: shows STAGING"
    else fail "localhost ($lb) + beta: shows STAGING" "got '$l'"; fi
done

l=$(line "$STAGING" 2.0.94)
if [[ "$(first_section "$l")" == *STAGING* && "$(first_section "$l")" == *mismatch* ]]; then pass "staging + stable plugin: STAGING and a mismatch warning"
else fail "staging + stable plugin: STAGING and a mismatch warning" "got '$l'"; fi

l=$(line "$PROD" 2.1.0-beta.1)
if [[ "$(first_section "$l")" == *mismatch* && "$l" != *STAGING* ]]; then pass "production + beta plugin: a mismatch warning, never STAGING"
else fail "production + beta plugin: a mismatch warning, never STAGING" "got '$l'"; fi

# FR6 (ship round 1): production written with a trailing "/" or the default ":443" is still production.
for p in "$PROD/" "https://one-shot-ship-api.onrender.com:443"; do
    l=$(line "$p" 2.0.94)
    if [[ -n "$l" && "$l" != *STAGING* && "$l" != *mismatch* && "$l" != *"apiUrl"* ]]; then pass "production written as '$p' + stable: no channel section"
    else fail "production written as '$p' + stable: no channel section" "got '$l'"; fi
done
# FR4: a custom https host is not an OSS API: never shown as STAGING.
l=$(line "https://api.example.com" 2.1.0-beta.1)
if [[ "$(first_section "$l")" == "⚠ apiUrl invalid" && "$l" != *STAGING* ]]; then pass "custom host: '⚠ apiUrl invalid', never STAGING"
else fail "custom host: '⚠ apiUrl invalid', never STAGING" "got '$l'"; fi

l=$(line "http://api.example.com" 2.1.0-beta.1)
if [[ "$(first_section "$l")" == "⚠ apiUrl invalid" && "$l" != *STAGING* ]]; then pass "invalid apiUrl: '⚠ apiUrl invalid', never STAGING"
else fail "invalid apiUrl: '⚠ apiUrl invalid', never STAGING" "got '$l'"; fi

# SR8: without jq the status line still says which swimlane it is in, before "[jq required]". Without jq a config
# that names an apiUrl cannot be read (FR5), so it shows "⚠ apiUrl invalid": never blank, never production.
NOJQ="$(mktemp -d)"; ln -s /usr/bin/* /bin/* "$NOJQ/" 2>/dev/null; rm -f "$NOJQ/jq"
l=$(line "$STAGING" 2.1.0-beta.1 "$NOJQ")
if [[ "$(first_section "$l")" == "⚠ apiUrl invalid" && "$l" == *"[jq required]"* ]]; then pass "no jq + staging: '⚠ apiUrl invalid' before '[jq required]'"
else fail "no jq + staging: '⚠ apiUrl invalid' before '[jq required]'" "got '$l'"; fi
l=$(line "" 2.1.0-beta.1 "$NOJQ")
if [[ "$(first_section "$l")" == *mismatch* && "$l" == *"[jq required]"* ]]; then pass "no jq + no apiUrl + beta plugin: the mismatch warning is still shown"
else fail "no jq + no apiUrl + beta plugin: the mismatch warning is still shown" "got '$l'"; fi
# UR3: without jq, a config that is not flat JSON (here apiUrl spelled with a \u escape, which the CLI reads as staging)
# is refused, so the swimlane says "apiUrl invalid": never blank (which would mean production).
l=$(line '{"apiKey":"k","api\u0055rl":"'"$STAGING"'"}' 2.0.94 "$NOJQ")
if [[ "$(first_section "$l")" == "⚠ apiUrl invalid" && "$l" == *"[jq required]"* ]]; then pass "no jq + escaped staging apiUrl + stable: '⚠ apiUrl invalid', never blank"
else fail "no jq + escaped staging apiUrl + stable: '⚠ apiUrl invalid', never blank" "got '$l'"; fi
rm -rf "$NOJQ"

# SR5 (same rule as `oss-value.sh root`): a ~/.oss/plugin-root that is a symlink or not one line is not used to read
# the plugin version, so it cannot make a production session claim a beta plugin.
for m in link twolines; do
    l=$(line "$PROD" 2.1.0-beta.1 "" "$m")
    if [[ -n "$l" && "$l" != *mismatch* && "$l" != *STAGING* ]]; then pass "a plugin-root that fails the checks ($m) is not read"
    else fail "a plugin-root that fails the checks ($m) is not read" "got '$l'"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
