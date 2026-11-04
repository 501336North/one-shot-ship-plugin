#!/bin/bash
# Tests that build-oss-launch.yml pins every action to a full commit SHA (supply-chain hardening) and
# builds oss-launch the way release-cli-decrypt.yml builds oss-decrypt (T71e).
#
# @behavior Every `uses:` is pinned to a 40-hex commit SHA, not a mutable tag. A retagged action
#   (esp. the write-capable release job) cannot substitute artifacts.
# @behavior (T71e) The release binaries are built with @yao-pkg/pkg installed by `npm ci` from the
#   watcher lockfile at one exact version (never pkg@5.8.1, GHSA-22r3-9w55-cj54, unmaintained, no fix,
#   and never a registry `npx`/`npm install -g`), for node22 on the four targets, with least
#   permissions, while the published asset names, the .sha256 format and the tag pattern that
#   hooks/ensure-oss-launch.sh and hooks/oss-launch-checksums.txt rely on stay the same.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WF="$SCRIPT_DIR/../build-oss-launch.yml"
REF_WF="$SCRIPT_DIR/../release-cli-decrypt.yml"
REPO="$SCRIPT_DIR/../../.."
PKG_JSON="$REPO/watcher/package.json"
LOCK="$REPO/watcher/package-lock.json"
ENSURE="$REPO/hooks/ensure-oss-launch.sh"

PASS=0; FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((PASS++)); }
# has_line TEXT: the workflow has a line that is exactly TEXT after its indentation (a substring is not enough).
has_line() { sed -E 's/^[[:space:]]+//' "$WF" | grep -qxF -- "$1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  $2"; ((FAIL++)); }

# No `uses: …@vN` (mutable tag) may remain — must be @<40-hex>.
bare="$(grep -nE 'uses:[[:space:]]*[^@]+@v[0-9]' "$WF" || true)"
if [[ -z "$bare" ]]; then pass "no bare @vN tags on any uses:"; else fail "found mutable tag pins" "$bare"; fi

# Every uses: line is pinned to a 40-hex SHA.
unpinned="$(grep -nE 'uses:' "$WF" | grep -vE 'uses:[[:space:]]*[^@]+@[0-9a-f]{40}([[:space:]]|$)' || true)"
if [[ -z "$unpinned" ]]; then pass "every uses: pinned to a 40-hex SHA"; else fail "unpinned uses:" "$unpinned"; fi

# The write-capable release action is specifically pinned.
if grep -qE 'softprops/action-gh-release@[0-9a-f]{40}' "$WF"; then pass "action-gh-release SHA-pinned"; else fail "action-gh-release not SHA-pinned" "$(grep -n action-gh-release "$WF")"; fi

# (T71e) An action both workflows use is pinned to the SAME SHA (one reviewed pin per action).
uses_of() { grep -oE 'uses:[[:space:]]*[^@[:space:]]+@[0-9a-f]{40}' "$1" | sed -E 's/uses:[[:space:]]*//' | sort -u; }
drift=""
for u in $(uses_of "$WF"); do
    a="${u%@*}"
    ref="$(uses_of "$REF_WF" | grep -E "^${a}@" || true)"
    [[ -n "$ref" && "$ref" != "$u" ]] && drift="$drift $u (release-cli-decrypt.yml: $ref)"
done
if [[ -z "$drift" ]]; then pass "shared actions use release-cli-decrypt.yml's SHAs"; else fail "action SHA differs from release-cli-decrypt.yml" "$drift"; fi

# (T71e) Not the deprecated softprops v1 (de2c0eb… is v1).
v1="$(grep -nE 'softprops/action-gh-release@de2c0eb89ae2a093876385947365aca7b0e5f844|action-gh-release@[^[:space:]]+[[:space:]]*#[[:space:]]*v1([^0-9]|$)' "$WF" || true)"
if [[ -z "$v1" ]]; then pass "no softprops/action-gh-release v1"; else fail "deprecated action-gh-release v1" "$v1"; fi

