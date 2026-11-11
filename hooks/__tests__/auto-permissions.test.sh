#!/bin/bash
# Test: oss-setup-permissions.sh creates .claude/settings.local.json
set -euo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SCRIPT="$SCRIPT_DIR/oss-setup-permissions.sh"
PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

# --- Test 1: Creates settings.local.json when missing ---
echo "Test 1: Creates settings.local.json when missing"
TMPDIR_1=$(mktemp -d)
"$SETUP_SCRIPT" "$TMPDIR_1"
if [[ -f "$TMPDIR_1/.claude/settings.local.json" ]]; then
    pass "File created"
else
    fail "File not created"
fi
# Check it has OSS permission entries
if grep -q 'oss-log.sh' "$TMPDIR_1/.claude/settings.local.json" 2>/dev/null; then
    pass "Contains oss-log.sh permission"
else
    fail "Missing oss-log.sh permission"
fi
if grep -q 'oss-notify.sh' "$TMPDIR_1/.claude/settings.local.json" 2>/dev/null; then
    pass "Contains oss-notify.sh permission"
else
    fail "Missing oss-notify.sh permission"
fi
if grep -q 'oss-decrypt' "$TMPDIR_1/.claude/settings.local.json" 2>/dev/null; then
    pass "Contains oss-decrypt permission"
else
    fail "Missing oss-decrypt permission"
fi
rm -rf "$TMPDIR_1"

# --- Test 2: Does NOT overwrite existing file with custom entries ---
echo "Test 2: Does not overwrite existing settings with custom entries"
TMPDIR_2=$(mktemp -d)
mkdir -p "$TMPDIR_2/.claude"
cat > "$TMPDIR_2/.claude/settings.local.json" << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(my-custom-script:*)",
      "WebSearch"
    ],
    "deny": [],
    "ask": []
  }
}
EOF
"$SETUP_SCRIPT" "$TMPDIR_2"
# Must still have custom entry
if grep -q 'my-custom-script' "$TMPDIR_2/.claude/settings.local.json"; then
    pass "Custom entry preserved"
else
    fail "Custom entry lost"
fi
# Must also have OSS entries now
if grep -q 'oss-log.sh' "$TMPDIR_2/.claude/settings.local.json"; then
    pass "OSS entries merged in"
else
    fail "OSS entries not merged"
fi
rm -rf "$TMPDIR_2"

# --- Test 3: Does not duplicate entries on re-run ---
echo "Test 3: Idempotent — no duplicates on re-run"
TMPDIR_3=$(mktemp -d)
"$SETUP_SCRIPT" "$TMPDIR_3"
"$SETUP_SCRIPT" "$TMPDIR_3"
COUNT=$(grep -c 'oss-log.sh' "$TMPDIR_3/.claude/settings.local.json" || echo "0")
if [[ "$COUNT" -eq 1 ]]; then
    pass "No duplicate oss-log.sh entries"
else
    fail "Found $COUNT oss-log.sh entries (expected 1)"
fi
rm -rf "$TMPDIR_3"

# --- Test 4: Valid JSON output ---
echo "Test 4: Output is valid JSON"
TMPDIR_4=$(mktemp -d)
"$SETUP_SCRIPT" "$TMPDIR_4"
if python3 -c "import json; json.load(open('$TMPDIR_4/.claude/settings.local.json'))" 2>/dev/null; then
    pass "Valid JSON"
else
    fail "Invalid JSON"
fi
rm -rf "$TMPDIR_4"

