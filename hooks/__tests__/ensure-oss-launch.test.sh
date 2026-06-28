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
  # Committed known-good manifest (the security gate): correct hash by default.
  MANIFEST="$SANDBOX/checksums.txt"
  ( cd "$FIXTURES" && shasum -a 256 oss-launch-Linux-arm64 ) > "$MANIFEST"
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
    OSS_LAUNCH_RELEASES_URL="https://example.test/dl" OSS_LAUNCH_CHECKSUMS="$MANIFEST" \
    bash "$ENSURE" 2>&1
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

# --- T2 release-tamper: in-release .sha256 matches a swapped binary, but the COMMITTED manifest
#     hash differs → reject. (Defends against a release-write compromise.) ---
setup
# Manifest pins a DIFFERENT (known-good) hash than the served binary; the in-release .sha256 still
# matches the served binary, so only the committed-manifest check can catch the swap.
echo "$(printf 'deadbeef%0.s' {1..8})  oss-launch-Linux-arm64" > "$MANIFEST"
out="$(run_ensure)"; rc=$?
if [[ $rc -ne 0 && ! -e "$BINDIR/oss-launch-arm64" ]]; then pass "T2 release-tamper (committed hash mismatch) → reject"; else fail "T2 release-tamper" "rc=$rc exists=$([[ -e "$BINDIR/oss-launch-arm64" ]] && echo yes || echo no)"; fi
teardown

# --- T2 fail-closed: committed manifest has NO entry for this OS/arch → reject (no trust-on-first-use) ---
setup
echo "$(printf 'a%0.s' {1..64})  oss-launch-Linux-x64" > "$MANIFEST"   # entry for a DIFFERENT arch only
out="$(run_ensure)"; rc=$?
if [[ $rc -ne 0 && ! -e "$BINDIR/oss-launch-arm64" ]]; then pass "T2 no manifest entry → fail-closed reject"; else fail "T2 fail-closed" "rc=$rc exists=$([[ -e "$BINDIR/oss-launch-arm64" ]] && echo yes || echo no)"; fi
teardown

# --- T3 tag pinning: with OSS_LAUNCH_TAG set and NO RELEASES_URL override, the fetch URL targets
#     releases/download/<tag>/ (a pinned tag), NOT latest/download. ---
t3_tag_pin() {
  local sb; sb="$(mktemp -d)"
  local mock="$sb/mock"; mkdir -p "$mock"
  local urls="$sb/urls.log"
  # Fake curl records the requested URL, then fails (we only care about the URL it targeted).
  cat > "$mock/curl" <<EOF
#!/bin/sh
for a in "\$@"; do case "\$a" in https://*) echo "\$a" >> "$urls";; esac; done
exit 22
EOF
  chmod +x "$mock/curl"
  PATH="$mock:$PATH" OSS_LAUNCH_BIN_DIR="$sb/bin" OSS_LAUNCH_OS=Linux OSS_LAUNCH_ARCH=arm64 \
    OSS_LAUNCH_TAG="oss-launch-v9.9.9" bash "$ENSURE" >/dev/null 2>&1 || true
  local got; got="$(cat "$urls" 2>/dev/null)"
  case "$got" in
    *download/oss-launch-v9.9.9/oss-launch-Linux-arm64*) pass "T3 fetch pinned to tag (download/<tag>/)" ;;
    *latest/download*) fail "T3 tag pin" "still using latest/download: $got" ;;
    *) fail "T3 tag pin" "unexpected url: $got" ;;
  esac
  rm -rf "$sb"
}
t3_tag_pin

echo "-----"; echo "passed: $TESTS_PASSED, failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
