#!/bin/bash
# Tests for bin/oss-launch (the launcher shim's arch-select + Node-presence preflight).
#
# @behavior The shim picks a bundled binary when present; else runs the JS launcher via system
#   node; else (no node) warns LOUDLY and execs the real claude all-cloud — never silent.
# @business-rule A customer box without Node must still run (all-cloud) with a loud signal.
#
# Uses OSS_LAUNCH_DRY_RUN=1 so the shim echoes its chosen action instead of exec'ing.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIM="$SCRIPT_DIR/../oss-launch"

TESTS_PASSED=0
TESTS_FAILED=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  expected: $2"; echo "  got: $3"; ((TESTS_FAILED++)); }
assert_contains() { case "$2" in *"$3"*) pass "$1" ;; *) fail "$1" "contains '$3'" "$2" ;; esac; }

# --- T7: bundled binary present → exec it ---
t7() {
  local bindir; bindir="$(mktemp -d)"
  local bin="$bindir/oss-launch-arm64"
  printf '#!/bin/sh\n' > "$bin"; chmod +x "$bin"
  local out
  out="$(OSS_LAUNCH_ENSURE=/usr/bin/true OSS_LAUNCH_DRY_RUN=1 OSS_LAUNCH_BIN_DIR="$bindir" OSS_LAUNCH_ARCH=aarch64 "$SHIM" -p x 2>&1)"
  assert_contains "T7 bundled binary present → EXEC_BUNDLED" "$out" "EXEC_BUNDLED"
  assert_contains "T7 names the arm64 binary" "$out" "oss-launch-arm64"
  rm -rf "$bindir"
}

# --- T8: no bundled binary, node present → exec JS launcher ---
t8() {
  local bindir; bindir="$(mktemp -d)"   # empty → no bundled binary
  local pathdir; pathdir="$(mktemp -d)"
  printf '#!/bin/sh\n' > "$pathdir/node"; chmod +x "$pathdir/node"   # node present
  local out
  out="$(OSS_LAUNCH_ENSURE=/usr/bin/true OSS_LAUNCH_DRY_RUN=1 OSS_LAUNCH_BIN_DIR="$bindir" OSS_LAUNCH_ARCH=x86_64 PATH="$pathdir:/usr/bin:/bin" "$SHIM" -p x 2>&1)"
  assert_contains "T8 node present → EXEC_NODE" "$out" "EXEC_NODE"
  rm -rf "$bindir" "$pathdir"
}

# --- T9: no bundled binary, node ABSENT → loud warn + exec real claude ---
t9() {
  local bindir; bindir="$(mktemp -d)"   # no bundled binary
  local pathdir; pathdir="$(mktemp -d)"
  printf '#!/bin/sh\n' > "$pathdir/claude"; chmod +x "$pathdir/claude"  # claude present, node NOT
  # Include /usr/bin:/bin for coreutils (dirname/basename), but NOT the node dir (node lives in a
  # version-manager/homebrew dir, not /usr/bin), so `command -v node` fails as intended.
  local out
  out="$(OSS_LAUNCH_ENSURE=/usr/bin/true OSS_LAUNCH_DRY_RUN=1 OSS_LAUNCH_BIN_DIR="$bindir" OSS_LAUNCH_ARCH=arm64 PATH="$pathdir:/usr/bin:/bin" "$SHIM" -p x 2>&1)"
  assert_contains "T9 node absent → loud ALL-CLOUD warning" "$out" "ALL-CLOUD"
  assert_contains "T9 execs the real claude" "$out" "EXEC_CLAUDE"
  rm -rf "$bindir" "$pathdir"
}

# --- T15: auto-install — ensure-oss-launch populates the binary, then the shim execs it ---
t15() {
  local bindir; bindir="$(mktemp -d)"   # empty initially
  local ensure="$bindir/fake-ensure.sh"
  # Fake ensure drops a bundled binary into BIN_DIR (simulating fetch+cache).
  cat > "$ensure" <<EOF
#!/bin/sh
printf '#!/bin/sh\n' > "$bindir/oss-launch-arm64"
chmod +x "$bindir/oss-launch-arm64"
EOF
  chmod +x "$ensure"
  local out
  out="$(OSS_LAUNCH_ENSURE="$ensure" OSS_LAUNCH_DRY_RUN=1 OSS_LAUNCH_BIN_DIR="$bindir" OSS_LAUNCH_ARCH=arm64 "$SHIM" -p x 2>&1)"
  assert_contains "T15 auto-install → then EXEC_BUNDLED" "$out" "EXEC_BUNDLED"
  rm -rf "$bindir"
}

t7; t8; t9; t15
echo "-----"
echo "passed: $TESTS_PASSED, failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
