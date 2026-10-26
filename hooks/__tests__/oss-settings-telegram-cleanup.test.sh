#!/bin/bash
# Old Telegram bot tokens are removed from ~/.oss/settings.json once, at session start.
#
# @behavior A user who once set up Telegram notifications starts a session; the plaintext bot token
#           (top-level `telegram` and `notifications.telegram`) is gone from settings.json afterwards,
#           and every other setting they had is exactly as it was.
# @business-rule Telegram is removed from the product; a secret it no longer uses must not linger on
#           disk. The cleanup must never damage settings (symlinks, invalid JSON, files without the
#           keys are left alone) and must never print anything (session-start output reaches the model).
#
# Usage: ./hooks/__tests__/oss-settings-telegram-cleanup.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLEANUP="$ROOT/hooks/oss-settings-cleanup.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }
inode_mode() { stat -f '%i %Lp' "$1" 2>/dev/null || stat -c '%i %a' "$1"; }
mode_of() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }

WITH_TELEGRAM='{"version":2,"telegram":{"botToken":"123:SECRET","chatId":"42","enabled":true},"notifications":{"style":"visual","telegram":{"botToken":"123:SECRET","chatId":"42","enabled":true}},"models":{"agents":{"oss:test-engineer":"ollama/gpt-oss:120b"}},"apiKeys":{"openrouter":"sk-or-x"}}'
EXPECTED='{"version":2,"notifications":{"style":"visual"},"models":{"agents":{"oss:test-engineer":"ollama/gpt-oss:120b"}},"apiKeys":{"openrouter":"sk-or-x"}}'

new_home() { T=$(mktemp -d); mkdir -p "$T/.oss"; S="$T/.oss/settings.json"; }
run_cleanup() { OUT=$(HOME="$T" bash "$CLEANUP" 2>/dev/null </dev/null); RC=$?; }

# 1. Both telegram keys removed, everything else identical, mode preserved, silent, exit 0
new_home; printf '%s\n' "$WITH_TELEGRAM" > "$S"; chmod 600 "$S"
run_cleanup
if [[ "$(jq 'has("telegram")' "$S" 2>/dev/null)" == "false" ]]; then pass "top-level telegram removed"
else fail "top-level telegram removed" "has(telegram)=$(jq 'has("telegram")' "$S" 2>&1)"; fi
if [[ "$(jq '.notifications | has("telegram")' "$S" 2>/dev/null)" == "false" ]]; then pass "notifications.telegram removed"
else fail "notifications.telegram removed" "$(jq -c '.notifications' "$S" 2>&1)"; fi
if [[ "$(jq -S . "$S" 2>/dev/null)" == "$(printf '%s' "$EXPECTED" | jq -S .)" ]]; then pass "every other setting unchanged"
else fail "every other setting unchanged" "$(jq -c . "$S" 2>&1)"; fi
if [[ "$(mode_of "$S")" == "600" ]]; then pass "file mode 600 preserved"; else fail "file mode 600 preserved" "mode=$(mode_of "$S")"; fi
if [[ $RC -eq 0 && -z "$OUT" ]]; then pass "exits 0 with no stdout"; else fail "exits 0 with no stdout" "rc=$RC out='$OUT'"; fi
if ! ls -A "$T/.oss" | grep -qv '^settings.json$'; then pass "no temp file left behind"; else fail "no temp file left behind" "$(ls -A "$T/.oss")"; fi

# 2. Running twice is a no-op (second run does not rewrite the file)
before=$(inode_mode "$S"); bytes_before=$(cat "$S")
run_cleanup
if [[ "$(inode_mode "$S")" == "$before" && "$(cat "$S")" == "$bytes_before" && $RC -eq 0 && -z "$OUT" ]]; then pass "second run is a no-op"
else fail "second run is a no-op" "inode/mode $before -> $(inode_mode "$S")"; fi
rm -rf "$T"

