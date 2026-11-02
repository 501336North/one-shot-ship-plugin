#!/bin/bash
# Contract tests for commands/login.md setup gating.
#
# login.md is a clear-text bootstrap command (no API-served copy). It must gate
# its install-success claim on the real verifier (verify-decrypt-setup.sh), not
# on a bare `[ -x oss-decrypt ]` file-exists check that a crashing binary passes.
#
# Usage: ./login-setup-gate.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGIN_MD="$SCRIPT_DIR/../../commands/login.md"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  Expected: $2"; echo "  Got: $3"; ((TESTS_FAILED++)); }

# =============================================================================
# @behavior /oss:login declares setup success only via the real verifier.
# @acceptance-criteria login.md references verify-decrypt-setup.sh.
# =============================================================================
test_login_references_verifier() {
    local test_name="login.md gates setup success on verify-decrypt-setup.sh"
    ((TESTS_RUN++))
    if grep -q "verify-decrypt-setup.sh" "$LOGIN_MD"; then
        pass "$test_name"
    else
        fail "$test_name" "login.md references verify-decrypt-setup.sh" "no reference found"
    fi
}

# =============================================================================
# @behavior The old false-positive success line (guarded only by `[ -x ]`) is gone.
# @acceptance-criteria login.md no longer prints an unconditional
#           'CLI installed successfully' that a crashing-but-present binary passes.
# =============================================================================
test_login_no_false_success_line() {
    local test_name="login.md no longer prints success on a bare [ -x ] check"
    ((TESTS_RUN++))
    if ! grep -q 'echo "CLI installed successfully"' "$LOGIN_MD"; then
        pass "$test_name"
    else
        fail "$test_name" "no unconditional 'CLI installed successfully' echo" \
            "found the false-positive success line still gated by [ -x ]"
    fi
}

# -----------------------------------------------------------------------------
# Step 9 "Save settings" block: extracted from login.md and run for real.
# -----------------------------------------------------------------------------
# Prints the first ```bash block under "## Step 9", de-indented (the heredoc
# terminator only works at column 0, as a model running the step would type it).
step9_save_block() {
    awk '/^## Step 9/{on=1; next} on && /^## /{exit}
         on && !inb && /^ *```bash/{inb=1; next}
         on && inb && /^ *```/{exit}
         on && inb' "$LOGIN_MD" | sed 's/^   //'
}

# Sets up a temp HOME with a fake oss-value.sh that prints the chosen style.
make_step9_home() {
    local home; home=$(mktemp -d)
    mkdir -p "$home/.oss/hooks"
    printf '#!/bin/bash\n[[ "$1 $2" == "read style" ]] && echo sound\n' > "$home/.oss/hooks/oss-value.sh"
    chmod +x "$home/.oss/hooks/oss-value.sh"
    cp "$SCRIPT_DIR/../oss-api-curl.sh" "$home/.oss/hooks/"  # installed with the other hooks before Step 9
    echo "$home"
}

run_step9() { HOME="$1" bash -c "$(step9_save_block)" >/dev/null 2>&1; }

