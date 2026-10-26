#!/usr/bin/env bash
# @behavior The plugin ships no Telegram hook script (telegram-removal phase 2).
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
check "hooks dir exists (anchor)" '[ -d "$DIR/hooks" ]'
check "hooks/oss-telegram.sh is gone" '[ ! -e "$DIR/hooks/oss-telegram.sh" ]'
check "plugin CLAUDE.md no longer points at the Telegram Driver repo" '! grep -qi "telegram driver" "$DIR/CLAUDE.md"'
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