# (T71e) No pkg 5 and no registry-fetched packager: only the lockfile copy under node_modules/.bin.
bad_pkg="$(grep -nE 'pkg@5|npx|npm (install|i)( |$)|-g[[:space:]]+(@yao-pkg/)?pkg' "$WF" || true)"
if [[ -z "$bad_pkg" ]]; then pass "no pkg@5, npx or global/registry install"; else fail "registry or pkg@5 install in the workflow" "$bad_pkg"; fi
pkg_runs="$(grep -vE '^[[:space:]]*#' "$WF" | grep -nE '(^|[[:space:]/:])pkg[[:space:]]' || true)"
want_run='run: ./node_modules/.bin/pkg dist/cli/oss-launch.cjs --target ${{ matrix.target }} --output dist/bin/${{ matrix.artifact }}'
if [[ "$(echo "$pkg_runs" | grep -c .)" -eq 1 ]] && has_line "$want_run"; then
    pass "the only pkg call is ./node_modules/.bin/pkg (installed by npm ci)"
else
    fail "pkg must run once, from ./node_modules/.bin" "$pkg_runs"
fi
if grep -qE '^[[:space:]]+run: npm ci$' "$WF"; then pass "dependencies installed with npm ci"; else fail "no npm ci step" "$(grep -n 'npm' "$WF")"; fi

