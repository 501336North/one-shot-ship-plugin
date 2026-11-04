#!/bin/bash
# Tests for hooks/ensure-oss-launch.sh — fetch + verify + cache the bundled oss-launch binary.
#
# @behavior Downloads the right OS/arch binary, verifies its SHA-256 (fail-closed), caches it as
#   ~/.oss/bin/oss-launch-<arch>, chmod +x. Idempotent: a present binary is a no-op.
#
# curl is mocked via a fake on PATH that copies fixtures by URL basename.
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

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
  # Fake curl: `curl ... [-o OUT] URL` → fixtures/<basename(URL)> to OUT, or to stdout with no -o, as real curl
  # does (fail if missing). Each call's argv goes to $SANDBOX/argv. With $SANDBOX/flood, the binary is 257 MiB of
  # zeros (a server sending far more than any release, with a curl that does not stop it), and dd's exit status
  # goes to $SANDBOX/flood.rc: 141 (SIGPIPE) when the reader stopped reading (T74c).
  cat > "$MOCKBIN/curl" <<EOF
#!/bin/bash
echo "\$*" >> "$SANDBOX/argv"
out=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in -o) out="\$2"; shift 2;; --max-time|--connect-timeout|--max-filesize|-m) shift 2;; -*) shift;; *) url="\$1"; shift;; esac; done
name="\${url##*/}"
if [ -e "$SANDBOX/flood" ] && [ "\$name" = oss-launch-Linux-arm64 ]; then
  if [ -n "\$out" ]; then dd if=/dev/zero bs=1048576 count=257 of="\$out" 2>/dev/null; else dd if=/dev/zero bs=1048576 count=257 2>/dev/null; fi
  echo \$? > "$SANDBOX/flood.rc"; exit 0
fi
[ -f "$FIXTURES/\$name" ] || exit 22
if [ -n "\$out" ]; then cp "$FIXTURES/\$name" "\$out"; else cat "$FIXTURES/\$name"; fi
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

