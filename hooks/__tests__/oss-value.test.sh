#!/bin/bash
# hooks/oss-value.sh: the one plugin script that owns the per-repo value folder (G21 cut 1).
#
# @behavior `oss-value.sh dir`, run inside a repo, prints the private folder where a command
#           writes its value files (~/.oss/run/<key>), starts it clean of stale values, and
#           refuses (prints nothing) when any part of that folder is a link, or outside a repo.
# @business-rule US-001 AC-001.1 / ADR-001 (plugin-value-flags): the folder, its key and its
#           checks are the served value-folder command's. The key is pinned here by equality to
#           { git rev-parse --show-toplevel; git rev-parse --absolute-git-dir; } | git hash-object --stdin | cut -c1-16
#           (ship round 1, R1-3: the toplevel is part of the key, so a .git gitfile naming another
#           repo's git dir does not share its folder). The served prompts still hash the git dir
#           alone; Phase B moves them onto this helper.
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
key_of() { (cd "$1" && { git rev-parse --show-toplevel; git rev-parse --absolute-git-dir; } | git hash-object --stdin | cut -c1-16); }
mode_of() { ls -ld -- "$1" | cut -c1-10; }
# ov <cwd> <args...>: run the script as the user would; sets OUT, ERR, RC
ov() {
    local cwd="$1"; shift
    OUT=$(cd "$cwd" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="$H" PATH="${OV_PATH:-$PATH}" "$SH" "${OV_SCRIPT:-$SCRIPT}" "$@" 2>"$T/err" </dev/null); RC=$?
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
VALUE_FILES="feature numbers date reason message hint error agent key style prompt model workflow category name"
for f in $VALUE_FILES; do echo stale > "$H/.oss/run/$key/$f.txt"; done
echo keep > "$H/.oss/run/$key/unrelated.dat"
ov "$R" dir
left=""; for f in $VALUE_FILES; do [[ -e "$H/.oss/run/$key/$f.txt" ]] && left="$left $f.txt"; done
[[ "$RC" == 0 && -z "$left" ]] && pass "2: the 15 stale value files are removed (incl. agent.txt and the read files, R3-4/R3-5)" || fail "2: the 15 stale value files are removed (incl. agent.txt and the read files, R3-4/R3-5)" "rc=$RC left:$left"
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
# 4c. outside any git repo: one per-user folder, ~/.oss/run/home (ship round 4, R4-1), same checks
# ovn <args...>: run the script from a cwd that is in no git repo; sets OUT, ERR, RC, NR
ovn() {
    mkdir -p "$T/norepo$N/cwd"; NR="$T/norepo$N/cwd"
    OUT=$(cd "$NR" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/norepo$N" HOME="$H" "$SH" "$SCRIPT" "$@" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
newhome; ovn dir
[[ "$RC" == 0 && "$OUT" == "$H/.oss/run/home" ]] && pass "4c: outside any git repo, dir prints \$HOME/.oss/run/home" || fail "4c: outside any git repo, dir prints \$HOME/.oss/run/home" "rc=$RC out='$OUT' err=$ERR"
[[ "$(mode_of "$H/.oss/run/home" 2>&1)" == drwx------ && "$(mode_of "$H/.oss/run" 2>&1)" == drwx------ ]] && pass "4c: the home folder and ~/.oss/run are mode 700" || fail "4c: the home folder and ~/.oss/run are mode 700" "$(mode_of "$H/.oss/run/home" 2>&1) $(mode_of "$H/.oss/run" 2>&1)"
newhome; mkdir -p "$H/.oss/run/home"; for f in key style reason agent; do echo stale > "$H/.oss/run/home/$f.txt"; done; ovn dir
[[ "$RC" == 0 && -z "$(ls -A "$H/.oss/run/home")" ]] && pass "4c: the home folder is cleared of stale value files" || fail "4c: the home folder is cleared of stale value files" "rc=$RC left: $(ls -A "$H/.oss/run/home")"
newhome; mkdir -p "$H/.oss/run" "$T/elsewhere$N"; ln -s "$T/elsewhere$N" "$H/.oss/run/home"; E="$T/elsewhere$N"; echo victim > "$E/key.txt"; ovn dir
refused "4c: a symlinked ~/.oss/run/home is refused"
[[ "$(ls -A "$E")" == key.txt ]] && pass "4c: nothing created or removed through the home link" || fail "4c: nothing created or removed through the home link" "$(ls -A "$E")"

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

# --- 7b. a .git gitfile naming another repo's git dir does not share its folder (R1-3) ------
newhome; newrepo; V="$R"; newrepo; X="$R"; rm -rf "$X/.git"; printf 'gitdir: %s/.git\n' "$V" > "$X/.git"
ov "$V" dir; vout="$OUT"; ov "$X" dir
[[ "$RC" == 0 && -n "$vout" && -n "$OUT" && "$OUT" != "$vout" ]] \
    && pass "7b: a repo whose .git file points at another repo's git dir gets its own folder" \
    || fail "7b: a repo whose .git file points at another repo's git dir gets its own folder" "rc=$RC victim='$vout' gitfile repo='$OUT'"

# --- 7c. a failed git lookup is refused, not hashed as empty input (R1-4) ---------------------
newhome; newrepo; REAL_GIT=$(command -v git); mkdir -p "$T/gitfail"
printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = --absolute-git-dir ] && exit 128; done\nexec "%s" "$@"\n' "$REAL_GIT" > "$T/gitfail/git"; chmod +x "$T/gitfail/git"
OV_PATH="$T/gitfail:$PATH" ov "$R" dir
refused "7c: a failed git-dir lookup is refused"
[[ -z "$(ls -A "$H/.oss/run" 2>/dev/null)" ]] && pass "7c: no key folder is created from a failed lookup" || fail "7c: no key folder is created from a failed lookup" "$(ls -A "$H/.oss/run")"

# --- 7d. a HOME that is not absolute is refused (ship round 2, R2-4) --------------------------
# A relative HOME would put ~/.oss/run (and the value files) inside whatever folder the cwd is.
newhome; newrepo
OUT=$(cd "$R" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="relhome" "$SH" "$SCRIPT" dir 2>"$T/err" </dev/null); RC=$?; ERR=$(cat "$T/err")
refused "7d: a relative HOME is refused"
[[ ! -e "$R/relhome" ]] && pass "7d: nothing is created under the cwd for a relative HOME" || fail "7d: nothing is created under the cwd for a relative HOME" "$(find "$R/relhome" | head -3)"

# === failed <workflow> (US-001 AC-001.2, AC-001.3) ============================================
# Runs the REAL sibling oss-notify.sh. A = the repo the command runs in (has a real .oss);
# B = another project, named by ~/.oss/current-project. VD = the value folder `dir` printed.
proj() { newrepo; mkdir -p "$R/.oss"; }                                   # -> R
setup_failed() {
    newhome; proj; A="$R"; proj; B="$R"; R="$A"
    mkdir -p "$H/.oss"; printf '%s\n' "$B" > "$H/.oss/current-project"
    ov "$A" dir; VD="$OUT"
}
got_event() { grep -qF "[failed]" "$1/.oss/logs/current-session/build.log" 2>/dev/null; }   # <project>
nothing_sent() { [[ ! -e "$A/.oss/logs" && ! -e "$B/.oss/logs" && ! -e "$A/.oss/workflow-state.json" && ! -e "$B/.oss/workflow-state.json" ]]; }
# refused_kept <name>: a refusal (not 0/126/127), nothing printed, nothing sent, reason.txt still there
refused_kept() {
    if [[ "$RC" == 0 || "$RC" == 2 || "$RC" == 126 || "$RC" == 127 ]]; then fail "$1" "rc=$RC (want a refusal, not 0/usage/126/127) err=$ERR"
    elif [[ -n "$OUT" ]]; then fail "$1" "printed: $OUT"
    elif ! nothing_sent; then fail "$1" "an event was sent"
    elif [[ ! -e "$VD/reason.txt" && ! -L "$VD/reason.txt" ]]; then fail "$1" "reason.txt was removed"
    else pass "$1"; fi
}

# --- 8. sends the cleaned reason, deletes the file --------------------------------------------
setup_failed
printf "it's \$(id) \`x\`; a|b\nline2\n" > "$VD/reason.txt"
ov "$A" failed build
want='its (id) x abline2'
[[ "$RC" == 0 ]] && pass "8: failed exits 0 when the notice is sent" || fail "8: failed exits 0 when the notice is sent" "rc=$RC err=$ERR"
grep -qF "[failed] reason=$want, blocker=$want" "$A/.oss/logs/current-session/build.log" 2>/dev/null \
    && pass "8: quote, \$(, backtick, ; | and newline are stripped from the reason sent" \
    || fail "8: quote, \$(, backtick, ; | and newline are stripped from the reason sent" "log: $(cat "$A/.oss/logs/current-session/build.log" 2>&1)"
grep -qF '"supervisor": "intervening"' "$A/.oss/workflow-state.json" 2>/dev/null \
    && pass "8: the project's supervisor state records the failure" || fail "8: the project's supervisor state records the failure" "$(cat "$A/.oss/workflow-state.json" 2>&1)"
[[ ! -e "$VD/reason.txt" ]] && pass "8: reason.txt is deleted after sending" || fail "8: reason.txt is deleted after sending" "still there"
# at most 200 characters
setup_failed
printf 'z%.0s' {1..300} > "$VD/reason.txt"
ov "$A" failed build
z200=$(printf 'z%.0s' {1..200})
[[ "$RC" == 0 ]] && grep -qF "[failed] reason=$z200, blocker=$z200" "$A/.oss/logs/current-session/build.log" 2>/dev/null \
    && pass "8: a 300-character reason is cut to 200" || fail "8: a 300-character reason is cut to 200" "rc=$RC log: $(cut -c1-80 "$A/.oss/logs/current-session/build.log" 2>&1)"

# --- 9. unsafe or missing reason.txt: refused, nothing sent, file kept ------------------------
setup_failed; echo victim > "$T/target$N"; ln -s "$T/target$N" "$VD/reason.txt"
ov "$A" failed build
refused_kept "9: a symlinked reason.txt is refused"
setup_failed; echo hello > "$VD/reason.txt"; ln "$VD/reason.txt" "$T/second$N"
ov "$A" failed build
refused_kept "9: a hard-linked reason.txt (link count 2) is refused"
setup_failed; mkdir "$VD/reason.txt"
ov "$A" failed build
refused_kept "9: a reason.txt directory is refused"
setup_failed
ov "$A" failed build
if [[ "$RC" == 0 || "$RC" == 2 || "$RC" == 126 || "$RC" == 127 || -n "$OUT" ]] || ! nothing_sent; then fail "9: a missing reason.txt is refused" "rc=$RC out='$OUT'"
else pass "9: a missing reason.txt is refused"; fi

# --- 10. workflow names outside the shared rule are refused -----------------------------------
for name in 'build/../ship' 'Build' 'projectA_cmd' "$(printf 'a%.0s' {1..42})" ''; do
    setup_failed; echo hello > "$VD/reason.txt"
    ov "$A" failed "$name"
    refused_kept "10: workflow name '$name' is refused"
done

# --- 11. the notifier fails: rc != 0 and reason.txt is kept -----------------------------------
setup_failed; echo hello > "$VD/reason.txt"
mkdir -p "$T/nf$N"; cp "$SCRIPT" "$ROOT/hooks/oss-safe-path.sh" "$T/nf$N/"
printf '#!/bin/sh\nexit 1\n' > "$T/nf$N/oss-notify.sh"; chmod +x "$T/nf$N/oss-notify.sh"
OV_SCRIPT="$T/nf$N/oss-value.sh" ov "$A" failed build
[[ "$RC" != 0 && "$RC" != 2 && "$RC" != 126 && "$RC" != 127 && -f "$VD/reason.txt" ]] \
    && pass "11: when the notifier fails, rc != 0 and reason.txt is kept" || fail "11: when the notifier fails, rc != 0 and reason.txt is kept" "rc=$RC kept=$([[ -f "$VD/reason.txt" ]] && echo y || echo n)"

# --- 12. routing: the event lands in the project the command ran in ---------------------------
setup_failed; echo hello > "$VD/reason.txt"; mkdir -p "$A/sub/deep"
ov "$A/sub/deep" failed build
[[ "$RC" == 0 ]] && got_event "$A" && ! got_event "$B" \
    && pass "12: from repoA/sub/deep with current-project = repoB, only repoA gets the event" \
    || fail "12: from repoA/sub/deep with current-project = repoB, only repoA gets the event" "rc=$RC A=$(got_event "$A" && echo y || echo n) B=$(got_event "$B" && echo y || echo n) err=$ERR"
# a nested repo with no .oss: the walk stops at its toplevel, so the notifier falls back (#374)
setup_failed; I="$A/inner"; mkdir -p "$I"; (cd "$I" && git init -q) >/dev/null 2>&1
ov "$I" dir; VD="$OUT"; echo hello > "$VD/reason.txt"
ov "$I" failed build
[[ "$RC" == 0 ]] && got_event "$H" && ! got_event "$A" && ! got_event "$B" \
    && pass "12: a nested repo with no .oss borrows neither the outer repo nor current-project (lands in ~/.oss, R1-2)" \
    || fail "12: a nested repo with no .oss borrows neither the outer repo nor current-project (lands in ~/.oss, R1-2)" "rc=$RC home=$(got_event "$H" && echo y || echo n) A=$(got_event "$A" && echo y || echo n) B=$(got_event "$B" && echo y || echo n) err=$ERR"
# a symlinked .oss is skipped by the walk
setup_failed; newrepo; C="$R"; mkdir -p "$T/linked$N"; ln -s "$T/linked$N" "$C/.oss"
ov "$C" dir; VD="$OUT"; echo hello > "$VD/reason.txt"
ov "$C" failed build
[[ "$RC" == 0 ]] && got_event "$H" && ! got_event "$B" && [[ -z "$(ls -A "$T/linked$N")" ]] \
    && pass "12: a symlinked .oss is skipped (nothing written through it; lands in ~/.oss, not current-project)" \
    || fail "12: a symlinked .oss is skipped (nothing written through it; lands in ~/.oss, not current-project)" "rc=$RC home=$(got_event "$H" && echo y || echo n) B=$(got_event "$B" && echo y || echo n) linked: $(ls -A "$T/linked$N") err=$ERR"

# a repo with no .oss at all: the victim named by current-project is untouched (R1-2)
setup_failed; newrepo; C="$R"
ov "$C" dir; VD="$OUT"; echo hello > "$VD/reason.txt"
ov "$C" failed build
[[ "$RC" == 0 ]] && got_event "$H" && [[ ! -e "$B/.oss/logs" && ! -e "$B/.oss/workflow-state.json" ]] \
    && pass "12: from a repo with no .oss, current-project's logs and state are untouched; the event lands in ~/.oss (R1-2)" \
    || fail "12: from a repo with no .oss, current-project's logs and state are untouched; the event lands in ~/.oss (R1-2)" "rc=$RC home=$(got_event "$H" && echo y || echo n) victim: $(ls -A "$B/.oss") err=$ERR"

# outside any git repo: the notice is sent from the home folder and lands in ~/.oss (R4-1)
newhome; mkdir -p "$H/.oss"; ovn dir; [[ -n "$OUT" ]] && echo hello > "$OUT/reason.txt"; ovn failed build
[[ "$RC" == 0 ]] && got_event "$H" && [[ ! -e "$H/.oss/run/home/reason.txt" ]] \
    && pass "12: outside any git repo the failed notice is sent and lands in ~/.oss (R4-1)" \
    || fail "12: outside any git repo the failed notice is sent and lands in ~/.oss (R4-1)" "rc=$RC home=$(got_event "$H" && echo y || echo n) err=$ERR"

# --- 12b. reason.txt swapped for a link between the check and the read is not sent (R1-5) ----
# A `stat` on PATH swaps reason.txt for a symlink to a secret the first time it is asked about it.
setup_failed; echo hello > "$VD/reason.txt"; echo TOPSECRET > "$T/secret$N"
REAL_STAT=$(command -v stat); mkdir -p "$T/swap$N"
printf '#!/bin/sh\nfor a in "$@"; do case "$a" in */reason.txt) if [ ! -e "%s/swapped" ]; then : > "%s/swapped"; mv "$a" "$a.orig"; ln -s "%s" "$a"; fi ;; esac; done\nexec "%s" "$@"\n' "$T/swap$N" "$T/swap$N" "$T/secret$N" "$REAL_STAT" > "$T/swap$N/stat"; chmod +x "$T/swap$N/stat"
OV_PATH="$T/swap$N:$PATH" ov "$A" failed build
if grep -rqF TOPSECRET "$A/.oss" "$B/.oss" "$H/.oss/logs" 2>/dev/null; then fail "12b: a reason.txt swapped for a link after the check is not read" "the secret was sent (rc=$RC)"
elif [[ ! -e "$T/swap$N/swapped" ]]; then fail "12b: a reason.txt swapped for a link after the check is not read" "the swap never ran"
elif [[ "$RC" == 0 ]]; then fail "12b: a reason.txt swapped for a link after the check is not read" "rc=0 (want a refusal)"
else pass "12b: a reason.txt swapped for a link after the check is not read (refused, secret not sent)"; fi

# === error <source> (US-002) ==================================================================
# Runs the REAL watcher/dist/cli/oss-error.js, found through ~/.oss/plugin-root (= this checkout).
# A `node` on PATH records each call, so "nothing emitted" means the emitter never ran.
# The 18 codes are the served emitter's list: all are accepted, and OSS-UNKNOWN-001 (in the
# watcher registry but not in the served list) is refused, so the helper's list is pinned to it.
SERVED_CODES="OSS-API-001 OSS-API-002 OSS-API-003 OSS-AUTH-001 OSS-AUTH-002 OSS-AUTH-003 OSS-CONFIG-001 OSS-CONFIG-002 OSS-GIT-001 OSS-GIT-002 OSS-GIT-003 OSS-TDD-001 OSS-TDD-002 OSS-TDD-003 OSS-WORKFLOW-001 OSS-WORKFLOW-002 OSS-WORKFLOW-901 OSS-WORKFLOW-902"
REAL_NODE=$(command -v node)
mkdir -p "$T/bin"; printf '#!/bin/sh\necho "$*" >> "%s/node.calls"\nexec "%s" "$@"\n' "$T" "$REAL_NODE" > "$T/bin/node"; chmod +x "$T/bin/node"
setup_error() {
    setup_failed; rm -f "$T/node.calls"
    printf '%s\n' "$ROOT" > "$H/.oss/plugin-root"
    printf "api's down; \$(id)\n" > "$VD/message.txt"
    printf 'retry `later` | soon\n' > "$VD/hint.txt"
    printf '%s\n' "${1:-OSS-API-001 MEDIUM true cheap 1}" > "$VD/error.txt"
}
ove() { OV_PATH="$T/bin:$PATH" ov "$@"; }
no_emit() { [[ ! -e "$T/node.calls" && ! -e "$A/.oss/workflow.log" && ! -e "$B/.oss/workflow.log" ]]; }
refused_emit() {
    if [[ "$RC" == 0 || "$RC" == 2 || "$RC" == 126 || "$RC" == 127 ]]; then fail "$1" "rc=$RC (want a refusal, not 0/usage/126/127) err=$ERR"
    elif [[ -n "$OUT" ]]; then fail "$1" "printed: $OUT"
    elif ! no_emit; then fail "$1" "the emitter ran: $(cat "$T/node.calls" 2>/dev/null)"
    elif [[ -z "$ERR" ]]; then fail "$1" "no stderr line"
    else pass "$1"; fi
}

# --- 13. valid fields are emitted; the 3 files are deleted; the event lands in repoA ----------
setup_error; mkdir -p "$A/sub/deep"
ove "$A/sub/deep" error cmd:build
[[ "$RC" == 0 ]] && pass "13: error exits 0 when emitted" || fail "13: error exits 0 when emitted" "rc=$RC err=$ERR"
ok=1; for want in '"code":"OSS-API-001"' '"severity":"MEDIUM"' '"source":"cmd:build"' '"message":"apis down (id)"' '"retry_hint":"retry later  soon"' '"retry_eligible":true' '"retry_cost":"cheap"' '"attempt":1'; do
    [[ "$OUT" == *"$want"* ]] || { ok=0; fail "13: stdout is the OSSError JSON" "missing $want in: $OUT"; }
done
[[ "$ok" == 1 ]] && pass "13: stdout is the OSSError JSON with the fields and the cleaned message and hint"
[[ ! -e "$VD/message.txt" && ! -e "$VD/hint.txt" && ! -e "$VD/error.txt" ]] && pass "13: the 3 value files are deleted" || fail "13: the 3 value files are deleted" "$(ls -A "$VD")"
[[ -s "$A/.oss/workflow.log" && ! -e "$B/.oss/workflow.log" ]] \
    && pass "13: from repoA/sub/deep with current-project = repoB, only repoA gets the event" \
    || fail "13: from repoA/sub/deep with current-project = repoB, only repoA gets the event" "A=$([[ -s "$A/.oss/workflow.log" ]] && echo y || echo n) B=$([[ -e "$B/.oss/workflow.log" ]] && echo y || echo n)"
# from a repo with no .oss: current-project's workflow.log is untouched, the event lands in ~/.oss (R1-2)
setup_error; newrepo; C="$R"; ov "$C" dir; VD="$OUT"
printf 'down\n' > "$VD/message.txt"; printf 'later\n' > "$VD/hint.txt"; printf 'OSS-API-001 MEDIUM true cheap 1\n' > "$VD/error.txt"
ove "$C" error cmd:build
[[ "$RC" == 0 && ! -e "$B/.oss/workflow.log" && -s "$H/.oss/workflow.log" ]] \
    && pass "13: from a repo with no .oss, current-project's workflow.log is untouched; the event lands in ~/.oss (R1-2)" \
    || fail "13: from a repo with no .oss, current-project's workflow.log is untouched; the event lands in ~/.oss (R1-2)" "rc=$RC victim=$([[ -e "$B/.oss/workflow.log" ]] && echo y || echo n) home=$([[ -s "$H/.oss/workflow.log" ]] && echo y || echo n) err=$ERR"
# every served code is accepted
bad=""; for c in $SERVED_CODES; do
    setup_error "$c HIGH false expensive 2"; ove "$A" error cmd:build
    [[ "$RC" == 0 && "$OUT" == *"\"code\":\"$c\""* ]] || bad="$bad $c"
done
[[ -z "$bad" ]] && pass "13: each of the 18 served codes is emitted" || fail "13: each of the 18 served codes is emitted" "refused:$bad"

# --- 14. invalid fields: refused, nothing emitted --------------------------------------------
for e in 'OSS-UNKNOWN-001 MEDIUM true cheap 1' 'OSS-NOPE-001 MEDIUM true cheap 1' 'OSS-API-001 SEVERE true cheap 1' \
         'OSS-API-001 MEDIUM maybe cheap 1' 'OSS-API-001 MEDIUM true free 1' 'OSS-API-001 MEDIUM true cheap 1a' \
         'OSS-API-001 MEDIUM true cheap' 'OSS-API-001 MEDIUM true cheap 1 extra'; do
    setup_error "$e"; ove "$A" error cmd:build
    refused_emit "14: error.txt '$e' is refused"
done
for src in build cmd:Build 'cmd:a/../b' ''; do
    setup_error; ove "$A" error "$src"
    refused_emit "14: source '$src' is refused"
done

# --- 15. the emitter cannot be located safely: refused ---------------------------------------
setup_error; rm -f "$H/.oss/plugin-root"; ove "$A" error cmd:build
refused_emit "15: a missing ~/.oss/plugin-root is refused"
# relative: it names a real emitter below the cwd, so only the absolute-path rule refuses it
setup_error; mkdir -p "$A/relroot/watcher/dist/cli"; : > "$A/relroot/watcher/dist/cli/oss-error.js"
printf 'relroot\n' > "$H/.oss/plugin-root"; ove "$A" error cmd:build
refused_emit "15: a relative ~/.oss/plugin-root is refused"
# 2 lines: together they name a real directory (its name has a newline), so only the one-line rule refuses it
setup_error; NL="$T/two$N
lines"; mkdir -p "$NL/watcher/dist/cli"; : > "$NL/watcher/dist/cli/oss-error.js"
printf '%s\n' "$NL" > "$H/.oss/plugin-root"; ove "$A" error cmd:build
refused_emit "15: a 2-line ~/.oss/plugin-root is refused"
# a symlinked ~/.oss/plugin-root (to a file naming the real root) is refused (R1-6)
setup_error; mv "$H/.oss/plugin-root" "$T/rootfile$N"; ln -s "$T/rootfile$N" "$H/.oss/plugin-root"; ove "$A" error cmd:build
refused_emit "15: a symlinked ~/.oss/plugin-root is refused"
setup_error; mkdir -p "$T/emptyroot$N"; printf '%s\n' "$T/emptyroot$N" > "$H/.oss/plugin-root"; ove "$A" error cmd:build
refused_emit "15: a plugin root without oss-error.js is refused"

# --- 16. a linked value file: refused ---------------------------------------------------------
for f in message hint error; do
    setup_error; mv "$VD/$f.txt" "$T/real$N"; ln -s "$T/real$N" "$VD/$f.txt"; ove "$A" error cmd:build
    refused_emit "16: a symlinked $f.txt is refused"
    setup_error; ln "$VD/$f.txt" "$T/second$N"; ove "$A" error cmd:build
    refused_emit "16: a hard-linked $f.txt is refused"
done

# === read <name> (ship round 3, R3-5) =========================================================
# A wrapper's user value (API key, style, prompt/model name, workflow, trust category/name) is
# written by the model to <name>.txt; `read` prints it only when it matches that name's rule in
# code, and deletes the file as soon as it is read (valid or not), so a key never lingers.
# refused1: a refusal by the verb itself (rc 1), not usage (2) or not runnable (126/127)
refused1() { if [[ "$RC" == 2 ]]; then fail "$1" "rc=2 (usage, not a refusal) err=$ERR"; else refused "$1"; fi; }
setup_read() { newhome; newrepo; ov "$R" dir; VD="$OUT"; }
pwned() { [[ -e "$T/PWNED" || -e "$R/PWNED" || -e "$H/PWNED" ]]; }
for nv in 'key ossk_test_key_123' 'key ak_xxxxxxxx' 'style visual' 'style audio' 'style sound' 'style none' \
          'prompt oss:code-reviewer' 'prompt /oss:ship' 'model ollama/codellama' 'model openrouter/meta-llama/llama-3.2-3b:free' \
          'workflow build' 'workflow team:deploy-v2.1' 'category commands' 'name code-simplifier'; do
    n=${nv%% *}; v=${nv#* }
    setup_read; printf '%s\n' "$v" > "$VD/$n.txt"; ov "$R" read "$n"
    [[ "$RC" == 0 && "$OUT" == "$v" && ! -e "$VD/$n.txt" ]] && pass "17: read $n prints '$v' and deletes $n.txt" \
        || fail "17: read $n prints '$v' and deletes $n.txt" "rc=$RC out='$OUT' left=$([[ -e "$VD/$n.txt" ]] && echo y || echo n) err=$ERR"
done
# hostile or out-of-rule values: refused, nothing printed, nothing run, the file is gone
NLV='line1
line2'
for nv in 'key $(touch PWNED)' "key a'b'cdefgh" 'key short' "key $(printf 'k%.0s' {1..201})" \
          'style Visual' 'style loud' 'style $(touch PWNED)' \
          'prompt oss:Ship' 'prompt a b' "prompt $(printf 'p%.0s' {1..101})" 'model `touch PWNED`' 'model a;touch PWNED' \
          'workflow ../ship' 'workflow a/b' 'workflow $(touch PWNED)' 'category a.b' 'category a:b' 'name ../x' "name x'y" 'key ' ; do
    n=${nv%% *}; v=${nv#* }
    setup_read; printf '%s' "$v" > "$VD/$n.txt"; ov "$R" read "$n"
    if pwned; then fail "17: read $n refuses '$v'" "something ran (PWNED exists)"
    else refused1 "17: read $n refuses '$v'"; fi
    [[ ! -e "$VD/$n.txt" ]] && pass "17: a refused $n.txt is deleted too" || fail "17: a refused $n.txt is deleted too" "still there"
done
for n in key style workflow; do
    setup_read; printf '%s' "$NLV" > "$VD/$n.txt"; ov "$R" read "$n"; refused1 "17: read $n refuses a two-line value"
done
# an unknown name, a linked or missing file, outside a repo: refused
setup_read; echo value1234 > "$VD/bogus.txt"; ov "$R" read bogus; refused1 "17: read of an unknown name is refused"
[[ -e "$VD/bogus.txt" ]] && pass "17: an unknown name's file is not touched" || fail "17: an unknown name's file is not touched" "deleted"
setup_read; ov "$R" read key; refused1 "17: read of a missing key.txt is refused"
setup_read; echo ossk_secret_key_1 > "$T/target$N"; ln -s "$T/target$N" "$VD/key.txt"; ov "$R" read key
refused1 "17: a symlinked key.txt is refused"
[[ -f "$T/target$N" ]] && pass "17: the symlink's target is not deleted" || fail "17: the symlink's target is not deleted" "gone"
setup_read; echo ossk_secret_key_1 > "$VD/key.txt"; ln "$VD/key.txt" "$T/second$N"; ov "$R" read key
refused1 "17: a hard-linked key.txt is refused"
# outside any git repo the home folder is used (R4-1): read works there, with the same rule
newhome; ovn dir; [[ -n "$OUT" ]] && echo ossk_home_key_123 > "$OUT/key.txt"; ovn read key
[[ "$RC" == 0 && "$OUT" == ossk_home_key_123 && ! -e "$H/.oss/run/home/key.txt" ]] && pass "17: read outside any git repo reads the home folder (R4-1)" \
    || fail "17: read outside any git repo reads the home folder (R4-1)" "rc=$RC out='$OUT' err=$ERR"
newhome; ovn dir; [[ -n "$OUT" ]] && printf '%s' '$(touch PWNED)' > "$OUT/key.txt"; ovn read key
if [[ -e "$NR/PWNED" || -e "$H/PWNED" ]]; then fail "17: outside a repo a hostile key is refused" "something ran"; else refused1 "17: outside a repo a hostile key is refused"; fi

# === agent <workflow> start|complete (ship round 3, R3-4) =====================================
# The model writes the specialist's name to agent.txt; `agent` checks it in code and calls the
# real sibling oss-log.sh agent, so the status line shows the agent (activeAgent.type) again.
# CLAUDE_PLUGIN_ROOT = this checkout, so oss-log.sh finds watcher/dist/cli/update-workflow-state.js.
ova() {
    local cwd="$1"; shift
    OUT=$(cd "$cwd" && env -u CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT="$ROOT" HOME="$H" "$SH" "$SCRIPT" "$@" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
agent_log() { grep -F "$2" "$1/.oss/logs/current-session/build.log" 2>/dev/null; }   # <project> <text>
# wait_state <project> <jq filter> <want>: the state CLI runs in the background, so poll (10s cap)
wait_state() { local i=0; while (( i < 100 )); do [[ "$(jq -r "$2" "$1/.oss/workflow-state.json" 2>/dev/null)" == "$3" ]] && return 0; sleep 0.1; i=$((i + 1)); done; return 1; }
setup_failed; echo code-reviewer > "$VD/agent.txt"
ova "$A" agent build start
[[ "$RC" == 0 ]] && pass "18: agent build start exits 0" || fail "18: agent build start exits 0" "rc=$RC err=$ERR"
[[ -n "$(agent_log "$A" 'code-reviewer: starting: delegated task')" ]] && pass "18: the project's build.log names the agent (fixed task text)" \
    || fail "18: the project's build.log names the agent (fixed task text)" "$(cat "$A/.oss/logs/current-session/build.log" 2>&1)"
wait_state "$A" '.activeAgent.type // ""' code-reviewer && pass "18: workflow-state activeAgent.type is the agent (status line shows it)" \
    || fail "18: workflow-state activeAgent.type is the agent (status line shows it)" "$(cat "$A/.oss/workflow-state.json" 2>&1)"
[[ ! -e "$VD/agent.txt" ]] && pass "18: agent.txt is deleted after start" || fail "18: agent.txt is deleted after start" "still there"
[[ ! -e "$B/.oss/logs" ]] && pass "18: current-project (another repo) gets nothing" || fail "18: current-project (another repo) gets nothing" "$(ls -A "$B/.oss")"
echo code-reviewer > "$VD/agent.txt"; ova "$A" agent build complete
[[ "$RC" == 0 && -n "$(agent_log "$A" 'code-reviewer: completed: delegated task')" ]] && pass "18: agent build complete logs the completion" \
    || fail "18: agent build complete logs the completion" "rc=$RC err=$ERR"
wait_state "$A" '.activeAgent // "none"' none && pass "18: completion clears activeAgent" || fail "18: completion clears activeAgent" "$(cat "$A/.oss/workflow-state.json" 2>&1)"
[[ ! -e "$VD/agent.txt" ]] && pass "18: agent.txt is deleted after complete" || fail "18: agent.txt is deleted after complete" "still there"
# hostile names: refused, nothing logged, nothing run, file deleted
for v in '$(touch PWNED)' 'Code-Reviewer' 'code reviewer' "a'b" '1agent' "$(printf 'a%.0s' {1..62})" "$NLV"; do
    setup_failed; printf '%s' "$v" > "$VD/agent.txt"; ova "$A" agent build start
    if [[ -e "$T/PWNED" || -e "$A/PWNED" ]]; then fail "18: agent name '$v' is refused" "something ran"
    elif [[ "$RC" == 0 || "$RC" == 2 || "$RC" == 126 || "$RC" == 127 || -n "$OUT" ]] || ! nothing_sent; then fail "18: agent name '$v' is refused" "rc=$RC out='$OUT'"
    else pass "18: agent name '$v' is refused, nothing logged"; fi
    [[ ! -e "$VD/agent.txt" ]] && pass "18: a refused agent.txt is deleted" || fail "18: a refused agent.txt is deleted" "still there"
done
for args in 'build begin' 'Build start' 'build' 'a/../b start'; do
    setup_failed; echo code-reviewer > "$VD/agent.txt"; ova "$A" agent $args
    if [[ "$RC" == 0 || "$RC" == 126 || "$RC" == 127 || -n "$OUT" ]] || ! nothing_sent; then fail "18: agent '$args' is refused" "rc=$RC out='$OUT'"
    else pass "18: agent '$args' is refused, nothing logged"; fi
done
setup_failed; ova "$A" agent build start
if [[ "$RC" == 0 || "$RC" == 126 || "$RC" == 127 ]] || ! nothing_sent; then fail "18: a missing agent.txt is refused" "rc=$RC"; else pass "18: a missing agent.txt is refused"; fi
setup_failed; echo code-reviewer > "$T/target$N"; ln -s "$T/target$N" "$VD/agent.txt"; ova "$A" agent build start
if [[ "$RC" == 0 || "$RC" == 126 || "$RC" == 127 ]] || ! nothing_sent; then fail "18: a symlinked agent.txt is refused" "rc=$RC"; else pass "18: a symlinked agent.txt is refused"; fi

echo
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ "$FAILED" == 0 ]]
