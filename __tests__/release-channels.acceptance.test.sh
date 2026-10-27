#!/bin/bash
# Acceptance: release channels. The maintainer can run OSS against a staging (or local) API without any
# call leaking to production, and customers on the default config keep talking to production only.
#
# Stories (docs/requirements/release-channels.md):
#   US-001 Customers are untouched   - with no apiUrl, every call goes to the production API (guard: green today)
#   US-002 One API address           - with apiUrl set, no hook calls production
#   US-003 Verified prompt fetches   - no agent/skill/command tells the model to WebFetch the OSS API
#   US-005 I know I'm on STAGING     - the status line says so whenever the API in use is not production
#
# @boundary hooks/*.sh as Claude Code runs them (HOME + config.json + PATH), the agents/skills/commands
#           markdown the model executes, and hooks/oss-statusline.sh's rendered line.
# @business-rule Governing rule (maintainer, 2026-10-26): "as long as current customers aren't impacted,
#           creating a new swimlane for testing what I'm developing without the current customer running any
#           risks is an improvement." The A1/A5 guards encode "customers aren't impacted".
#
# Expected today: A1 and A5 PASS (guards), A2, A3 and A4 FAIL until PLAN Tasks 4-8 and 14 land.
#
# Usage: ./__tests__/release-channels.acceptance.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_HOST="https://one-shot-ship-api.onrender.com"
LOOPBACK="http://127.0.0.1:9"
# The hooks that make an API call on a plain session (measured 2026-10-26). PLAN Tasks 4/5 add unit rows
# for the hooks that only call under extra conditions (push-metrics, check-updates, iron-laws-sync).
# fetch-iron-laws.sh left this list in FR15: it makes no API call of its own; the decrypt CLI fetches and
# verifies the laws (its address rule is tested in packages/cli-decrypt).
HOOKS=(oss-fetch-team-iron-laws.sh oss-changelog.sh oss-session-start.sh)
TESTS_RUN=0; TESTS_PASSED=0; TESTS_FAILED=0
pass() { echo "✓ PASS: $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

# A sandbox HOME with the given config.json and a curl that records every URL it is handed (scheme + host
# only) and fails, so nothing leaves the machine.
make_sandbox() {  # $1 = config.json content; prints the sandbox dir
    local sb; sb="$(mktemp -d)"; mkdir -p "$sb/home/.oss" "$sb/mock"
    printf '%s' "$1" > "$sb/home/.oss/config.json"
    cat > "$sb/mock/curl" <<CURL
#!/bin/sh
for a in "\$@"; do
  case "\$a" in http://*|https://*) printf '%s\n' "\$a" | sed -E 's#^(https?://[^/]*).*#\\1#' >> "$sb/hosts.log";; esac
done
exit 22
CURL
    chmod +x "$sb/mock/curl"; : > "$sb/hosts.log"
    printf '%s\n' "$sb"
}
run_hook() {  # $1 = sandbox, $2 = hook file name
    (cd "$1" && HOME="$1/home" PATH="$1/mock:$PATH" CLAUDE_PLUGIN_ROOT="$ROOT" \
        perl -e 'alarm 25; exec @ARGV' bash "$ROOT/hooks/$2" </dev/null >/dev/null 2>&1)
}

# A1 (guard) - Given a customer config with no apiUrl, When each hook runs,
#              Then every host it calls is the production API.
a1_customer_default_calls_production_only() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local sb h bad=""; sb="$(make_sandbox '{"apiKey":"k-test"}')"
    for h in "${HOOKS[@]}"; do
        : > "$sb/hosts.log"; run_hook "$sb" "$h"
        if ! grep -q . "$sb/hosts.log"; then bad="$bad $h(no call)"; fi
        if grep -qvxF "$PROD_HOST" "$sb/hosts.log"; then bad="$bad $h($(grep -vxF "$PROD_HOST" "$sb/hosts.log" | sort -u | tr '\n' ' '))"; fi
    done
    rm -rf "$sb"
    if [[ -z "$bad" ]]; then pass "A1 customer default: every hook calls production only"
    else fail "A1 customer default: every hook calls production only" "$bad"; fi
}

# A2 - Given the maintainer's config with apiUrl = a loopback API, When each hook runs,
#      Then no hook calls production, and each calls the configured API.
a2_configured_api_is_the_only_api() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local sb h bad=""; sb="$(make_sandbox "{\"apiKey\":\"k-test\",\"apiUrl\":\"$LOOPBACK\"}")"
    for h in "${HOOKS[@]}"; do
        : > "$sb/hosts.log"; run_hook "$sb" "$h"
        grep -qxF "$PROD_HOST" "$sb/hosts.log" && bad="$bad $h(called production)"
        grep -qxF "$LOOPBACK" "$sb/hosts.log" || bad="$bad $h(did not call $LOOPBACK)"
    done
    rm -rf "$sb"
    if [[ -z "$bad" ]]; then pass "A2 apiUrl set: no hook calls production"
    else fail "A2 apiUrl set: no hook calls production" "$bad"; fi
}

# A3 - Given the agents, skills and commands the model executes, When they fetch their prompt,
#      Then none of them WebFetches the OSS API (prompts come only through oss-decrypt, signature-checked).
a3_no_prompt_is_fetched_around_oss_decrypt() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local hits; hits="$(cd "$ROOT" && git grep -l -F "URL: $PROD_HOST/api/v1/prompts/" -- agents skills commands | wc -l | tr -d ' ')"
    if [[ "$hits" == 0 ]]; then pass "A3 no agent/skill/command WebFetches a prompt from the OSS API"
    else fail "A3 no agent/skill/command WebFetches a prompt from the OSS API" "$hits files still do"; fi
}

render_statusline() {  # $1 = config.json content; prints the rendered line
    local sb out; sb="$(make_sandbox "$1")"
    out="$(cd "$sb" && printf '{}' | HOME="$sb/home" PATH="$sb/mock:$PATH" CLAUDE_PLUGIN_ROOT="$ROOT" \
        perl -e 'alarm 25; exec @ARGV' bash "$ROOT/hooks/oss-statusline.sh" 2>/dev/null)"
    rm -rf "$sb"; printf '%s\n' "$out"
}

# A4 - Given apiUrl = a non-production API, When the status line renders, Then it shows STAGING.
a4_statusline_says_staging_off_production() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local line; line="$(render_statusline "{\"apiKey\":\"k-test\",\"apiUrl\":\"$LOOPBACK\"}")"
    if grep -qF 'STAGING' <<<"$line"; then pass "A4 status line shows STAGING when the API is not production"
    else fail "A4 status line shows STAGING when the API is not production" "got: $line"; fi
}

# A5 (guard) - Given a customer config with no apiUrl, When the status line renders, Then no STAGING marker.
a5_statusline_quiet_on_production() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local line; line="$(render_statusline '{"apiKey":"k-test"}')"
    if [[ -n "$line" ]] && ! grep -qF 'STAGING' <<<"$line"; then pass "A5 status line shows no STAGING marker on production"
    else fail "A5 status line shows no STAGING marker on production" "got: '$line'"; fi
}

a1_customer_default_calls_production_only
a2_configured_api_is_the_only_api
a3_no_prompt_is_fetched_around_oss_decrypt
a4_statusline_says_staging_off_production
a5_statusline_quiet_on_production

echo ""
echo "Results: $TESTS_PASSED/$TESTS_RUN passed"
[[ $TESTS_FAILED -eq 0 ]]