# --- Test 5: the value-folder helper is allowed (ship round 5, R5-1) ---
# @behavior A user runs /oss:trust, /oss:models set, /oss:webhook, /oss:login and the other value
#           hand-offs without an approval prompt: each is one `~/.oss/hooks/oss-value.sh <verb>` call.
# @business-rule Claude Code matches the prefix literally, so the rule is this exact string.
echo "Test 5: Allows ~/.oss/hooks/oss-value.sh (fresh and merged)"
TMPDIR_5=$(mktemp -d)
"$SETUP_SCRIPT" "$TMPDIR_5"
grep -qF '"Bash(~/.oss/hooks/oss-value.sh:*)"' "$TMPDIR_5/.claude/settings.local.json" && pass "Fresh file allows oss-value.sh" || fail "Fresh file does not allow oss-value.sh"
grep -qF '"Edit(~/.oss/run/**)"' "$TMPDIR_5/.claude/settings.local.json" && pass "Fresh file allows value-file writes in ~/.oss/run" || fail "Fresh file does not allow value-file writes in ~/.oss/run"
! grep -qF 'oss-login.sh' "$TMPDIR_5/.claude/settings.local.json" && pass "Fresh file does not allow oss-login.sh (a key change always asks, R5-8)" || fail "Fresh file allows oss-login.sh (a key change must always ask, R5-8)"
printf '{"permissions":{"allow":["WebSearch"]}}\n' > "$TMPDIR_5/.claude/settings.local.json"
"$SETUP_SCRIPT" "$TMPDIR_5"
grep -qF '"Bash(~/.oss/hooks/oss-value.sh:*)"' "$TMPDIR_5/.claude/settings.local.json" && pass "Merged file allows oss-value.sh" || fail "Merged file does not allow oss-value.sh"
grep -qF '"Edit(~/.oss/run/**)"' "$TMPDIR_5/.claude/settings.local.json" && pass "Merged file allows value-file writes in ~/.oss/run" || fail "Merged file does not allow value-file writes in ~/.oss/run"
! grep -qF 'oss-login.sh' "$TMPDIR_5/.claude/settings.local.json" && pass "Merged file does not allow oss-login.sh (a key change always asks, R5-8)" || fail "Merged file allows oss-login.sh (a key change must always ask, R5-8)"
rm -rf "$TMPDIR_5"

# --- Test 6: the CLAUDE.md template fetch is allowed (T60) ---
# @behavior A user whose project has no CLAUDE.md runs the ideate skill (or /oss:login Step 4.2) and the
#           template fetch runs without an approval prompt.
# @business-rule oss-claude-md-template.sh takes no arguments and only GETs /api/v1/prompts/claude-md from the
#           configured API, the key on curl's stdin; allowing it lets no prompt change what it sends or where.
echo "Test 6: Allows ~/.oss/hooks/oss-claude-md-template.sh (fresh and merged)"
TMPDIR_6=$(mktemp -d)
"$SETUP_SCRIPT" "$TMPDIR_6"
grep -qF '"Bash(~/.oss/hooks/oss-claude-md-template.sh:*)"' "$TMPDIR_6/.claude/settings.local.json" && pass "Fresh file allows oss-claude-md-template.sh" || fail "Fresh file does not allow oss-claude-md-template.sh"
printf '{"permissions":{"allow":["WebSearch"]}}\n' > "$TMPDIR_6/.claude/settings.local.json"
"$SETUP_SCRIPT" "$TMPDIR_6"
grep -qF '"Bash(~/.oss/hooks/oss-claude-md-template.sh:*)"' "$TMPDIR_6/.claude/settings.local.json" && pass "Merged file allows oss-claude-md-template.sh" || fail "Merged file does not allow oss-claude-md-template.sh"
rm -rf "$TMPDIR_6"

# --- Test 7: the ship merge step's final test is allowed, exactly as served (D5) ---
# @behavior A user in Claude Code's normal permission mode runs /oss:ship --merge and the served merge step
#           (`~/.oss/hooks/oss-merge-test.sh --v2`) runs without a second "allow this command?" prompt.
# @business-rule D5 (owner, 2026-11-11): --merge is the user's consent to test and merge; the prompt added a
#           click, not protection. Only the exact served call is allowed (no `:*` prefix rule), so any other
#           argument still asks.
echo "Test 7: Allows exactly ~/.oss/hooks/oss-merge-test.sh --v2 (fresh and merged)"
TMPDIR_7=$(mktemp -d)
"$SETUP_SCRIPT" "$TMPDIR_7"
grep -qF '"Bash(~/.oss/hooks/oss-merge-test.sh --v2)"' "$TMPDIR_7/.claude/settings.local.json" && pass "Fresh file allows oss-merge-test.sh --v2" || fail "Fresh file does not allow oss-merge-test.sh --v2"
! grep -qF 'oss-merge-test.sh:*' "$TMPDIR_7/.claude/settings.local.json" && pass "Fresh file has no prefix rule for oss-merge-test.sh" || fail "Fresh file allows oss-merge-test.sh with any arguments"
printf '{"permissions":{"allow":["WebSearch"]}}\n' > "$TMPDIR_7/.claude/settings.local.json"
"$SETUP_SCRIPT" "$TMPDIR_7"
grep -qF '"Bash(~/.oss/hooks/oss-merge-test.sh --v2)"' "$TMPDIR_7/.claude/settings.local.json" && pass "Merged file allows oss-merge-test.sh --v2" || fail "Merged file does not allow oss-merge-test.sh --v2"
rm -rf "$TMPDIR_7"

# --- Summary ---
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
