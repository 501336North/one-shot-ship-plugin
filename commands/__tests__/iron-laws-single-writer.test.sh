#!/bin/bash
# Tests that command docs agree with what oss-iron-laws-sync.sh actually does.
#
# @behavior /oss:login writes the IRON LAWS block exactly once, through one writer
#           (oss-iron-laws-sync.sh --install); other commands only refresh an existing block.
# @business-rule Two writers produced two blocks in one CLAUDE.md (ship gate round 1, cr MEDIUM);
#           command docs must not promise behaviour the script does not have.
#
# Usage: ./commands/__tests__/iron-laws-single-writer.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYNC="$COMMANDS_DIR/../hooks/oss-iron-laws-sync.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  Expected: $2"; echo "  Got: $3"; ((TESTS_FAILED++)); }

section() { # $1 file, $2 heading prefix of the section; prints until the next "## " heading
    awk -v h="$2" 'index($0, h) == 1 { on = 1; print; next } on && /^## / { exit } on { print }' "$1"
}

LOGIN_STEP4=$(section "$COMMANDS_DIR/login.md" "## Step 4")
IDEATE_STEP1=$(section "$COMMANDS_DIR/ideate.md" "## Step 1")

test_login_uses_install() {
    local name="login Step 4 runs oss-iron-laws-sync.sh --install"; ((TESTS_RUN++))
    if grep -qE 'oss-iron-laws-sync\.sh --install' <<< "$LOGIN_STEP4"; then pass "$name"
    else fail "$name" "a --install invocation in Step 4" "none"; fi
}

test_login_does_not_write_block_itself() {
    local name="login Step 4 does not also write the IRON LAWS block itself"; ((TESTS_RUN++))
    local hits
    hits=$(grep -nE 'IRON LAWS START|\{IRON_LAWS_CONTENT\}|IRON LAWS END' <<< "$LOGIN_STEP4")
    if [[ -z "$hits" ]]; then pass "$name"
    else fail "$name" "no marker lines or {IRON_LAWS_CONTENT} in Step 4" "$hits"; fi
}

test_only_login_installs() {
    local name="only login.md uses --install; other commands only refresh"; ((TESTS_RUN++))
    local hits
    hits=$(grep -l 'oss-iron-laws-sync\.sh --install' "$COMMANDS_DIR"/*.md | grep -v '/login\.md$')
    if [[ -z "$hits" ]]; then pass "$name"
    else fail "$name" "no other command installs" "$hits"; fi
}

test_ideate_claims_match_script() {
    local name="ideate Step 1 makes no claim the script does not keep"; ((TESTS_RUN++))
    local bad=""
    grep -qiE '^- *Creates CLAUDE\.md' <<< "$IDEATE_STEP1" && bad+="claims it creates CLAUDE.md (refresh never creates); "
    if grep -qi 'JSON pars' <<< "$IDEATE_STEP1" && ! grep -qF 'JSON.parse(' "$SYNC"; then
        bad+="claims JSON parsing but the script does not JSON.parse; "
    fi
    if [[ -z "$bad" ]]; then pass "$name"
    else fail "$name" "accurate description" "$bad"; fi
}

# S2 (ship gate round 2): a refused or failed --install must stop Step 4, so the template merge
# (4.2-4.3) cannot create or rewrite a CLAUDE.md the script declined to touch, or leave the
# project with a template and no laws. The exit codes the doc names must be the script's own.
test_login_stops_when_install_fails() {
    local name="login Step 4 stops (skips 4.2-4.3) when --install exits 3 or 4, and says why"; ((TESTS_RUN++))
    local bad=""
    grep -qF 'skip 4.2 and 4.3' <<< "$LOGIN_STEP4" || bad+="no 'skip 4.2 and 4.3' instruction; "
    grep -qiE 'exit(s)? 3' <<< "$LOGIN_STEP4" || bad+="exit 3 (refused) not handled; "
    grep -qiE 'exit(s)? 4' <<< "$LOGIN_STEP4" || bad+="exit 4 (no laws) not handled; "
    grep -qi 'continue with 4.2' <<< "$LOGIN_STEP4" && bad+="still says 'continue with 4.2'; "
    grep -qi '4.1 refused' <<< "$LOGIN_STEP4" && bad+="4.3 still handles a refused 4.1; "
    grep -qE '^#[[:space:]]+3[[:space:]].*refus' "$SYNC" || bad+="script header does not define exit 3 as refusal; "
    grep -qE '^#[[:space:]]+4[[:space:]].*laws' "$SYNC" || bad+="script header does not define exit 4 as no laws; "
    if [[ -z "$bad" ]]; then pass "$name"
    else fail "$name" "Step 4 stops on exit 3/4 with a reason; codes match the script" "$bad"; fi
}

test_no_other_doc_builds_markers() {
    local name="no skill or command (other than via oss-iron-laws-sync.sh) tells the model to write IRON LAWS START/END markers"; ((TESTS_RUN++))
    local bad
    bad=$(grep -lE 'IRON LAWS (START|END)' "$COMMANDS_DIR"/*.md "$COMMANDS_DIR"/../skills/*.md 2>/dev/null | while read -r f; do
        grep -qE 'oss-iron-laws-sync\.sh --install' "$f" || echo "$(basename "$f")"
    done)
    if [[ -z "$bad" ]]; then pass "$name"
    else fail "$name" "marker writing only via oss-iron-laws-sync.sh --install" "$bad"; fi
}

echo "Running IRON LAWS single-writer doc tests..."
echo "======================================="
test_login_uses_install
test_login_does_not_write_block_itself
test_only_login_installs
test_ideate_claims_match_script
test_login_stops_when_install_fails
test_no_other_doc_builds_markers
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