# --- T74c: every download is bounded in time and size; over a limit is a failed download ---
# @behavior A release server (or anything in its place) that sends far more than a binary, or never stops, cannot
#   fill the disk or hang the launcher: the download stops at the cap and takes the existing "download failed"
#   path, with nothing installed and no temp file left. A binary up to the cap installs as before.
# @business-rule The binary is capped at 268435456 bytes (256 MiB: a few times today's size, room to grow), the
#   .sha256 at 4096; both get --connect-timeout and a total --max-time. head -c stops a body curl lets past
#   --max-filesize (no Content-Length, curl before 8.4). The checksum checks are unchanged.
source "$SCRIPT_DIR/lib/run-capped.sh"
BIN_CAP=268435456
leftovers() { find "$BINDIR" -type f ! -name 'oss-launch-arm64' | wc -l | tr -d ' '; }
capped_ensure() {
  run_capped 120 env PATH="$MOCKBIN:$PATH" OSS_LAUNCH_BIN_DIR="$BINDIR" OSS_LAUNCH_OS=Linux OSS_LAUNCH_ARCH=arm64 \
    OSS_LAUNCH_RELEASES_URL="https://example.test/dl" OSS_LAUNCH_CHECKSUMS="$MANIFEST" bash "$ENSURE" 2>&1
}
# fixture <bytes>: the released binary is exactly <bytes> long, with a matching .sha256 and committed hash
fixture() {
  local head=$'#!/bin/sh\necho oss-launch fake\n#'
  { printf '%s' "$head"; head -c $(($1 - ${#head})) /dev/zero; } > "$FIXTURES/oss-launch-Linux-arm64"
  ( cd "$FIXTURES" && shasum -a 256 oss-launch-Linux-arm64 > oss-launch-Linux-arm64.sha256 && cp oss-launch-Linux-arm64.sha256 "$MANIFEST" )
}

setup
out="$(capped_ensure)"; rc=$?
bin_argv=$(grep -v '\.sha256' "$SANDBOX/argv" 2>/dev/null); sum_argv=$(grep '\.sha256' "$SANDBOX/argv" 2>/dev/null)
if [[ $rc -eq 0 && -x "$BINDIR/oss-launch-arm64" \
      && "$bin_argv" == *"--max-filesize $BIN_CAP "* && "$bin_argv" =~ --max-time\ [0-9]+ && "$bin_argv" =~ --connect-timeout\ [0-9]+ \
      && "$sum_argv" == *"--max-filesize 4096 "* && "$sum_argv" =~ --max-time\ [0-9]+ && "$sum_argv" =~ --connect-timeout\ [0-9]+ ]]; then
  pass "T74c both downloads get --connect-timeout, a total --max-time and --max-filesize ($BIN_CAP binary, 4096 .sha256)"
else fail "T74c download limits" "rc=$rc argv=$(tr '\n' '|' < "$SANDBOX/argv" 2>/dev/null)"; fi
teardown

setup; : > "$SANDBOX/flood"
out="$(capped_ensure)"; rc=$?
if [[ $rc -eq 1 && "$out" == *"[ensure-oss-launch] download failed: https://example.test/dl/oss-launch-Linux-arm64"* \
      && ! -e "$BINDIR/oss-launch-arm64" && "$(leftovers)" == 0 && "$(cat "$SANDBOX/flood.rc" 2>/dev/null)" == 141 ]]; then
  pass "T74c a 257 MiB binary is cut off at the cap: download failed, nothing installed, no temp file"
else fail "T74c flood" "rc=$rc dd=$(cat "$SANDBOX/flood.rc" 2>/dev/null) installed=$([[ -e "$BINDIR/oss-launch-arm64" ]] && echo yes || echo no) left=$(leftovers) out=${out:0:300}"; fi
teardown

setup; fixture "$BIN_CAP"
out="$(capped_ensure)"; rc=$?
if [[ $rc -eq 0 && -x "$BINDIR/oss-launch-arm64" && $(wc -c < "$BINDIR/oss-launch-arm64") -eq $BIN_CAP ]]; then
  pass "T74c a verified binary of exactly $BIN_CAP bytes installs"
else fail "T74c binary at the cap" "rc=$rc out=${out:0:300}"; fi
teardown

setup; fixture $((BIN_CAP + 1))
out="$(capped_ensure)"; rc=$?
if [[ $rc -eq 1 && "$out" == *"download failed"* && ! -e "$BINDIR/oss-launch-arm64" && "$(leftovers)" == 0 ]]; then
  pass "T74c a binary of $BIN_CAP + 1 bytes is a failed download, even with matching checksums"
else fail "T74c binary over the cap" "rc=$rc left=$(leftovers) out=${out:0:300}"; fi
teardown

setup; { cat "$FIXTURES/oss-launch-Linux-arm64.sha256"; head -c 5000 /dev/zero | tr '\0' ' '; } > "$SANDBOX/s" && mv "$SANDBOX/s" "$FIXTURES/oss-launch-Linux-arm64.sha256"
out="$(capped_ensure)"; rc=$?
if [[ $rc -eq 1 && "$out" == *"checksum file unavailable"* && ! -e "$BINDIR/oss-launch-arm64" && "$(leftovers)" == 0 ]]; then
  pass "T74c a .sha256 over 4096 bytes is unavailable: fail closed"
else fail "T74c .sha256 over its cap" "rc=$rc out=${out:0:300}"; fi
teardown

# --- T82 (security N5): both downloads are HTTPS only, redirects included ---
# @behavior A release URL, or a redirect from it, that leads to plain HTTP (or any other protocol) is refused by curl.
setup
out="$(capped_ensure)"; rc=$?
n=$(grep -c -- "--proto =https --proto-redir =https " "$SANDBOX/argv" 2>/dev/null)
if [[ $rc -eq 0 && "$n" == 2 && $(wc -l < "$SANDBOX/argv" | tr -d ' ') == 2 ]]; then
  pass "T82 both downloads get --proto =https --proto-redir =https"
else fail "T82 https-only downloads" "rc=$rc argv=$(tr '\n' '|' < "$SANDBOX/argv" 2>/dev/null)"; fi
teardown

echo "-----"; echo "passed: $TESTS_PASSED, failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
