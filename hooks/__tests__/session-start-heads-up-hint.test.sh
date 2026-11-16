#!/bin/bash
# @behavior An OSS user whose Claude Code built-in "You should know" heads-ups are off learns, once, that OSS's heads-up
#   relay is idle and the one command that turns it on; users who have it on (or turned heads-up off) never see it.
# @business-rule Session start prints the hint when cc-plugin-you-should-know@builtin is not enabled in the settings
#   that win (local > project > user enabledPlugins), at most once per machine (~/.oss/heads-up-hint-shown), never
#   with HEADS_UP=off.
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/hooks/__tests__/lib/session-start-alias.sh"
SSA=$(mktemp -d); trap 'rm -rf "$SSA"' EXIT
SS_HOOK=$(session_start_alias "$ROOT/hooks" "$SSA/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }
HINT='/plugin enable cc-plugin-you-should-know@builtin'

# Run session start in a fresh project under HOME=$1 (extra env as further args); prints its stdout.
start() {
    local home="$1"; shift
    env "$@" HOME="$home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="$home/proj" OSS_SKIP_HEALTH_CHECK=1 \
        bash -c 'cd "$CLAUDE_PROJECT_DIR" && bash "$0"' "$SS_HOOK" 2>/dev/null </dev/null
}
fresh() { local t; t=$(mktemp -d "$SSA/home.XXXXXX"); mkdir -p "$t/proj" "$t/.claude"; echo "$t"; }
enabled() { printf '{"enabledPlugins":{"cc-plugin-you-should-know@builtin":%s}}\n' "$1"; }

T=$(fresh)
out=$(start "$T")
if grep -qF "$HINT" <<<"$out" && grep -qi "heads-up" <<<"$out"; then pass "built-in off: the hint names heads-up and the enable command"
else fail "built-in off: the hint names heads-up and the enable command" "got: $out"; fi
out=$(start "$T")
if ! grep -qF "$HINT" <<<"$out"; then pass "the hint is shown only once per machine"
else fail "the hint is shown only once per machine" "shown again"; fi

T=$(fresh); enabled true > "$T/.claude/settings.json"
out=$(start "$T")
if ! grep -qF "$HINT" <<<"$out"; then pass "built-in on in user settings: no hint"
else fail "built-in on in user settings: no hint" "hint shown"; fi

T=$(fresh); enabled true > "$T/.claude/settings.json"; mkdir -p "$T/proj/.claude"; enabled false > "$T/proj/.claude/settings.local.json"
out=$(start "$T")
if grep -qF "$HINT" <<<"$out"; then pass "turned off in local project settings (wins over user): hint"
else fail "turned off in local project settings (wins over user): hint" "no hint"; fi

T=$(fresh); mkdir -p "$T/proj/.claude"; enabled true > "$T/proj/.claude/settings.json"
out=$(start "$T")
if ! grep -qF "$HINT" <<<"$out"; then pass "built-in on in project settings: no hint"
else fail "built-in on in project settings: no hint" "hint shown"; fi

T=$(fresh)
out=$(start "$T" HEADS_UP=off)
if ! grep -qF "$HINT" <<<"$out" && [[ ! -e "$T/.oss/heads-up-hint-shown" ]]; then pass "HEADS_UP=off: no hint, and it is not used up"
else fail "HEADS_UP=off: no hint, and it is not used up" "hint shown or marked"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
