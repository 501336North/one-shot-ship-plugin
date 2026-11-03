#!/bin/bash
# Customer-facing docs recommend auto mode, and name the permission-skipping flag only with its sandbox caveat (T71d)
#
# Usage: ./commands/__tests__/no-skip-permissions-advice.test.sh
#        PLUGIN_UNDER_TEST=/path/to/plugin-copy ./commands/__tests__/no-skip-permissions-advice.test.sh  (mutants)
#
# @behavior A customer who reads a command, skill, agent, the README or the drain integration doc is told to run
#           `claude --permission-mode auto` for walk-away or zero-approval runs. --dangerously-skip-permissions (or
#           bypassPermissions) is named only with the CLI's own caveat, on the same or an adjacent line: for
#           sandboxed machines with no internet access.
# @business-rule --dangerously-skip-permissions bypasses every permission check. Claude Code's own help says it is
#           "Recommended only for sandboxes with no internet access". Auto mode approves on its own and keeps the
#           safety checks, so it is the advice a paying customer on a normal machine should follow.
# @business-rule The allowlist holds exact "<file><TAB><line>" exceptions for legitimate mentions that the caveat rule
#           cannot express. An entry that no longer matches a mention is stale and fails, so the list only shrinks.
set -uo pipefail
# A developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not matter here; this test reads no config.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PLUGIN_UNDER_TEST:-$(cd "$HERE/../.." && pwd)}"
ALLOW="$HERE/no-skip-permissions-advice-allow.txt"

# The permission-skipping spellings a customer could copy.
PATTERN='dangerously-skip-permissions|bypassPermissions'
# The CLI's caveat: the sandbox wording and the no-internet condition, both on one line. Lowercase: matched
# against the lowercased line.
CAVEAT='sandbox.*no internet access'
# The advice the customer-facing docs must give.
RECOMMENDED='--permission-mode auto'
# Files that customers read: the prompts (commands, skills, agents), the README and the drain integration doc.
# The test fixtures under __tests__ are not customer-facing.
SCOPE_DIRS="commands skills agents"
SCOPE_ROOT_FILES="README.md DRAIN_SH_INTEGRATION.md"
# The files that must recommend auto mode (the two places the zero-approval advice lives).
RECOMMEND_FILES="commands/auto.md DRAIN_SH_INTEGRATION.md"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    ((TESTS_FAILED++))
}

# scoped_files: the customer-facing files of $ROOT, one repo-relative path per line
scoped_files() {
    local d f
    for d in $SCOPE_DIRS; do
        [[ -d "$ROOT/$d" ]] || continue
        (cd "$ROOT" && find "$d" -type f -not -path '*/__tests__/*')
    done
    for f in $SCOPE_ROOT_FILES; do
        [[ -f "$ROOT/$f" ]] && echo "$f"
    done
    return 0
}

# raw_hits: "<file><TAB><line text>" for every permission-skipping mention in a customer-facing file
raw_hits() {
    local f hit
    scoped_files | while IFS= read -r f; do
        grep -nE "$PATTERN" "$ROOT/$f" | while IFS= read -r hit; do
            printf '%s\t%s\n' "$f" "${hit#*:}"
        done
    done
}

# caveat_near <file> <line number>: the sandbox caveat is on that line or the line before or after it
caveat_near() {
    awk -v n="$2" -v re="$CAVEAT" 'NR >= n - 1 && NR <= n + 1 && tolower($0) ~ re { found = 1 } END { exit !found }' "$ROOT/$1"
}

# allow_entries: the exemption lines of ALLOW, without comments and blank lines
allow_entries() {
    [[ -f "$ALLOW" ]] || return 0
    grep -vE '^(#|$)' "$ALLOW"
}

# offenders: "<file>:<line>: <text>" for each mention with no caveat nearby and no allowlist entry
offenders() {
    local f hit num text entries
    entries=$(allow_entries)
    scoped_files | while IFS= read -r f; do
        grep -nE "$PATTERN" "$ROOT/$f" | while IFS= read -r hit; do
            num="${hit%%:*}"
            text="${hit#*:}"
            grep -qxF "$f"$'\t'"$text" <<<"$entries" && continue
            caveat_near "$f" "$num" && continue
            echo "$f:$num: $text"
        done
    done
}

# stale_entries: allowlist entries that no longer match any mention
stale_entries() {
    local entry hits
    hits=$(raw_hits)
    allow_entries | while IFS= read -r entry; do
        grep -qxF "$entry" <<<"$hits" || echo "$entry"
    done
}

