#!/bin/bash
# Test: No && chaining between separate script calls in command wrappers
# Compound commands trigger Claude Code's "multiple commands" security warning
set -euo pipefail

COMMANDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "Test: No && chaining between script calls in command wrappers"

VIOLATIONS=()
for file in "$COMMANDS_DIR"/*.md; do
    name=$(basename "$file")
    # Look for patterns like: script1.sh && script2 or script1.sh && ~/
    # Inside code blocks (``` sections)
    in_code_block=false
    line_num=0
    while IFS= read -r line; do
        line_num=$((line_num + 1))
        if [[ "$line" == '```'* ]]; then
            if $in_code_block; then
                in_code_block=false
            else
                in_code_block=true
            fi
            continue
        fi
        if $in_code_block; then
            # Match: something.sh && something (two scripts chained)
            if echo "$line" | grep -qE '\.sh\s+&&\s+' 2>/dev/null; then
                # Skip lines in negative examples (❌, WRONG, AVOID)
                if echo "$line" | grep -qE '❌|WRONG|AVOID' 2>/dev/null; then
                    continue
                fi
                VIOLATIONS+=("$name:$line_num: $line")
            fi
        fi
    done < "$file"
done

if [[ ${#VIOLATIONS[@]} -eq 0 ]]; then
    pass "No && chaining found in any command wrapper"
else
    for v in "${VIOLATIONS[@]}"; do
        fail "$v"
    done
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
