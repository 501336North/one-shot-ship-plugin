#!/bin/bash
# hooks/oss-value.sh: the one plugin script that owns the per-repo value folder (G21 cut 1).
#
# @behavior `oss-value.sh dir`, run inside a repo, prints the private folder where a command
#           writes its value files (~/.oss/run/<key>), starts it clean of stale values, and
#           refuses (prints nothing) when any part of that folder is a link, or outside a repo.
# @business-rule US-001 AC-001.1 / ADR-001 (plugin-value-flags): the folder, its key and its
#           checks are exactly the served value-folder command's, so served prompts and the
#           plugin agree on where the values live. The key is pinned here by equality to the
#           served formula: git rev-parse --absolute-git-dir | git hash-object --stdin | cut -c1-16
#
# Usage: ./hooks/__tests__/oss-value.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-value.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
SCRIPT="$ROOT/hooks/oss-value.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-value tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-value.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

N=0
newhome() { N=$((N + 1)); H="$T/home$N"; mkdir -p "$H"; }               # -> H (fresh, empty)
newrepo() { N=$((N + 1)); R="$T/repo$N"; mkdir -p "$R"; (cd "$R" && git init -q) >/dev/null 2>&1; } # -> R
key_of() { (cd "$1" && git rev-parse --absolute-git-dir | git hash-object --stdin | cut -c1-16); }
mode_of() { ls -ld -- "$1" | cut -c1-10; }
# ov <cwd> <args...>: run the script as the user would; sets OUT, ERR, RC
ov() {
    local cwd="$1"; shift
    OUT=$(cd "$cwd" && HOME="$H" "$SH" "$SCRIPT" "$@" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
# refused <name>: rc non-zero but not "script missing / not runnable" (126/127), nothing printed
refused() {
    if [[ "$RC" == 0 || "$RC" == 126 || "$RC" == 127 ]]; then fail "$1" "rc=$RC (want a refusal, not 0/126/127) err=$ERR"
    elif [[ -n "$OUT" ]]; then fail "$1" "printed: $OUT"
    else pass "$1"; fi
}

[[ -f "$SCRIPT" && -x "$SCRIPT" ]] && pass "hooks/oss-value.sh exists and is executable" || fail "hooks/oss-value.sh exists and is executable" "missing or not executable"

# --- 1. dir prints the physical per-repo folder, mode 700 ------------------------------------
newhome; newrepo
key=$(key_of "$R")
ov "$R" dir
[[ "$RC" == 0 ]] && pass "1: dir exits 0 in a repo" || fail "1: dir exits 0 in a repo" "rc=$RC err=$ERR"
[[ "$OUT" == "$H/.oss/run/$key" ]] && pass "1: dir prints exactly \$HOME/.oss/run/<served key>" || fail "1: dir prints exactly \$HOME/.oss/run/<served key>" "got '$OUT' want '$H/.oss/run/$key'"
[[ "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" == 1 && "$key" =~ ^[0-9a-f]{16}$ ]] && pass "1: one line, 16-hex key" || fail "1: one line, 16-hex key" "out='$OUT' key='$key'"
[[ -d "$H/.oss/run/$key" && "$(mode_of "$H/.oss/run/$key")" == drwx------ ]] && pass "1: the key folder is mode 700" || fail "1: the key folder is mode 700" "$(mode_of "$H/.oss/run/$key" 2>&1)"
[[ "$(mode_of "$H/.oss/run" 2>&1)" == drwx------ ]] && pass "1: ~/.oss/run is mode 700" || fail "1: ~/.oss/run is mode 700" "$(mode_of "$H/.oss/run" 2>&1)"
# from a subdirectory: same folder (the key is the repo's, not the cwd's)
mkdir -p "$R/sub/deep"; ov "$R/sub/deep" dir
[[ "$RC" == 0 && "$OUT" == "$H/.oss/run/$key" ]] && pass "1: a subdirectory gets the same folder" || fail "1: a subdirectory gets the same folder" "rc=$RC out='$OUT'"
# a pre-existing loose ~/.oss/run and key folder are tightened to 700
newhome; mkdir -p "$H/.oss/run/$key"; chmod 755 "$H/.oss/run" "$H/.oss/run/$key"
ov "$R" dir
[[ "$RC" == 0 && "$(mode_of "$H/.oss/run")" == drwx------ && "$(mode_of "$H/.oss/run/$key")" == drwx------ ]] \
    && pass "1: existing 755 folders are tightened to 700" || fail "1: existing 755 folders are tightened to 700" "rc=$RC $(mode_of "$H/.oss/run") $(mode_of "$H/.oss/run/$key")"

# --- 2. stale value files are removed, other files kept ---------------------------------------
newhome; mkdir -p "$H/.oss/run/$key"
for f in feature numbers date reason message hint error; do echo stale > "$H/.oss/run/$key/$f.txt"; done
echo keep > "$H/.oss/run/$key/unrelated.dat"
ov "$R" dir
left=""; for f in feature numbers date reason message hint error; do [[ -e "$H/.oss/run/$key/$f.txt" ]] && left="$left $f.txt"; done
[[ "$RC" == 0 && -z "$left" ]] && pass "2: the 7 stale value files are removed" || fail "2: the 7 stale value files are removed" "rc=$RC left:$left"
[[ -f "$H/.oss/run/$key/unrelated.dat" ]] && pass "2: an unrelated file is kept" || fail "2: an unrelated file is kept" "deleted"

# --- 3. old *.txt in another key folder are pruned --------------------------------------------
newhome; mkdir -p "$H/.oss/run/0123456789abcdef"
echo old > "$H/.oss/run/0123456789abcdef/reason.txt"; touch -t 202001010000 "$H/.oss/run/0123456789abcdef/reason.txt"
echo new > "$H/.oss/run/0123456789abcdef/fresh.txt"
ov "$R" dir
[[ "$RC" == 0 && ! -e "$H/.oss/run/0123456789abcdef/reason.txt" ]] && pass "3: a *.txt older than 7 days in another key folder is pruned" || fail "3: a *.txt older than 7 days in another key folder is pruned" "rc=$RC still there"
[[ -f "$H/.oss/run/0123456789abcdef/fresh.txt" ]] && pass "3: a fresh *.txt in another key folder is kept" || fail "3: a fresh *.txt in another key folder is kept" "deleted"

# --- 4. refusals: nothing printed, nothing created --------------------------------------------
# 4a. ~/.oss/run is a symlink
newhome; mkdir -p "$H/.oss" "$T/elsewhere$N"; ln -s "$T/elsewhere$N" "$H/.oss/run"; E="$T/elsewhere$N"
ov "$R" dir
refused "4a: ~/.oss/run as a symlink is refused"
[[ -z "$(ls -A "$E")" ]] && pass "4a: nothing created through the ~/.oss/run link" || fail "4a: nothing created through the ~/.oss/run link" "$(ls -A "$E")"
# 4b. ~/.oss/run/<key> is a symlink
newhome; mkdir -p "$H/.oss/run" "$T/elsewhere$N"; ln -s "$T/elsewhere$N" "$H/.oss/run/$key"; E="$T/elsewhere$N"
echo victim > "$E/reason.txt"
ov "$R" dir
refused "4b: ~/.oss/run/<key> as a symlink is refused"
[[ "$(ls -A "$E")" == reason.txt && "$(ls -A "$H/.oss/run")" == "$key" ]] && pass "4b: nothing created or removed through the <key> link" || fail "4b: nothing created or removed through the <key> link" "elsewhere: $(ls -A "$E") run: $(ls -A "$H/.oss/run")"
# 4c. outside any git repo
newhome; mkdir -p "$T/norepo$N/cwd"; NR="$T/norepo$N/cwd"
OUT=$(cd "$NR" && GIT_CEILING_DIRECTORIES="$T/norepo$N" HOME="$H" "$SH" "$SCRIPT" dir 2>"$T/err" </dev/null); RC=$?; ERR=$(cat "$T/err")
refused "4c: outside any git repo is refused"
[[ ! -e "$H/.oss/run" ]] && pass "4c: nothing created outside a repo" || fail "4c: nothing created outside a repo" "$(ls -A "$H/.oss")"

# --- 5. GIT_DIR / GIT_WORK_TREE pointing at another repo do not change the key ----------------
newhome; R1="$R"; newrepo; R2="$R"; R="$R1"
k2=$(key_of "$R2")
OUT=$(cd "$R1" && GIT_DIR="$R2/.git" GIT_WORK_TREE="$R2" HOME="$H" "$SH" "$SCRIPT" dir 2>"$T/err" </dev/null); RC=$?; ERR=$(cat "$T/err")
[[ "$RC" == 0 && "$OUT" == "$H/.oss/run/$key" ]] && pass "5: GIT_DIR/GIT_WORK_TREE do not change the key (cwd repo wins)" || fail "5: GIT_DIR/GIT_WORK_TREE do not change the key (cwd repo wins)" "rc=$RC out='$OUT' want key $key (other repo $k2)"

# --- 6. without oss-safe-path.sh beside it, the script fails closed ---------------------------
newhome; mkdir -p "$T/lonely"
if cp "$SCRIPT" "$T/lonely/oss-value.sh" 2>/dev/null; then
    OUT=$(cd "$R" && HOME="$H" "$SH" "$T/lonely/oss-value.sh" dir 2>"$T/err" </dev/null); RC=$?; ERR=$(cat "$T/err")
    refused "6: without oss-safe-path.sh it fails closed"
    [[ ! -e "$H/.oss" ]] && pass "6: nothing created without oss-safe-path.sh" || fail "6: nothing created without oss-safe-path.sh" "$(find "$H" -mindepth 1)"
    [[ -n "$ERR" ]] && pass "6: one stderr line says why" || fail "6: one stderr line says why" "stderr empty"
else
    fail "6: without oss-safe-path.sh it fails closed" "cannot copy $SCRIPT"
fi

# --- 7. usage --------------------------------------------------------------------------------
newhome
ov "$R"
[[ "$RC" == 2 && -z "$OUT" && "$ERR" == *[Uu]sage* ]] && pass "7: no args -> usage on stderr, rc 2" || fail "7: no args -> usage on stderr, rc 2" "rc=$RC out='$OUT' err='$ERR'"
ov "$R" bogus
[[ "$RC" == 2 && -z "$OUT" && "$ERR" == *[Uu]sage* ]] && pass "7: unknown verb -> usage on stderr, rc 2" || fail "7: unknown verb -> usage on stderr, rc 2" "rc=$RC out='$OUT' err='$ERR'"

echo
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ "$FAILED" == 0 ]]