# 3. A settings.json without telegram keys is never rewritten (same inode, same bytes, odd formatting kept)
new_home; printf '{ "notifications" : {"style":"audio"},\n  "models":{}}\n' > "$S"; chmod 644 "$S"
before=$(inode_mode "$S"); bytes_before=$(cat "$S")
run_cleanup
if [[ "$(inode_mode "$S")" == "$before" && "$(cat "$S")" == "$bytes_before" ]]; then pass "file without telegram keys untouched"
else fail "file without telegram keys untouched" "inode/mode $before -> $(inode_mode "$S")"; fi
rm -rf "$T"

# 4. Only notifications.telegram present (no top-level key) is still cleaned; a 644 mode is kept
new_home; printf '{"notifications":{"style":"visual","telegram":{"botToken":"x"}}}' > "$S"; chmod 644 "$S"
run_cleanup
if [[ "$(jq -c . "$S" 2>/dev/null)" == '{"notifications":{"style":"visual"}}' && "$(mode_of "$S")" == "644" ]]; then pass "nested-only telegram removed, mode 644 kept"
else fail "nested-only telegram removed, mode 644 kept" "$(cat "$S") mode=$(mode_of "$S")"; fi
rm -rf "$T"

# 5. A non-object notifications value does not break the top-level cleanup
new_home; printf '{"telegram":{"botToken":"x"},"notifications":"off"}' > "$S"; chmod 600 "$S"
run_cleanup
if [[ "$(jq -c . "$S" 2>/dev/null)" == '{"notifications":"off"}' ]]; then pass "top-level telegram removed when notifications is not an object"
else fail "top-level telegram removed when notifications is not an object" "$(cat "$S")"; fi
rm -rf "$T"

# 6. A symlinked settings.json is refused: link stays a link, its target is untouched
new_home; printf '%s\n' "$WITH_TELEGRAM" > "$T/target.json"; ln -s "$T/target.json" "$S"
target_before=$(cat "$T/target.json")
run_cleanup
if [[ -L "$S" && "$(cat "$T/target.json")" == "$target_before" && $RC -eq 0 && -z "$OUT" ]]; then pass "symlinked settings.json refused, target untouched"
else fail "symlinked settings.json refused, target untouched" "link=$([[ -L $S ]] && echo y || echo n) target=$(cat "$T/target.json")"; fi
rm -rf "$T"

# 7. Invalid JSON is left untouched and the hook still exits 0 silently
new_home; printf '{"telegram": {"botToken": "x"' > "$S"; chmod 600 "$S"
before=$(inode_mode "$S"); bytes_before=$(cat "$S")
run_cleanup
if [[ "$(inode_mode "$S")" == "$before" && "$(cat "$S")" == "$bytes_before" && $RC -eq 0 && -z "$OUT" ]]; then pass "invalid JSON untouched, exit 0, silent"
else fail "invalid JSON untouched, exit 0, silent" "rc=$RC out='$OUT' bytes=$(cat "$S")"; fi
rm -rf "$T"

# 8. No settings.json at all: exit 0, silent, nothing created
new_home
run_cleanup
if [[ ! -e "$S" && $RC -eq 0 && -z "$OUT" ]]; then pass "missing settings.json: exit 0, silent, nothing created"
else fail "missing settings.json: exit 0, silent, nothing created" "rc=$RC out='$OUT'"; fi
rm -rf "$T"

# 9. Session start runs the cleanup (the token is gone after a real session start)
new_home; printf '%s\n' "$WITH_TELEGRAM" > "$S"; chmod 600 "$S"
HOME="$T" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 bash "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 </dev/null
if [[ "$(jq -S . "$S" 2>/dev/null)" == "$(printf '%s' "$EXPECTED" | jq -S .)" ]]; then pass "oss-session-start.sh removes the telegram keys"
else fail "oss-session-start.sh removes the telegram keys" "$(jq -c . "$S" 2>&1)"; fi
rm -rf "$T"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
