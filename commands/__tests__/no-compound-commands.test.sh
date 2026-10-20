#!/bin/bash
# Test: No && chaining between separate script calls in command wrappers
# Compound commands trigger Claude Code's "multiple commands" security warning
#
# @behavior A user runs an /oss command and its value hand-offs run without an approval prompt.
# @business-rule Claude Code auto-approves a Bash call only when it matches an allowed prefix such
#           as Bash(~/.oss/hooks/oss-value.sh:*) literally; a $(...) substitution chained with
#           && or ; asks even when every part is allowed (ship round 5, R5-1). So no wrapper shell
#           line that runs an oss hook combines $( with && or ;, and no wrapper spells the helper
#           "$HOME/.oss/hooks/oss-value.sh" (that spelling never matches the allowed prefix).
set -euo pipefail

COMMANDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

# violations <file...>: "<file>:<line>: <rule>: <text>" for each rule a line breaks
violations() {
    local file name in_code_block line_num line
    for file in "$@"; do
        name=$(basename "$file")
        in_code_block=false
        line_num=0
        while IFS= read -r line; do
            line_num=$((line_num + 1))
            # the allowed prefix is ~/.oss/hooks/oss-value.sh; this spelling never matches it
            if [[ "$line" == *'"$HOME/.oss/hooks/oss-value.sh"'* ]]; then
                echo "$name:$line_num: not-allowlisted-spelling: $line"
            fi
            if [[ "$line" =~ ^[[:space:]]*\`\`\` ]]; then
                if $in_code_block; then in_code_block=false; else in_code_block=true; fi
                continue
            fi
            $in_code_block || continue
            # Skip lines in negative examples (❌, WRONG, AVOID)
            echo "$line" | grep -qE '❌|WRONG|AVOID' 2>/dev/null && continue
            # Match: something.sh && something (two scripts chained)
            if echo "$line" | grep -qE '\.sh\s+&&\s+' 2>/dev/null; then
                echo "$name:$line_num: script-and-chain: $line"
            fi
            # a $( on a line that runs an oss hook, chained with && or ; (R5-1)
            if [[ "$line" == *'$('* && ( "$line" == *'&&'* || "$line" == *';'* ) \
                  && ( "$line" == *'oss-value.sh'* || "$line" == *'~/.oss/'* || "$line" == *'$HOME/.oss/'* ) ]]; then
                echo "$name:$line_num: substitution-in-chain: $line"
            fi
        done < "$file"
    done
}

echo "Test: detector control (every line marked flag is reported once, the others never)"
ctl=$(mktemp -d)
cat > "$ctl/c.md" <<'FIXTURE'
```bash
T=$(~/.oss/hooks/oss-value.sh read category) && N=$(~/.oss/hooks/oss-value.sh read name) && ~/.oss/bin/oss-decrypt --type "$T" --name "$N"
R=$("$HOME/.oss/hooks/oss-value.sh" root) && node "$R/watcher/dist/cli/webhook-setup.js" setup
X=$(~/.oss/hooks/oss-value.sh root); echo "$X"
a.sh && b.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "  Mode: $([ "$V" = "true" ] && echo "Voice" || echo "Sound")"
~/.oss/hooks/oss-value.sh decrypt
PLUGIN_ROOT=$(~/.oss/hooks/oss-value.sh root) || exit 1
```
Run `"$HOME/.oss/hooks/oss-value.sh" dir` and note the folder.
Run `~/.oss/hooks/oss-value.sh dir` and note the folder.
FIXTURE
got=$(violations "$ctl/c.md")
want='c.md:2: substitution-in-chain
c.md:3: not-allowlisted-spelling
c.md:3: substitution-in-chain
c.md:4: substitution-in-chain
c.md:5: script-and-chain
c.md:11: not-allowlisted-spelling'
if [[ "$(printf '%s\n' "$got" | cut -d: -f1-3)" == "$want" ]]; then
    pass "the detector flags exactly the 6 marked rule hits"
else
    fail "the detector flags exactly the 6 marked rule hits: got $(printf '%s\n' "$got" | cut -d: -f1-3 | tr '\n' ' ')"
fi
rm -rf "$ctl"

echo "Test: No && chaining between script calls in command wrappers"
VIOLATIONS=()
while IFS= read -r v; do [[ -n "$v" ]] && VIOLATIONS+=("$v"); done < <(violations "$COMMANDS_DIR"/*.md)

if [[ ${#VIOLATIONS[@]} -eq 0 ]]; then
    pass "No && chaining, chained \$( on a hook line, or \"\$HOME\" helper spelling in any command wrapper"
else
    for v in "${VIOLATIONS[@]}"; do
        fail "$v"
    done
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
