#!/usr/bin/env bash
# @behavior oss-notify.sh carries no dead notification-filter state (telegram-removal phase 2):
#   once the Telegram block went, nothing read SKIP_NOTIFICATION, and nothing reads PRIORITY or
#   VERBOSITY except that filter. Assigning them is dead code that implies a filter which no longer exists.
#   STYLE is still read (direct-call audio/sound) and must stay.
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SH="$DIR/hooks/oss-notify.sh"
pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
check "oss-notify.sh exists (anchor)" '[ -f "$SH" ]'
check "STYLE is still loaded and read (anchor)" 'grep -qE "^[[:space:]]*STYLE=" "$SH" && grep -q "case \"\$STYLE\" in" "$SH"'
check "does not assign SKIP_NOTIFICATION" '! grep -qE "SKIP_NOTIFICATION=" "$SH"'
check "does not assign PRIORITY" '! grep -qE "(^|[^_A-Z])PRIORITY=" "$SH"'
check "does not assign VERBOSITY" '! grep -qE "(^|[^_A-Z])VERBOSITY=" "$SH"'
check "no stale verbosity-filter section" '! grep -qi "Filter by verbosity" "$SH"'
echo "Results: $pass/$((pass+fail)) passed"
[ "$fail" -eq 0 ]
