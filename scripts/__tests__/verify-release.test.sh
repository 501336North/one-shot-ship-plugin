#!/bin/bash
# Tests for scripts/verify-release.sh — the releaser's gate helper. Given a release tag, it
# downloads each published binary, recomputes SHA-256, cross-checks the published .sha256, and emits
# a ready-to-commit `oss-launch-checksums.txt` (shasum format) for HUMAN REVIEW before committing.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VR="$SCRIPT_DIR/../verify-release.sh"

PASS=0; FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((PASS++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  $2"; ((FAIL++)); }

SB="$(mktemp -d)"
FX="$SB/fx"; mkdir -p "$FX"
MOCK="$SB/mock"; mkdir -p "$MOCK"
# Four published binaries + their .sha256 (as the release would have).
for a in oss-launch-Darwin-arm64 oss-launch-Darwin-x64 oss-launch-Linux-x64 oss-launch-Linux-arm64; do
  printf 'binary %s\n' "$a" > "$FX/$a"
  ( cd "$FX" && shasum -a 256 "$a" > "$a.sha256" )
done
cat > "$MOCK/curl" <<EOF
#!/bin/sh
out=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in -o) out="\$2"; shift 2;; -*) shift;; *) url="\$1"; shift;; esac; done
name="\${url##*/}"
[ -f "$FX/\$name" ] || exit 22
cp "$FX/\$name" "\$out"
EOF
chmod +x "$MOCK/curl"

out="$(PATH="$MOCK:$PATH" OSS_LAUNCH_RELEASES_URL="https://example.test/dl" bash "$VR" oss-launch-v9.9.9 2>/dev/null)"
rc=$?

# Exactly 4 manifest lines, each `<64-hex>  oss-launch-<OS>-<arch>`.
lines="$(printf '%s\n' "$out" | grep -cE '^[0-9a-f]{64}  oss-launch-(Darwin|Linux)-(arm64|x64)$')"
if [[ $rc -eq 0 && "$lines" -eq 4 ]]; then pass "verify-release emits 4 shasum-format manifest lines"; else fail "verify-release output" "rc=$rc lines=$lines out=$out"; fi

# The emitted hash for Linux-arm64 matches the actual fixture hash.
want="$(cd "$FX" && shasum -a 256 oss-launch-Linux-arm64 | awk '{print $1}')"
got="$(printf '%s\n' "$out" | awk '$2=="oss-launch-Linux-arm64"{print $1}')"
if [[ "$want" == "$got" && -n "$got" ]]; then pass "verify-release hash matches the binary"; else fail "hash match" "want=$want got=$got"; fi

rm -rf "$SB"
echo "-----"; echo "passed: $PASS, failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
