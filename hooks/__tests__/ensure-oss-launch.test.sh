#!/bin/bash
# Tests for hooks/ensure-oss-launch.sh — fetch + verify + cache the bundled oss-launch binary.
#
# @behavior Downloads the right OS/arch binary, verifies its SHA-256 (fail-closed), caches it as
#   ~/.oss/bin/oss-launch-<arch>, chmod +x. Idempotent: a present binary is a no-op.
#
# curl is mocked via a fake on PATH that copies fixtures by URL basename.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENSURE="$SCRIPT_DIR/../ensure-oss-launch.sh"

TESTS_PASSED=0; TESTS_FAILED=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  $2"; ((TESTS_FAILED++)); }

# Build a sandbox: fake curl + fixtures + a fresh bin dir.
setup() {
  SANDBOX="$(mktemp -d)"
  FIXTURES="$SANDBOX/fixtures"; mkdir -p "$FIXTURES"
  BINDIR="$SANDBOX/bin"; mkdir -p "$BINDIR"
  MOCKBIN="$SANDBOX/mockbin"; mkdir -p "$MOCKBIN"
  # The "released" binary fixture + its correct checksum.
  printf '#!/bin/sh\necho oss-launch fake\n' > "$FIXTURES/oss-launch-Linux-arm64"
  ( cd "$FIXTURES" && shasum -a 256 oss-launch-Linux-arm64 > oss-launch-Linux-arm64.sha256 )
  # Fake curl: `curl ... -o OUT URL` → copy fixtures/<basename(URL)> to OUT (fail if missing).
  cat > "$MOCKBIN/curl" <<EOF
#!/bin/sh
out=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in -o) out="\$2"; shift 2;; -*) shift;; *) url="\$1"; shift;; esac; done
name="\${url##*/}"
[ -f "$FIXTURES/\$name" ] || exit 22
cp "$FIXTURES/\$name" "\$out"
EOF
  chmod +x "$MOCKBIN/curl"
}
teardown() { rm -rf "$SANDBOX"; }
run_ensure() {
  PATH="$MOCKBIN:$PATH" OSS_LAUNCH_BIN_DIR="$BINDIR" OSS_LAUNCH_OS=Linux OSS_LAUNCH_ARCH=arm64 \
    OSS_LAUNCH_RELEASES_URL="https://example.test/dl" bash "$ENSURE" 2>&1
}

# --- T14a: fetch + verify + cache ---
setup
out="$(run_ensure)"; rc=$?
if [[ $rc -eq 0 && -x "$BINDIR/oss-launch-arm64" ]]; then pass "T14a fetched, verified, cached +x"; else fail "T14a install" "rc=$rc out=$out"; fi
teardown

# --- T14b: idempotent (already present → no-op, exit 0) ---
setup
printf 'old\n' > "$BINDIR/oss-launch-arm64"; chmod +x "$BINDIR/oss-launch-arm64"
out="$(run_ensure)"; rc=$?
if [[ $rc -eq 0 && "$(cat "$BINDIR/oss-launch-arm64")" == "old" ]]; then pass "T14b idempotent (untouched)"; else fail "T14b idempotent" "rc=$rc content=$(cat "$BINDIR/oss-launch-arm64")"; fi
teardown

# --- T14c: checksum MISMATCH → fail closed, no cached binary ---
setup
echo "deadbeef  oss-launch-Linux-arm64" > "$FIXTURES/oss-launch-Linux-arm64.sha256"   # wrong hash
out="$(run_ensure)"; rc=$?
if [[ $rc -ne 0 && ! -e "$BINDIR/oss-launch-arm64" ]]; then pass "T14c checksum mismatch → fail closed"; else fail "T14c fail-closed" "rc=$rc exists=$([[ -e "$BINDIR/oss-launch-arm64" ]] && echo yes || echo no)"; fi
teardown

echo "-----"; echo "passed: $TESTS_PASSED, failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
