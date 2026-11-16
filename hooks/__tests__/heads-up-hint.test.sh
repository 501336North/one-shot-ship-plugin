#!/bin/bash
# @behavior An OSS user whose Claude Code built-in "You should know" heads-ups are off sees, once, on screen, that
#   OSS's heads-up relay is idle and the one command that turns it on; users who have it on (or turned heads-up off)
#   never see it, and it is never spent on a message only the agent reads.
# @business-rule The heads-up hook (hooks/oss-heads-up.sh), when there is no built-in store, shows the hint as a
#   systemMessage (shown to the user) when cc-plugin-you-should-know@builtin is not enabled in the settings that win
#   (local > project > user enabledPlugins), at most once per machine (~/.oss/heads-up-hint-seen; the 2.2.0 marker heads-up-hint-shown was set without the
#   user seeing anything, so it is ignored), never with
#   HEADS_UP=off. Session start (whose output only the agent reads) does not print it.
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

# Run the heads-up hook in a fresh project under HOME=$1 (extra env as further args); prints what the user is shown
# (the systemMessage of its JSON output).
shown() {
    local home="$1"; shift
    env "$@" HOME="$home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="$home/proj" HEADS_UP_STORE= \
        sh "$ROOT/hooks/oss-heads-up.sh" 2>/dev/null </dev/null |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(s.trim())process.stdout.write(String(JSON.parse(s).systemMessage??""))})'
}
fresh() { local t; t=$(mktemp -d "$SSA/home.XXXXXX"); mkdir -p "$t/proj" "$t/.claude"; echo "$t"; }
enabled() { printf '{"enabledPlugins":{"cc-plugin-you-should-know@builtin":%s}}\n' "$1"; }

T=$(fresh)
out=$(shown "$T")
if grep -qF "$HINT" <<<"$out" && grep -qi "heads-up" <<<"$out"; then pass "built-in off: the user is shown the hint, naming heads-up and the enable command"
else fail "built-in off: the user is shown the hint, naming heads-up and the enable command" "got: $out"; fi
out=$(shown "$T")
if ! grep -qF "$HINT" <<<"$out"; then pass "the hint is shown only once per machine"
else fail "the hint is shown only once per machine" "shown again"; fi

T=$(fresh); mkdir -p "$T/.oss"; : > "$T/.oss/heads-up-hint-shown"
out=$(shown "$T")
if grep -qF "$HINT" <<<"$out"; then pass "a machine marked by 2.2.0 (hint never seen by the user) is still shown it"
else fail "a machine marked by 2.2.0 (hint never seen by the user) is still shown it" "no hint"; fi

T=$(fresh); enabled true > "$T/.claude/settings.json"
out=$(shown "$T")
if ! grep -qF "$HINT" <<<"$out"; then pass "built-in on in user settings: no hint"
else fail "built-in on in user settings: no hint" "hint shown"; fi

T=$(fresh); enabled true > "$T/.claude/settings.json"; mkdir -p "$T/proj/.claude"; enabled false > "$T/proj/.claude/settings.local.json"
out=$(shown "$T")
if grep -qF "$HINT" <<<"$out"; then pass "turned off in local project settings (wins over user): hint"
else fail "turned off in local project settings (wins over user): hint" "no hint"; fi

T=$(fresh); mkdir -p "$T/proj/.claude"; enabled true > "$T/proj/.claude/settings.json"
out=$(shown "$T")
if ! grep -qF "$HINT" <<<"$out"; then pass "built-in on in project settings: no hint"
else fail "built-in on in project settings: no hint" "hint shown"; fi

T=$(fresh)
out=$(shown "$T" HEADS_UP=off)
if ! grep -qF "$HINT" <<<"$out" && [[ ! -e "$T/.oss/heads-up-hint-seen" ]]; then pass "HEADS_UP=off: no hint, and it is not used up"
else fail "HEADS_UP=off: no hint, and it is not used up" "hint shown or marked"; fi

T=$(fresh)
out=$(env HOME="$T" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="$T/proj" OSS_SKIP_HEALTH_CHECK=1 \
    bash -c 'cd "$CLAUDE_PROJECT_DIR" && bash "$0"' "$SS_HOOK" 2>/dev/null </dev/null)
if ! grep -qF "$HINT" <<<"$out" && [[ ! -e "$T/.oss/heads-up-hint-seen" ]]; then pass "session start (read only by the agent) does not print or use up the hint"
else fail "session start (read only by the agent) does not print or use up the hint" "printed or marked"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
