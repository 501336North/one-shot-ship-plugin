#!/usr/bin/env bash
# @behavior Every "BSD or GNU" stat fallback in hooks/ and commands/ asks GNU first (`stat -c ... || stat -f ...`).
# @business-rule On GNU/Linux `stat -f` means --file-system: it prints a filesystem block to stdout and
#           exits 1, so a BSD-first fallback captures that junk plus the GNU answer. That silently broke
#           the Telegram-token cleanup on every Linux box. GNU's `-c` is an error on BSD, so GNU-first is safe on both.
# Usage: ./hooks/__tests__/stat-order.test.sh
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
# A BSD-first fallback: `stat [-L] -f ...` followed by `||` and then `stat [-L] -c ...` on the same line.
WRONG='stat( -L)? -f[^|]*\|\|[^|]*stat( -L)? -c'
RIGHT='stat( -L)? -c[^|]*\|\|[^|]*stat( -L)? -f'
scan() { grep -rnE "$1" "$DIR/hooks" "$DIR/commands" 2>/dev/null | grep -v "^$SELF:"; }

FIX=$(mktemp -d); printf 'M=$(stat -f %%Lp "$f" 2>/dev/null || stat -c %%a "$f")\n' > "$FIX/bad.sh"
check "scanner flags a planted BSD-first fallback (anti-vacuity)" 'grep -qE "$WRONG" "$FIX/bad.sh"'
rm -rf "$FIX"
check "scanner sees GNU-first fallbacks in the tree (anchor)" '[ -n "$(scan "$RIGHT")" ]'
OFFENDERS=$(scan "$WRONG")
check "no BSD-first stat fallback in hooks/ or commands/" '[ -z "$OFFENDERS" ]'
[ -n "$OFFENDERS" ] && printf '%s\n' "$OFFENDERS" | sed 's/^/  offender: /'
echo "Results: $pass/$((pass+fail)) passed, $fail failed"
[ "$fail" -eq 0 ]