# =============================================================================
# @behavior Re-running first-login setup never wipes a user's saved settings.
# @acceptance-criteria an existing settings.json (decisionsPush opt-out, models)
#           is byte-identical after the Step 9 save block runs.
# =============================================================================
test_step9_keeps_existing_settings() {
    local test_name="Step 9 save leaves an existing settings.json byte-identical"
    ((TESTS_RUN++))
    local home; home=$(make_step9_home)
    local before='{"decisionsPush":false,"models":{"x":1}}'
    printf '%s' "$before" > "$home/.oss/settings.json"
    run_step9 "$home"
    local after; after=$(cat "$home/.oss/settings.json")
    if [[ "$after" == "$before" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "$before" "$after"
    fi
    rm -rf "$home"
}

# =============================================================================
# @behavior First-login setup never writes through a symlinked settings path.
# @acceptance-criteria a symlink at ~/.oss/settings.json leaves its target untouched.
# =============================================================================
test_step9_does_not_write_through_symlink() {
    local test_name="Step 9 save does not write through a settings.json symlink"
    ((TESTS_RUN++))
    local home; home=$(make_step9_home)
    local target; target=$(mktemp -d)/elsewhere.json
    printf 'ORIGINAL' > "$target"
    ln -s "$target" "$home/.oss/settings.json"
    run_step9 "$home"
    local after; after=$(cat "$target")
    if [[ "$after" == "ORIGINAL" && -L "$home/.oss/settings.json" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "symlink target still 'ORIGINAL'" "$after"
    fi
    rm -rf "$home" "$(dirname "$target")"
}

# =============================================================================
# @behavior A genuine first login writes the default settings with the chosen style.
# @acceptance-criteria with no settings.json, the block writes valid JSON whose
#           notifications.style is the style oss-value.sh returned.
# =============================================================================
test_step9_writes_defaults_on_first_login() {
    local test_name="Step 9 save writes default settings with the chosen style"
    ((TESTS_RUN++))
    local home; home=$(make_step9_home)
    run_step9 "$home"
    local style; style=$(jq -r '.notifications.style' "$home/.oss/settings.json" 2>/dev/null)
    local version; version=$(jq -r '.version' "$home/.oss/settings.json" 2>/dev/null)
    if [[ "$style" == "sound" && "$version" == "1" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "style=sound version=1" "style=$style version=$version"
    fi
    rm -rf "$home"
}

# =============================================================================
# @behavior The settings file a first login makes is readable by its owner only.
# @acceptance-criteria under the usual umask 022, the new settings.json is mode 600
#           (it later holds the watcher's apiKeys; every later writer also saves it at 600).
# =============================================================================
test_step9_new_file_is_private() {
    local test_name="Step 9 save makes a new settings.json 600, even under umask 022"
    ((TESTS_RUN++))
    local home; home=$(make_step9_home)
    (umask 022; run_step9 "$home")
    local mode; mode=$(stat -c %a "$home/.oss/settings.json" 2>/dev/null || stat -f %Lp "$home/.oss/settings.json" 2>/dev/null)
    if [[ "$mode" == 600 && "$(jq -r '.notifications.style' "$home/.oss/settings.json" 2>/dev/null)" == sound ]]; then
        pass "$test_name"
    else
        fail "$test_name" "mode 600 with the chosen style" "mode=$mode"
    fi
    rm -rf "$home"
}

# =============================================================================
# @behavior A settings file another OSS writer creates while first-login setup runs is kept, keys and all:
#           a decisionsPush:false saved a moment before is never replaced by the defaults.
# @acceptance-criteria Task 16an: a settings.json that appears after the "is there one?" check, just as the
#           block writes, still holds its own keys afterwards (the write goes through oss_settings_update,
#           under the settings lock, with a filter that keeps an existing object).
# =============================================================================
test_step9_keeps_a_file_that_appears_mid_write() {
    local test_name="Step 9 save keeps a settings.json another writer creates between the check and the write"
    ((TESTS_RUN++))
    local home; home=$(make_step9_home)
    local sb; sb=$(mktemp -d); local t w
    # seam: the first of cat/jq/mktemp the block runs (any of them comes after the check) is when the other
    # writer's file lands
    for t in cat jq mktemp; do
        w=$(command -v "$t")
        printf '#!/bin/bash\nif [[ ! -e "%s/appeared" ]]; then : > "%s/appeared"; printf %%s %s > "%s"; fi\nexec "%s" "$@"\n' \
            "$sb" "$sb" "'{\"decisionsPush\":false,\"models\":{\"x\":1}}'" "$home/.oss/settings.json" "$w" > "$sb/$t"
        chmod +x "$sb/$t"
    done
    HOME="$home" PATH="$sb:$PATH" bash -c "$(step9_save_block)" >/dev/null 2>&1
    local got; got=$(jq -c '[.decisionsPush, .models.x, (.notifications | type)]' "$home/.oss/settings.json" 2>/dev/null)
    if [[ -e "$sb/appeared" && "$got" == '[false,1,"null"]' ]]; then
        pass "$test_name"
    else
        fail "$test_name" "the other writer's keys kept: [false,1,\"null\"]" "appeared=$([[ -e "$sb/appeared" ]] && echo y || echo n) got=$got file=$(cat "$home/.oss/settings.json" 2>/dev/null)"
    fi
    rm -rf "$home" "$sb"
}

echo "Running login.md setup-gate contract tests..."
echo "============================================="
test_login_references_verifier
test_login_no_false_success_line
test_step9_keeps_existing_settings
test_step9_does_not_write_through_symlink
test_step9_writes_defaults_on_first_login
test_step9_new_file_is_private
test_step9_keeps_a_file_that_appears_mid_write
echo ""
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -gt 0 ]] && exit 1
exit 0
