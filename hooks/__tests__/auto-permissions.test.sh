#!/bin/bash
# Test: oss-setup-permissions.sh creates .claude/settings.local.json
set -euo pipefail

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

# --- Summary ---
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