# (T71e) @yao-pkg/pkg is an exact watcher devDependency, locked at that version from the registry.
ver="$(jq -r '.devDependencies["@yao-pkg/pkg"] // empty' "$PKG_JSON" 2>/dev/null)"
lock_root="$(jq -r '.packages[""].devDependencies["@yao-pkg/pkg"] // empty' "$LOCK" 2>/dev/null)"
lock_ver="$(jq -r '.packages["node_modules/@yao-pkg/pkg"].version // empty' "$LOCK" 2>/dev/null)"
lock_res="$(jq -r '.packages["node_modules/@yao-pkg/pkg"].resolved // empty' "$LOCK" 2>/dev/null)"
lock_int="$(jq -r '.packages["node_modules/@yao-pkg/pkg"].integrity // empty' "$LOCK" 2>/dev/null)"
if [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$lock_root" == "$ver" && "$lock_ver" == "$ver" \
      && "$lock_res" == "https://registry.npmjs.org/@yao-pkg/pkg/-/pkg-$ver.tgz" && "$lock_int" == sha512-* ]]; then
    pass "@yao-pkg/pkg $ver pinned exactly in watcher/package.json and package-lock.json"
else
    fail "@yao-pkg/pkg not pinned exactly from the lockfile" "package.json='$ver' lock root='$lock_root' lock='$lock_ver' resolved='$lock_res'"
fi
vercel="$(jq -r '.packages | keys[] | select(test("(^|/)node_modules/pkg$"))' "$LOCK" 2>/dev/null)"
if [[ -z "$vercel" ]]; then pass "no vercel pkg in the watcher lockfile"; else fail "vercel pkg in the watcher lockfile" "$vercel"; fi

# (T71e) node22 everywhere: no node18 target or runtime.
n18="$(grep -nE 'node-?18' "$WF" || true)"
if [[ -z "$n18" ]]; then pass "no node18"; else fail "node18 still referenced" "$n18"; fi
if grep -qE "^[[:space:]]+node-version: '22'$" "$WF"; then pass "setup-node uses node 22"; else fail "setup-node not on node 22" "$(grep -n node-version "$WF")"; fi

# (T71e) Asset names come from ensure-oss-launch.sh's oss-launch-$OS-$ARCH (OS Darwin|Linux, arch arm64|x64).
if grep -qF 'URL="$RELEASES/oss-launch-$OS-$ARCH"' "$ENSURE" && grep -qF 'ARTIFACT="oss-launch-$OS-$ARCH"' "$ENSURE"; then
    pass "ensure-oss-launch.sh still downloads oss-launch-\$OS-\$ARCH"
else
    fail "ensure-oss-launch.sh asset name pattern changed; update this test with it" "$(grep -n 'oss-launch-\$' "$ENSURE")"
fi
matrix="$(awk '
    /^[[:space:]]+- os:/   { os = $3 }
    /^[[:space:]]+target:/ { t = $2 }
    /^[[:space:]]+artifact:/ { print os, t, $2 }
' "$WF")"
want_matrix="macos-latest node22-macos-arm64 oss-launch-Darwin-arm64
macos-latest node22-macos-x64 oss-launch-Darwin-x64
ubuntu-latest node22-linux-x64 oss-launch-Linux-x64
ubuntu-24.04-arm node22-linux-arm64 oss-launch-Linux-arm64"
if [[ "$matrix" == "$want_matrix" ]]; then
    pass "matrix: node22 targets, arm64 on native arm64 runners, unchanged artifact names"
else
    fail "matrix differs" "$(echo "$matrix" | tr '\n' ';')"
fi
files="$(grep -oE '^[[:space:]]+artifacts/[^[:space:]]+' "$WF" | sed -E 's/^[[:space:]]+//')"
want_files=""
for n in oss-launch-Darwin-arm64 oss-launch-Darwin-x64 oss-launch-Linux-x64 oss-launch-Linux-arm64; do
    want_files="$want_files
artifacts/$n/$n"
done
for n in oss-launch-Darwin-arm64 oss-launch-Darwin-x64 oss-launch-Linux-x64 oss-launch-Linux-arm64; do
    want_files="$want_files
artifacts/$n.sha256/$n.sha256"
done
if [[ "$files" == "${want_files#?}" ]]; then pass "release publishes the same 8 asset names"; else fail "release files changed" "$(echo "$files" | tr '\n' ';')"; fi
if has_line 'run: shasum -a 256 dist/bin/${{ matrix.artifact }} > dist/bin/${{ matrix.artifact }}.sha256' \
   && has_line 'name: ${{ matrix.artifact }}.sha256' && has_line 'path: watcher/dist/bin/${{ matrix.artifact }}.sha256'; then
    pass ".sha256 is still shasum -a 256 output named <artifact>.sha256"
else
    fail ".sha256 format or name changed" "$(grep -n sha256 "$WF")"
fi
tags="$(awk '/^    tags:/ {t=1; next} t && /^      - / {print $2; next} {t=0}' "$WF")"
if [[ "$tags" == "'oss-launch-v*'" ]]; then pass "tag pattern is oss-launch-v*"; else fail "tag pattern changed" "$tags"; fi

# (T71e) Least permissions: nothing by default, read for the build, write contents only to publish.
perms="$(awk '
    /^jobs:/ { injobs = 1; next }
    /^[^[:space:]#]/ { injobs = 0 }
    injobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(/:$/, "", job); inp = 0; next }
    /^permissions:/ { v = $0; sub(/^permissions:[[:space:]]*/, "", v); if (v != "") print "top", v; else { inp = 1; scope = "top"; pind = 0 }; next }
    injobs && /^    permissions:/ { v = $0; sub(/^    permissions:[[:space:]]*/, "", v); if (v != "") print job, v; else { inp = 1; scope = job; pind = 4 }; next }
    inp {
        match($0, /^ */); ind = RLENGTH
        if (ind > pind && $0 ~ /:/) { k = $1; sub(/:$/, "", k); print scope, k, $2; next }
        inp = 0
    }
' "$WF" | sort)"
want_perms="build contents read
release contents write
top {}"
if [[ "$perms" == "$want_perms" ]]; then pass "least permissions (top {}, build read, release contents: write)"; else fail "permissions not least" "$(echo "$perms" | tr '\n' ';')"; fi
co="$(grep -cE 'uses:[[:space:]]*actions/checkout@' "$WF")"
pc="$(grep -cE '^[[:space:]]+persist-credentials: false$' "$WF")"
if [[ "$co" -ge 1 && "$co" -eq "$pc" ]]; then pass "every checkout drops the token (persist-credentials: false)"; else fail "checkout keeps the token" "checkouts=$co persist-credentials:false=$pc"; fi

echo "-----"; echo "passed: $PASS, failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