# Control fixtures: each tree holds one file under commands/ and checks the detector on its own.
CTRL=$(mktemp -d)
trap 'rm -rf "$CTRL"' EXIT
mkdir -p "$CTRL/bare/commands" "$CTRL/same/commands" "$CTRL/adjacent/commands" "$CTRL/far/commands" "$CTRL/tests/commands/__tests__"
printf 'claude --dangerously-skip-permissions\n' > "$CTRL/bare/commands/x.md"
printf 'Sandboxed machines with no internet access only: claude --dangerously-skip-permissions\n' > "$CTRL/same/commands/x.md"
printf 'Sandboxed machines with no internet access only.\nclaude --dangerously-skip-permissions\n' > "$CTRL/adjacent/commands/x.md"
printf 'Sandboxed machines with no internet access only.\n\nclaude --dangerously-skip-permissions\n' > "$CTRL/far/commands/x.md"
printf 'claude --dangerously-skip-permissions\n' > "$CTRL/tests/commands/__tests__/x.md"

echo "=== no-skip-permissions-advice: customer-facing docs ==="
echo ""

# Control 1: the detector flags a bare mention
echo "Control 1: a bare permission-skipping mention is an offender"
out=$(ROOT="$CTRL/bare"; ALLOW="$CTRL/none"; offenders)
if [[ "$out" == "commands/x.md:1: claude --dangerously-skip-permissions" ]]; then
    pass "bare mention is reported"
else
    fail "bare mention is reported" "commands/x.md:1: ..." "$out"
fi

# Control 2: the caveat counts on the same or an adjacent line, not two lines away
echo ""
echo "Control 2: the sandbox caveat is honoured on the same or an adjacent line only"
same=$(ROOT="$CTRL/same"; ALLOW="$CTRL/none"; offenders)
adj=$(ROOT="$CTRL/adjacent"; ALLOW="$CTRL/none"; offenders)
far=$(ROOT="$CTRL/far"; ALLOW="$CTRL/none"; offenders)
if [[ -z "$same" ]]; then pass "caveat on the same line passes"; else fail "caveat on the same line passes" "no offenders" "$same"; fi
if [[ -z "$adj" ]]; then pass "caveat on the adjacent line passes"; else fail "caveat on the adjacent line passes" "no offenders" "$adj"; fi
if [[ "$far" == "commands/x.md:3: claude --dangerously-skip-permissions" ]]; then
    pass "caveat two lines away does not pass"
else
    fail "caveat two lines away does not pass" "commands/x.md:3: ..." "$far"
fi

# Control 3: __tests__ fixtures are not customer-facing
echo ""
echo "Control 3: __tests__ files are outside the customer-facing scope"
tests=$(ROOT="$CTRL/tests"; ALLOW="$CTRL/none"; offenders)
if [[ -z "$tests" ]]; then pass "__tests__ mention is not scanned"; else fail "__tests__ mention is not scanned" "no offenders" "$tests"; fi

# Test 1: no customer-facing file names the flag or bypassPermissions without the caveat
echo ""
echo "Test 1: customer-facing docs name the flag only with the sandbox caveat"
off=$(offenders)
if [[ -z "$off" ]]; then
    pass "no customer-facing file has an uncaveated permission-skipping mention"
else
    fail "no customer-facing file has an uncaveated permission-skipping mention" "no offenders" "$off"
fi

# Test 2: the allowlist holds no stale exemptions
echo ""
echo "Test 2: every allowlist entry still matches a mention"
stale=$(stale_entries)
if [[ -z "$stale" ]]; then
    pass "no stale allowlist entries"
else
    fail "no stale allowlist entries" "no stale entries" "$stale"
fi

# Test 3: the zero-approval advice recommends auto mode
echo ""
echo "Test 3: the zero-approval advice recommends claude --permission-mode auto"
for f in $RECOMMEND_FILES; do
    if grep -qF -- "$RECOMMENDED" "$ROOT/$f"; then
        pass "$f recommends $RECOMMENDED"
    else
        fail "$f recommends $RECOMMENDED" "$RECOMMENDED in $f" "not found"
    fi
done

echo ""
echo "=== Results: $TESTS_PASSED passed, $TESTS_FAILED failed ==="
[[ $TESTS_FAILED -eq 0 ]]
