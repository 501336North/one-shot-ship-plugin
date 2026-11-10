#!/bin/bash
# hooks/oss-merge-test.sh: the ship merge step's final test (served item 4), as a plugin hook (merge-test-hook).
#
# @behavior Run in a repo on a feature branch, the hook records branch.txt and head.txt, builds the tree a squash
#           merge of the branch into GitHub's main produces, runs `npm ci`, the build and the tests on it in a
#           throwaway clone under `env -i`, deletes the clone, and only on success writes tested.txt and prints
#           READY_TO_MERGE. Every refusal prints a STOP: line and leaves no tested.txt that item 4b would accept.
# @business-rule merge-test-hook DESIGN.md (same behaviour and STOP lines as served item 4), D6 (proof files under
#           the served git-dir key, not oss-value.sh dir's toplevel+gitdir key), D8 (FOLLOWUPS 143/144/153: shadowed
#           shell names cannot fake a pass; 146: relative PATH entries never run).
#
# Usage: ./hooks/__tests__/oss-merge-test.test.sh
#        BASH_UNDER_TEST=/opt/homebrew/bin/bash ./hooks/__tests__/oss-merge-test.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-merge-test.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-merge-test tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-merge-test.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's override must not reach them (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
GITID=(-c user.name=t -c user.email=t@t)
URL=https://github.com/o/r.git

N=0
# fixture: sets H (HOME), B (stub bin), O (bare origin, "GitHub"), R (the user's repo on feat/x, one commit ahead)
fixture() {
    N=$((N + 1)); H="$T/home$N"; B="$T/bin$N"; O="$T/origin$N.git"; R="$T/repo$N"
    mkdir -p "$H" "$B" "$R/src"
    git init -q --bare "$O"
    ( cd "$R" && git init -q -b main && echo a > src/f.txt && git add -A && git "${GITID[@]}" commit -qm a \
      && git remote add origin "$URL" && git config "url.$O.insteadOf" "$URL" && git push -q origin main \
      && git checkout -q -b feat/x && echo b > src/f.txt && git "${GITID[@]}" commit -qam b ) >/dev/null 2>&1
    # gh: only `gh api` (main's head on "GitHub") is answered; ghmain overrides it
    cat > "$B/gh" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$B/gh.log"
if test "\$1" = api; then if test -f "$B/ghmain"; then cat "$B/ghmain"; else git --git-dir "$O" rev-parse refs/heads/main; fi; fi
exit 0
EOF
    # npm: logs its args and, once, its environment; exits 1 on `test` when npm.fail exists
    cat > "$B/npm" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$B/npm.log"
test -f "$B/npm.env" || env > "$B/npm.env"
test "\$1" = ci && test -f "$B/npm.sleep" && exec sleep 30
test "\$1" = test && test -f "$B/npm.plant.to" && cp "$B/npm.plant" "\$(cat "$B/npm.plant.to")"
test "\$1" = test && test -f "$B/npm.sleeptest" && exec sleep 30
test "\$1" = test && test -f "$B/npm.fail" && exit 1
exit 0
EOF
    chmod +x "$B/gh" "$B/npm"
}
gdir() { (cd "$R" && git rev-parse --absolute-git-dir); }
G() { echo "$H/.oss/run/$(gdir | git hash-object --stdin | cut -c1-16)"; }   # the served key (D6)
rev() { (cd "$R" && git rev-parse "$1"); }
clones() { ls "$(G)" 2>/dev/null | grep '^t\.' || true; }
# mt [args...]: run the hook in R as the served call does; sets OUT (stdout+stderr) and RC. MT_PRE runs first in the
# same shell (to export functions); MT_PATH replaces PATH's tail.
mt() {
    OUT=$(cd "${MT_DIR:-$R}" && env HOME="$H" PATH="${MT_PATH:-$B:$PATH}" "$SH" -c "${MT_PRE:-:}; \"\$0\" \"\$@\"" "$SH" "$HOOK" ${MT_RAW-"--v2"} "$@" 2>&1 </dev/null); RC=$?
}
has() { printf '%s\n' "$OUT" | grep -qF -- "$1"; }

[[ -f "$HOOK" && -x "$HOOK" ]] && pass "hooks/oss-merge-test.sh exists and is executable" || fail "hooks/oss-merge-test.sh exists and is executable" "missing or not executable"

# --- 1. a clean run: proof files under the served key, READY_TO_MERGE, no clone left ------------------------------
fixture; mt
head=$(rev feat/x); main=$(rev main)
[[ "$RC" == 0 ]] && has BRANCH_RECORDED && has READY_TO_MERGE && pass "1: a clean run prints BRANCH_RECORDED and READY_TO_MERGE" || fail "1: a clean run prints BRANCH_RECORDED and READY_TO_MERGE" "rc=$RC out=$OUT"
[[ "$(cat "$(G)/branch.txt" 2>/dev/null)" == feat/x && "$(cat "$(G)/head.txt" 2>/dev/null)" == "$head" ]] && pass "1: branch.txt and head.txt name the branch and its head" || fail "1: branch.txt and head.txt name the branch and its head" "$(ls "$(G)" 2>&1)"
[[ "$(cat "$(G)/tested.txt" 2>/dev/null)" == "$head $main" ]] && pass "1: tested.txt holds '<head> <main>'" || fail "1: tested.txt holds '<head> <main>'" "got '$(cat "$(G)/tested.txt" 2>&1)'"
[[ "$(cat "$B/npm.log" 2>/dev/null | tr '\n' '|')" == "ci|run build --if-present|test|" ]] && pass "1: npm ci, build, test ran once each" || fail "1: npm ci, build, test ran once each" "$(cat "$B/npm.log" 2>&1)"
[[ -z "$(clones)" ]] && pass "1: no throwaway clone is left" || fail "1: no throwaway clone is left" "$(clones)"
[[ "$(cd "$R" && git branch --show-current)" == feat/x ]] && pass "1: the work tree stays on the branch" || fail "1: the work tree stays on the branch" "$(cd "$R" && git branch --show-current)"

# --- 2. the key is the served git-dir key, not oss-value.sh dir's toplevel+gitdir key (D6) ------------------------
okey=$({ (cd "$R" && git rev-parse --show-toplevel); gdir; } | git hash-object --stdin | cut -c1-16)
[[ ! -e "$H/.oss/run/$okey/tested.txt" && -f "$(G)/tested.txt" ]] && pass "2: proof is under the served key only" || fail "2: proof is under the served key only" "okey=$okey"

# --- 3. failing tests: STOP, no proof (an earlier one removed), no clone ------------------------------------------
fixture; mkdir -p "$(G)"; echo "stale proof" > "$(G)/tested.txt"; touch "$B/npm.fail"; mt
[[ "$RC" != 0 ]] && has "STOP:" && ! has READY_TO_MERGE && pass "3: failing tests STOP" || fail "3: failing tests STOP" "rc=$RC out=$OUT"
[[ ! -e "$(G)/tested.txt" ]] && pass "3: no tested.txt, the stale one removed" || fail "3: no tested.txt, the stale one removed" "$(cat "$(G)/tested.txt")"
[[ -z "$(clones)" ]] && pass "3: no throwaway clone is left" || fail "3: no throwaway clone is left" "$(clones)"

# --- 4. refusals before any test: shallow, grafts, not github.com, main moved on GitHub, conflict ----------------
stops_before_tests() { # <label>
    if [[ "$RC" != 0 ]] && has "STOP:" && [[ ! -e "$(G)/tested.txt" && ! -s "$B/npm.log" ]]; then pass "$1"; else fail "$1" "rc=$RC npm=$(cat "$B/npm.log" 2>/dev/null) out=$OUT"; fi
}
fixture; rev HEAD > "$(gdir)/shallow"; mt; stops_before_tests "4: a shallow repo stops before the tests"
fixture; mkdir -p "$(gdir)/info"; : > "$(gdir)/info/grafts"; mt; stops_before_tests "4: a grafts file stops before the tests"
fixture; (cd "$R" && git remote set-url origin "$O"); mt; stops_before_tests "4: an origin that is not github.com stops before the tests"
fixture; rev feat/x > "$B/ghmain"; mt; stops_before_tests "4: main on GitHub differing from the fetched main stops before the tests"
fixture
( other="$T/other$N"; git clone -q -b main "$O" "$other" && cd "$other" && echo c > src/f.txt && git "${GITID[@]}" commit -qam c && git push -q origin main ) >/dev/null 2>&1
mt; stops_before_tests "4: a branch that does not merge cleanly stops before the tests"

# --- 5. refused before anything is recorded: main, MASTER, detached, any argument ----------------------------------
not_recorded() { # <label>
    if [[ "$RC" != 0 && ! -e "$(G)/branch.txt" && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE; then pass "$1"; else fail "$1" "rc=$RC out=$OUT"; fi
}
fixture; (cd "$R" && git checkout -q main); mt; not_recorded "5: on main it refuses before recording"
fixture; (cd "$R" && git checkout -q -b MASTER); mt; not_recorded "5: on MASTER it refuses before recording"
fixture; (cd "$R" && git checkout -q --detach); mt; not_recorded "5: on a detached HEAD it refuses before recording"
fixture; mt extra; not_recorded "5: any argument is refused before recording"
# D26: only the served contract argument runs it, so served item 4 can tell 2.1.2 from 2.1.1 (which takes none)
fixture; MT_RAW= ; mt; unset MT_RAW; not_recorded "5: without --v2 it refuses before recording"
fixture; MT_RAW=--v3; mt; unset MT_RAW; not_recorded "5: another contract argument is refused before recording"

# --- 6. npm sees only the allowlisted environment ------------------------------------------------------------------
fixture; MT_PRE='export SECRET_X=leak NODE_OPTIONS=--inspect HTTPS_PROXY=http://proxy.test:3128'; mt; MT_PRE=
if [[ "$RC" == 0 ]] && ! grep -q '^SECRET_X=' "$B/npm.env" && ! grep -q '^NODE_OPTIONS=' "$B/npm.env" && grep -qx 'HTTPS_PROXY=http://proxy.test:3128' "$B/npm.env"; then
    pass "6: npm sees HTTPS_PROXY but not SECRET_X or NODE_OPTIONS"; else fail "6: npm sees HTTPS_PROXY but not SECRET_X or NODE_OPTIONS" "rc=$RC env=$(cat "$B/npm.env" 2>&1 | tr '\n' ' ')"; fi

# --- 7 (D8, FOLLOWUPS 153/144/143): exported functions named like the utilities cannot fake a pass ----------------
fixture; touch "$B/npm.fail"
MT_PRE='command() { case "$1" in /usr/bin/env) return 0 ;; *) builtin command "$@" ;; esac; }; export -f command'; mt; MT_PRE=
[[ "$RC" != 0 && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE && pass "7: an exported function named command does not turn failing tests into a pass" || fail "7: an exported function named command does not turn failing tests into a pass" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"
MT_PRE='test() { return 0; }; grep() { return 0; }; printf() { builtin printf "$@"; }; cat() { /bin/cat "$@"; }; rm() { :; }; find() { :; }; export -f test grep printf cat rm find'; mt; MT_PRE=
[[ "$RC" != 0 && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE && pass "7: exported test/grep/printf/cat/rm/find functions do not turn failing tests into a pass" || fail "7: exported test/grep/printf/cat/rm/find functions do not turn failing tests into a pass" "rc=$RC out=$OUT"
fixture
MT_PRE='test() { return 1; }; rm() { :; }; export -f test rm'; mt; MT_PRE=
[[ "$RC" == 0 && -z "$(clones)" ]] && has READY_TO_MERGE && pass "7: with shadowing functions exported, a passing branch still passes and the clone is removed" || fail "7: with shadowing functions exported, a passing branch still passes and the clone is removed" "rc=$RC clones=$(clones) out=$OUT"

# --- 8 (D8, FOLLOWUPS 146): an empty or relative PATH entry never runs a git from the work tree ---------------------
fixture
printf '#!/bin/sh\ntouch "%s"\nexec %s "$@"\n' "$T/fake-git-ran$N" "$(command -v git)" > "$R/git"; chmod +x "$R/git"
MT_PATH=":.:$B:$PATH"; mt; MT_PATH=
[[ ! -e "$T/fake-git-ran$N" ]] && pass "8: a git in the work tree is never run through an empty or relative PATH entry" || fail "8: a git in the work tree is never run through an empty or relative PATH entry" "the fake git ran (rc=$RC)"
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "8: the run still passes with the relative entries dropped" || fail "8: the run still passes with the relative entries dropped" "rc=$RC out=$OUT"

# --- 9 (Task 2): the served command `~/.oss/hooks/oss-value.sh merge-test` runs the sibling hook, and only it -------
# hk: a copy of the hooks the dispatch needs, so the hook can be removed or replaced per case.
hk() { K="$T/hk$N"; rm -rf "$K"; mkdir -p "$K"; cp "$ROOT/hooks/oss-value.sh" "$ROOT/hooks/oss-safe-path.sh" "$ROOT/hooks/oss-merge-test.sh" "$K/"; }
ovmt() { OUT=$(cd "$R" && env HOME="$H" PATH="$B:$PATH" "$SH" "$K/oss-value.sh" merge-test "$@" 2>&1 </dev/null); RC=$?; }
fixture; hk; ovmt
[[ "$RC" == 0 && "$(cat "$(G)/tested.txt" 2>/dev/null)" == "$(rev feat/x) $(rev main)" ]] && has READY_TO_MERGE && pass "9: oss-value.sh merge-test runs the hook: READY_TO_MERGE and tested.txt" || fail "9: oss-value.sh merge-test runs the hook: READY_TO_MERGE and tested.txt" "rc=$RC out=$OUT"
fixture; hk; ovmt extra
[[ "$RC" != 0 && ! -e "$(G)/branch.txt" ]] && ! has READY_TO_MERGE && pass "9: oss-value.sh merge-test refuses any argument before recording" || fail "9: oss-value.sh merge-test refuses any argument before recording" "rc=$RC out=$OUT"
fixture; hk; rm "$K/oss-merge-test.sh"; ovmt
[[ "$RC" != 0 && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE && has 'nothing was tested or merged' && pass "9: with the hook missing it refuses and says nothing was tested or merged" || fail "9: with the hook missing it refuses and says nothing was tested or merged" "rc=$RC out=$OUT"
fixture; hk; mv "$K/oss-merge-test.sh" "$K/real.sh"; ln -s "$K/real.sh" "$K/oss-merge-test.sh"; ovmt
[[ "$RC" != 0 && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE && pass "9: a symlinked hook is refused" || fail "9: a symlinked hook is refused" "rc=$RC out=$OUT"
fixture; hk; rm "$K/oss-merge-test.sh"; mkdir "$K/oss-merge-test.sh"; ovmt
[[ "$RC" != 0 ]] && ! has READY_TO_MERGE && pass "9: a hook that is not a regular file is refused" || fail "9: a hook that is not a regular file is refused" "rc=$RC out=$OUT"
fixture; hk; OUT=$("$SH" "$K/oss-value.sh" 2>&1); has 'merge-test' && pass "9: the usage line lists merge-test" || fail "9: the usage line lists merge-test" "$OUT"

# --- 10 (ship round 1): the served entry point itself cannot be taken over before the hook's guards run -------------
# Each case runs `oss-value.sh merge-test` as the served command does (by its own first line), on a branch whose tests
# FAIL, so a READY_TO_MERGE or a tested.txt can only come from a takeover.
ovx() { OUT=$(cd "$R" && env HOME="$H" PATH="${MT_PATH:-$B:$PATH}" "$SH" -c "${MT_PRE:-:}; \"\$0\" merge-test" "$K/oss-value.sh" 2>&1 </dev/null); RC=$?; }
faked() { [[ "$RC" != 0 && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE; }
fakebash() { mkdir -p "$1"; printf '#!/bin/sh\necho READY_TO_MERGE\nexit 0\n' > "$1/bash"; chmod +x "$1/bash"; }
fixture; touch "$B/npm.fail"; hk; fakebash "$R"; MT_PATH=".:$B:$PATH"; ovx; MT_PATH=
faked && pass "10: a bash in the work tree, reached through a relative PATH entry, never runs the entry point" || fail "10: a bash in the work tree, reached through a relative PATH entry, never runs the entry point" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; hk; fakebash "$R/bin"; MT_PATH="$R/bin:$B:$PATH"; ovx; MT_PATH=
faked && pass "10: a bash in the work tree, reached through an absolute PATH entry, never runs the entry point" || fail "10: a bash in the work tree, reached through an absolute PATH entry, never runs the entry point" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; hk; FK="$T/fakehooks$N"; mkdir -p "$FK" "$R/bin"; cp "$ROOT/hooks/oss-safe-path.sh" "$FK/"; printf '#!/bin/sh\necho READY_TO_MERGE\n' > "$FK/oss-merge-test.sh"; chmod +x "$FK/oss-merge-test.sh"
printf '#!/bin/sh\necho "%s"\n' "$FK" > "$R/bin/dirname"; chmod +x "$R/bin/dirname"; MT_PATH="$R/bin:$B:$PATH"; ovx; MT_PATH=
faked && pass "10: a dirname in the work tree cannot point the entry point at another hook" || fail "10: a dirname in the work tree cannot point the entry point at another hook" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; hk; MT_PRE='exec() { echo READY_TO_MERGE; }; export -f exec'; ovx; MT_PRE=
faked && pass "10: an exported function named exec cannot fake a pass through oss-value.sh" || fail "10: an exported function named exec cannot fake a pass through oss-value.sh" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; hk; FK="$T/fakehooks$N"; mkdir -p "$FK"; cp "$ROOT/hooks/oss-safe-path.sh" "$FK/"; printf '#!/bin/sh\necho READY_TO_MERGE\n' > "$FK/oss-merge-test.sh"; chmod +x "$FK/oss-merge-test.sh"
MT_PRE="dirname() { echo '$FK'; }; export -f dirname"; ovx; MT_PRE=
faked && pass "10: an exported function named dirname cannot point the entry point at another hook" || fail "10: an exported function named dirname cannot point the entry point at another hook" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; hk; printf 'echo READY_TO_MERGE; exit 0\n' > "$T/benv$N"; MT_PRE="export BASH_ENV='$T/benv$N'"; ovx; MT_PRE=
faked && pass "10: BASH_ENV never runs in the entry point" || fail "10: BASH_ENV never runs in the entry point" "rc=$RC out=$OUT"
fixture
printf '#!/bin/sh\n/usr/bin/touch "%s"\nexec %s "$@"\n' "$T/fake-git-ran$N" "$(command -v git)" > "$R/git"; chmod +x "$R/git"
MT_PATH="."; mt; MT_PATH=
[[ ! -e "$T/fake-git-ran$N" && "$RC" != 0 ]] && ! has READY_TO_MERGE && pass "10: a PATH with no absolute entry is refused, not searched in the work tree" || fail "10: a PATH with no absolute entry is refused, not searched in the work tree" "ran=$([[ -e $T/fake-git-ran$N ]] && echo y || echo n) rc=$RC out=$OUT"

# --- 11 (ship round 1, D10): the repo's own git config and PATH entries inside the repo cannot reach the caller -----
# A command the repo's .git/config starts during the hook's git calls never sees the caller's environment secrets.
spy() { printf '#!/bin/sh\nenv > "%s"\n%s\n' "$1" "$2" > "$3"; chmod +x "$3"; }
fixture; spy "$T/fsm-env$N" 'exit 1' "$B/fsm"; (cd "$R" && git config core.fsmonitor "$B/fsm")
MT_PRE='export SECRET_X=leak'; mt; MT_PRE=
! grep -q '^SECRET_X=' "$T/fsm-env$N" 2>/dev/null && pass "11: a core.fsmonitor command from the repo config never sees the caller's secrets" || fail "11: a core.fsmonitor command from the repo config never sees the caller's secrets" "it saw SECRET_X (rc=$RC)"
fixture; spy "$T/up-env$N" 'exec git-upload-pack "$@"' "$B/up"; (cd "$R" && git config remote.origin.uploadpack "$B/up")
MT_PRE='export SECRET_X=leak'; mt; MT_PRE=
! grep -q '^SECRET_X=' "$T/up-env$N" 2>/dev/null && pass "11: a remote uploadpack command from the repo config never sees the caller's secrets" || fail "11: a remote uploadpack command from the repo config never sees the caller's secrets" "it saw SECRET_X (rc=$RC)"
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "11: with those settings in the repo config, a passing branch still passes" || fail "11: with those settings in the repo config, a passing branch still passes" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; mkdir -p "$R/tools"; printf '#!/bin/sh\nexit 0\n' > "$R/tools/npm"; chmod +x "$R/tools/npm"
MT_PATH="$R/tools:$B:$PATH"; mt; MT_PATH=
[[ "$RC" != 0 && ! -e "$(G)/tested.txt" ]] && ! has READY_TO_MERGE && pass "11: an npm in a PATH folder inside the repo never stands in for the real one" || fail "11: an npm in a PATH folder inside the repo never stands in for the real one" "rc=$RC out=$OUT"

# --- 12 (ship round 1): an interrupted run (Ctrl-C, a timeout) still removes its throwaway clone --------------------
fixture; touch "$B/npm.sleep"
( cd "$R" && exec env HOME="$H" PATH="$B:$PATH" perl -e '$SIG{INT}="DEFAULT"; setpgrp(0,0); exec @ARGV or die' "$HOOK" --v2 >/dev/null 2>&1 </dev/null ) & MTP=$!
for _i in $(seq 1 100); do [[ -s "$B/npm.log" ]] && break; sleep 0.2; done
had=$(clones); kill -INT -- "-$MTP" 2>/dev/null; wait "$MTP" 2>/dev/null
after=$(clones); [[ -n "$had" && -z "$after" && ! -e "$(G)/tested.txt" ]] && pass "12: an interrupted run removes its throwaway clone and writes no tested.txt" || fail "12: an interrupted run removes its throwaway clone and writes no tested.txt" "clone during run=$had after(at check)=$after tested=$([[ -e $(G)/tested.txt ]] && echo y || echo n) now=$(clones)"

# --- 13 (ship round 2): the in-repo PATH filter holds for worktrees, decoys and other spellings; the fetch keeps the
# user's own git login; a failed run leaves no tested.txt --------------------------------------------------------------
fakenpm() { mkdir -p "$1"; printf '#!/bin/sh\nexit 0\n' > "$1/npm"; chmod +x "$1/npm"; }
refused() { [[ "$RC" != 0 ]] && ! has READY_TO_MERGE; }
fixture; touch "$B/npm.fail"; fakenpm "$R/tools"; WT="$T/wt$N"
(cd "$R" && git worktree add -q -b feat/y "$WT" feat/x) >/dev/null 2>&1
MT_DIR="$WT"; MT_PATH="$R/tools:$B:$PATH"; mt; MT_DIR=; MT_PATH=
refused && pass "13: from a linked worktree, an npm in the main checkout never stands in for the real one" || fail "13: from a linked worktree, an npm in the main checkout never stands in for the real one" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; fakenpm "$R/tools"; mkdir -p "$R/sub/.git"
MT_DIR="$R/sub"; MT_PATH="$R/tools:$B:$PATH"; mt; MT_DIR=; MT_PATH=
refused && pass "13: an empty .git folder in a subfolder does not hide the real repo from the PATH filter" || fail "13: an empty .git folder in a subfolder does not hide the real repo from the PATH filter" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; fakenpm "$R/tools"
MT_PATH="/$R/tools:$B:$PATH"; mt; MT_PATH=
refused && pass "13: a // spelling of a folder inside the repo is still dropped" || fail "13: a // spelling of a folder inside the repo is still dropped" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; fakenpm "$R/tools"
MT_PATH="$(printf %s "$R" | LC_ALL=C tr a-z A-Z)/tools:$B:$PATH"; mt; MT_PATH=
if [[ -d "$(printf %s "$R" | LC_ALL=C tr a-z A-Z)" ]]; then
    refused && pass "13: an upper-case spelling of a folder inside the repo is still dropped" || fail "13: an upper-case spelling of a folder inside the repo is still dropped" "rc=$RC out=$OUT"
else pass "13: an upper-case spelling of a folder inside the repo is still dropped (case-sensitive disk: not reachable)"; fi
fixture; touch "$B/npm.fail"; printf 'planted\n' > "$B/npm.plant"; G > "$B/npm.plant.to"; sed -i '' 's|$|/tested.txt|' "$B/npm.plant.to"
mt
refused && [[ ! -e "$(G)/tested.txt" ]] && pass "13: a failed run leaves no tested.txt, even one the tests wrote" || fail "13: a failed run leaves no tested.txt, even one the tests wrote" "rc=$RC tested=$(cat "$(G)/tested.txt" 2>&1)"
fixture; (cd "$R" && git config --unset "url.$O.insteadOf"); printf '[url "%s"]\n\tinsteadOf = %s\n' "$O" "$URL" > "$T/gc$N"
MT_PRE="export GIT_CONFIG_GLOBAL='$T/gc$N'"; mt; MT_PRE=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "13: the user's GIT_CONFIG_GLOBAL is honoured by the fetch" || fail "13: the user's GIT_CONFIG_GLOBAL is honoured by the fetch" "rc=$RC out=$OUT"
fixture; (cd "$R" && git config --unset "url.$O.insteadOf" && git config url."ssh://git@example.invalid/".insteadOf "https://github.com/" && git config core.sshCommand "$B/sshspy")
spy "$T/ssh-env$N" 'exit 1' "$B/sshspy"
MT_PRE='export GH_TOKEN=gh-login-token SECRET_X=leak'; mt; MT_PRE=
grep -q '^GH_TOKEN=gh-login-token$' "$T/ssh-env$N" 2>/dev/null && ! grep -q '^SECRET_X=' "$T/ssh-env$N" && pass "13: the fetch of main gets GH_TOKEN (D12) and still no other secret" || fail "13: the fetch of main gets GH_TOKEN (D12) and still no other secret" "env=$(tr '\n' ' ' < "$T/ssh-env$N" 2>&1 | cut -c1-200)"
fixture; (cd "$R" && git config --unset "url.$O.insteadOf" && git config url."git://example.invalid/".insteadOf "https://github.com/" && git config core.gitProxy "$B/gproxy")
printf '#!/bin/sh\n/usr/bin/touch "%s"\nexit 1\n' "$T/gproxy-ran$N" > "$B/gproxy"; chmod +x "$B/gproxy"; mt
[[ ! -e "$T/gproxy-ran$N" ]] && refused && pass "13: a core.gitProxy from the repo config never runs (git:// is blocked)" || fail "13: a core.gitProxy from the repo config never runs (git:// is blocked)" "ran=$([[ -e $T/gproxy-ran$N ]] && echo y || echo n) rc=$RC"

# --- 14 (ship round 3): the repo is found as git finds it (decoys, bare-repo worktrees, submodules); the user's git
# and ssh settings cannot point into the repo; an interrupted run leaves no tested.txt; network settings reach the fetch
fixture; touch "$B/npm.fail"; fakenpm "$R/tools"; mkdir -p "$R/sub/.git"; echo 'ref: refs/heads/main' > "$R/sub/.git/HEAD"
MT_DIR="$R/sub"; MT_PATH="$R/tools:$B:$PATH"; mt; MT_DIR=; MT_PATH=
refused && pass "14: a .git folder holding only HEAD in a subfolder does not hide the real repo from the PATH filter" || fail "14: a .git folder holding only HEAD in a subfolder does not hide the real repo from the PATH filter" "rc=$RC out=$OUT"
fixture; WT="$T/wt$N"; (cd "$R" && git worktree add -q -b feat/y "$WT" feat/x) >/dev/null 2>&1
MT_DIR="$WT"; mt; MT_DIR=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "14: from a linked worktree, a passing branch still passes" || fail "14: from a linked worktree, a passing branch still passes" "rc=$RC out=$OUT"
fixture; BR="$T/proj$N.git"; WB="$T/wtb$N"
( git clone -q --bare "$R" "$BR" && cd "$BR" && git remote set-url origin "$URL" && git config "url.$O.insteadOf" "$URL" && git worktree add -q "$WB" feat/x ) >/dev/null 2>&1
MT_DIR="$WB"; mt; MT_DIR=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "14: from a worktree of a bare repo, PATH folders beside the bare repo are kept and a passing branch passes" || fail "14: from a worktree of a bare repo, PATH folders beside the bare repo are kept and a passing branch passes" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; SP="$T/super$N"; fakenpm "$SP/tools"
( mkdir -p "$SP" && cd "$SP" && git init -q -b main && git -c protocol.file.allow=always submodule add -q "$R" mod && cd mod \
  && git remote set-url origin "$URL" && git config "url.$O.insteadOf" "$URL" && git checkout -q feat/x ) >/dev/null 2>&1
MT_DIR="$SP/mod"; MT_PATH="$SP/tools:$B:$PATH"; mt; MT_DIR=; MT_PATH=
[[ -f "$SP/mod/.git" ]] && refused && pass "14: from a submodule, an npm in the superproject never stands in for the real one" || fail "14: from a submodule, an npm in the superproject never stands in for the real one" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; SP="$T/super$N"; SW="$T/superwt$N"
( mkdir -p "$SP" && cd "$SP" && git init -q -b main && git -c protocol.file.allow=always submodule add -q "$R" mod && git "${GITID[@]}" commit -qm s \
  && git worktree add -q "$SW" -b wtb && cd "$SW" && git -c protocol.file.allow=always submodule update -q --init && cd mod \
  && git remote set-url origin "$URL" && git config "url.$O.insteadOf" "$URL" && git checkout -q feat/x ) >/dev/null 2>&1
fakenpm "$SW/tools"; MT_DIR="$SW/mod"; MT_PATH="$SW/tools:$B:$PATH"; mt; MT_DIR=; MT_PATH=
[[ -f "$SW/mod/.git" ]] && refused && pass "14: from a submodule inside a linked worktree, an npm in that worktree never stands in" || fail "14: from a submodule inside a linked worktree, an npm in that worktree never stands in" "gitfile=$(cat "$SW/mod/.git" 2>&1) rc=$RC out=$OUT"
sshrepo() { (cd "$R" && git config --unset "url.$O.insteadOf" && git config url."ssh://git@example.invalid/".insteadOf "https://github.com/"); mkdir -p "$R/tools"; printf '#!/bin/sh\n/usr/bin/touch "%s"\nexit 1\n' "$T/repo-ssh-ran$N" > "$R/tools/ssh.sh"; chmod +x "$R/tools/ssh.sh"; }
for v in 'GIT_SSH_COMMAND=ssh&&tools/ssh.sh' 'GIT_SSH_COMMAND=${PWD}/tools/ssh.sh' 'GIT_SSH_COMMAND=tool?/ssh.sh' 'GIT_SSH_COMMAND=ssh -F@R@/tools/sshcfg' 'GIT_SSH_COMMAND=@LINK@' 'GIT_SSH_COMMAND=ssh;tools/ssh.sh' 'GIT_SSH_COMMAND="tools/ssh.sh"' 'GIT_SSH_COMMAND=ssh -oProxyCommand="tools/ssh.sh"' 'GIT_SSH_COMMAND=ssh -oProxyCommand=$PWD/tools/ssh.sh' 'GIT_SSH_COMMAND=ssh@NL@tools/ssh.sh' 'GIT_ASKPASS=sh -c tools/ssh.sh' 'GIT_SSH_COMMAND=tools/ssh.sh' 'GIT_SSH_COMMAND=sh tools/ssh.sh' 'GIT_SSH_COMMAND=@R@/tools/ssh.sh' 'GIT_SSH=@R@/tools/ssh.sh' 'GIT_SSH=tools/ssh.sh'; do
    fixture; sshrepo; v=${v/@R@/$R}; v=${v/@NL@/$'\n'}; ln -sf "$R/tools/ssh.sh" "$T/link$N"; v=${v/@LINK@/$T/link$N}; MT_PRE="export '$v' GH_TOKEN=gh-login-token"; mt; MT_PRE=
    [[ ! -e "$T/repo-ssh-ran$N" ]] && refused && has STOP: && pass "14: $v (a command inside the repo) never runs" || fail "14: $v (a command inside the repo) never runs" "ran=$([[ -e $T/repo-ssh-ran$N ]] && echo y || echo n) rc=$RC out=$OUT"
done
fixture; sshrepo; : > "$R/tools/ca.pem"; MT_PRE="export GIT_SSL_CAINFO='$R/tools/ca.pem'"; mt; MT_PRE=
refused && has 'GIT_SSL_CAINFO' && pass "14: a CA file inside the repo is refused (the repo cannot choose the fetch's trust root)" || fail "14: a CA file inside the repo is refused (the repo cannot choose the fetch's trust root)" "rc=$RC out=$OUT"
fixture; touch "$B/npm.fail"; fakenpm "$R/tools"; (cd "$R" && git pack-refs --all && rm -f .git/HEAD && ln -s refs/heads/feat/x .git/HEAD)
MT_PATH="$R/tools:$B:$PATH"; mt; MT_PATH=
[[ -L "$R/.git/HEAD" ]] && refused && pass "14: a repo whose HEAD is a symlink is still found, so its npm never stands in" || fail "14: a repo whose HEAD is a symlink is still found, so its npm never stands in" "rc=$RC out=$OUT"
fixture; sshrepo; printf '[core]\n\tsshCommand = %s\n' "$R/tools/ssh.sh" > "$R/tools/gc"; MT_PRE="export GIT_CONFIG_GLOBAL=tools/gc"; mt; MT_PRE=
[[ ! -e "$T/repo-ssh-ran$N" ]] && refused && pass "14: a GIT_CONFIG_GLOBAL inside the repo is refused" || fail "14: a GIT_CONFIG_GLOBAL inside the repo is refused" "ran=$([[ -e $T/repo-ssh-ran$N ]] && echo y || echo n) rc=$RC out=$OUT"
fixture; sshrepo; spy "$T/ssh-env$N" 'exit 1' "$B/sshspy"
MT_PRE="export GIT_SSH_COMMAND='$B/sshspy -i ~/.ssh/k -o BatchMode=yes' GH_CONFIG_DIR=/gh/cfg ALL_PROXY=socks5://proxy.test:1080 GIT_SSL_CAINFO=/ca/bundle.pem SSL_CERT_FILE=/ca/cert.pem"; mt; MT_PRE=
e="$T/ssh-env$N"; grep -qx 'GH_CONFIG_DIR=/gh/cfg' "$e" 2>/dev/null && grep -qx 'ALL_PROXY=socks5://proxy.test:1080' "$e" && grep -qx 'GIT_SSL_CAINFO=/ca/bundle.pem' "$e" && grep -qx 'SSL_CERT_FILE=/ca/cert.pem' "$e" \
  && pass "14: a GIT_SSH_COMMAND outside the repo runs, and GH_CONFIG_DIR, ALL_PROXY and the CA settings reach the fetch" || fail "14: a GIT_SSH_COMMAND outside the repo runs, and GH_CONFIG_DIR, ALL_PROXY and the CA settings reach the fetch" "env=$(tr '\n' ' ' < "$e" 2>&1 | cut -c1-300)"
fixture; touch "$B/npm.sleeptest"; printf 'planted\n' > "$B/npm.plant"; G > "$B/npm.plant.to"; sed -i '' 's|$|/tested.txt|' "$B/npm.plant.to"
( cd "$R" && exec env HOME="$H" PATH="$B:$PATH" perl -e '$SIG{INT}="DEFAULT"; setpgrp(0,0); exec @ARGV or die' "$HOOK" --v2 >/dev/null 2>&1 </dev/null ) & MTP=$!
for _i in $(seq 1 100); do [[ -e "$(G)/tested.txt" ]] && break; sleep 0.2; done
had=$([[ -e "$(G)/tested.txt" ]] && echo y); kill -INT -- "-$MTP" 2>/dev/null; wait "$MTP" 2>/dev/null
[[ -n "$had" && ! -e "$(G)/tested.txt" ]] && pass "14: an interrupted run leaves no tested.txt, even one the tests wrote" || fail "14: an interrupted run leaves no tested.txt, even one the tests wrote" "planted=$had now=$([[ -e $(G)/tested.txt ]] && echo y || echo n)"

# --- 15 (ship round 5, D14): the user's settings are checked as an allowlist; sh-style quoting, $HOME and ~ keep
# working; gh runs from /; the fetch of main never recurses into submodules ----------------------------------------
stopv() { # <label> <var>: refused, a STOP naming the variable, and the repo script never ran
    if refused && has "STOP: $2" && [[ ! -e "$T/repo-ssh-ran$N" ]]; then pass "$1"; else fail "$1" "ran=$([[ -e $T/repo-ssh-ran$N ]] && echo y || echo n) rc=$RC out=$OUT"; fi
}
fixture; mv "$R" "$T/my repo$N"; R="$T/my repo$N"; sshrepo; printf '[core]\n\tsshCommand = %s\n' "$R/tools/ssh.sh" > "$R/tools/gc"
MT_PRE="export GIT_CONFIG_GLOBAL='$R/tools/gc'"; mt; MT_PRE=; stopv "15: a GIT_CONFIG_GLOBAL inside a repo whose path has a space is refused" GIT_CONFIG_GLOBAL
fixture; sshrepo; ln -s "$R" "$H/proj"; MT_PRE="export GIT_SSH_COMMAND='sh ~/proj/tools/ssh.sh'"; mt; MT_PRE=; stopv "15: a ~/ path into the repo in GIT_SSH_COMMAND is refused" GIT_SSH_COMMAND
fixture; sshrepo; MT_PRE="export GIT_SSH_COMMAND='sh \"\$HOME/../repo$N/tools/ssh.sh\"'"; mt; MT_PRE=; stopv "15: a quoted \$HOME/.. path into the repo in GIT_SSH_COMMAND is refused" GIT_SSH_COMMAND
fixture; sshrepo; MT_PRE="export GIT_SSH_COMMAND='sh ${R#/}/tools/ssh.sh'"; mt; MT_PRE=; stopv "15: a relative path (resolved from /) into the repo in GIT_SSH_COMMAND is refused" GIT_SSH_COMMAND
fixture; sshrepo; MT_PRE="export SSL_CERT_DIR='/etc/ssl:$R/tools'"; mt; MT_PRE=; stopv "15: a CA folder list with a part inside the repo is refused" SSL_CERT_DIR
fixture; sshrepo; MT_PRE="export GIT_SSH_COMMAND='ssh -oKnownHostsCommand=%d/x'"; mt; MT_PRE=; stopv "15: a word with a / that is not an absolute path (%d/x) is refused" GIT_SSH_COMMAND
fixture; sshrepo; MT_PRE="export GIT_ASKPASS='$R/tools/ssh.sh'"; mt; MT_PRE=; stopv "15: an askpass program inside the repo is refused" GIT_ASKPASS
fixture; sshrepo; MT_PRE="export GIT_SSH_COMMAND='ssh -o \"ProxyCommand=/bin/sh $R/tools/ssh.sh\"'"; mt; MT_PRE=; stopv "15: an ssh option value with spaces that runs a repo script is refused" GIT_SSH_COMMAND
has "$R/tools/ssh.sh" && has 'started with' && pass "15: the STOP names the refused word and says the setting comes from the environment Claude Code was started with" || fail "15: the STOP names the refused word and says the setting comes from the environment Claude Code was started with" "$OUT"
has 'other than $HOME,' && pass "15: the STOP names \$HOME as written, not the user's home folder" || fail "15: the STOP names \$HOME as written, not the user's home folder" "$OUT"
fixture; VS="$T/Visual Studio Code$N.app/Contents/Resources/app/extensions/git/dist"; mkdir -p "$VS"; printf '#!/bin/sh\nexit 1\n' > "$VS/askpass.sh"; printf '#!/bin/sh\nexit 1\n' > "$VS/ssh-askpass.sh"; chmod +x "$VS/askpass.sh" "$VS/ssh-askpass.sh"
MT_PRE="export GIT_ASKPASS='$VS/askpass.sh' SSH_ASKPASS='$VS/ssh-askpass.sh'"; mt; MT_PRE=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "15: VS Code's askpass paths (with spaces) still pass" || fail "15: VS Code's askpass paths (with spaces) still pass" "rc=$RC out=$OUT"
fixture; MT_PRE="export GIT_SSH_COMMAND='ssh -o \"IdentityFile ~/.ssh/id_ed25519\" -o \"ProxyCommand /usr/bin/nc -X connect -x proxy:8080 %h %p\" -o ControlPath=~/.ssh/cm-%r@%h:%p'"; mt; MT_PRE=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "15: ssh options in the 'Option value' form outside the repo still pass" || fail "15: ssh options in the 'Option value' form outside the repo still pass" "rc=$RC out=$OUT"
fixture; MT_PRE="export GIT_SSH_COMMAND='ssh -i /*/*/*/*/*/*/*/* {1..9}{1..9}{1..9}{1..9}'"; mt; MT_PRE=
refused && has "STOP: GIT_SSH_COMMAND" && pass "15: a glob or brace range in the ssh command is refused (git's own sh would expand it), without expanding it" || fail "15: a glob or brace range in the ssh command is refused (git's own sh would expand it), without expanding it" "rc=$RC out=$OUT"
fixture; sshrepo; mkdir -p "$(gdir)/x"; cp "$R/tools/ssh.sh" "$(gdir)/x/ssh.sh"; MT_PRE="export GIT_SSH_COMMAND='sh \$GIT_DIR/x/ssh.sh'"; mt; MT_PRE=
stopv "15: a variable other than \$HOME (here \$GIT_DIR, which git sets to the repo) in GIT_SSH_COMMAND is refused" GIT_SSH_COMMAND
fixture; mkdir -p "$H/.ssh"; MT_PRE="export GIT_SSH_COMMAND='ssh -i \"\$HOME/.ssh/work key\" -o IdentitiesOnly=yes -o UserKnownHostsFile=~/.ssh/known_hosts'"; mt; MT_PRE=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "15: a GIT_SSH_COMMAND with quotes, \$HOME and ~ outside the repo still passes" || fail "15: a GIT_SSH_COMMAND with quotes, \$HOME and ~ outside the repo still passes" "rc=$RC out=$OUT"
fixture; (cd "$R" && git config --unset "url.$O.insteadOf"); mkdir -p "$T/cfg (dir) $N"; printf '[url "%s"]\n\tinsteadOf = %s\n' "$O" "$URL" > "$T/cfg (dir) $N/gc"
MT_PRE="export GIT_CONFIG_GLOBAL='$T/cfg (dir) $N/gc'"; mt; MT_PRE=
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "15: a GIT_CONFIG_GLOBAL path with spaces and parentheses outside the repo still passes" || fail "15: a GIT_CONFIG_GLOBAL path with spaces and parentheses outside the repo still passes" "rc=$RC out=$OUT"
fixture; printf '#!/bin/sh\npwd -P > "%s"\nexec "%s" "$@"\n' "$B/gh.pwd" "$B/gh" > "$B/ghw"; chmod +x "$B/ghw"; mkdir -p "$T/ghw$N"; mv "$B/ghw" "$T/ghw$N/gh"
MT_PATH="$T/ghw$N:$B:$PATH"; mt; MT_PATH=
[[ "$RC" == 0 && "$(cat "$B/gh.pwd" 2>/dev/null)" == / ]] && pass "15: gh runs from /, not from the work tree" || fail "15: gh runs from /, not from the work tree" "rc=$RC pwd=$(cat "$B/gh.pwd" 2>&1)"
fixture; RG=$(command -v git); mkdir -p "$T/gw$N"; printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexec "%s" "$@"\n' "$T/gw$N.log" "$RG" > "$T/gw$N/git"; chmod +x "$T/gw$N/git"
MT_PATH="$T/gw$N:$B:$PATH"; mt; MT_PATH=
grep 'fetch' "$T/gw$N.log" 2>/dev/null | grep -q '+refs/heads/main:refs/oss/main' && grep 'fetch' "$T/gw$N.log" | grep '+refs/heads/main:refs/oss/main' | grep -q -- '--no-recurse-submodules' && pass "15: the fetch of main never recurses into submodules" || fail "15: the fetch of main never recurses into submodules" "$(grep fetch "$T/gw$N.log" 2>&1 | head -3)"

# --- 16. the branch's own .npmrc cannot choose the shell npm runs the scripts with (API ship pen-test) ------------
# Real npm, not the stub: a project .npmrc `script-shell` that exits 0 would make every npm script "pass".
mainrc() { # <npmrc line>: commit an .npmrc on main and push it (main's .npmrc is trusted; D25 STOPs on a branch's)
    ( cd "$R" && git checkout -q main && printf '%s\n' "$1" > .npmrc && git add .npmrc && git "${GITID[@]}" commit -qm rc \
      && git push -q origin main && git checkout -q feat/x && git "${GITID[@]}" merge -q --no-edit main ) >/dev/null 2>&1
}
npmproj() { # <test script> [npmrc line]: an optional .npmrc on main, then a package.json and an empty lockfile on feat/x
    [[ -z ${2:-} ]] || mainrc "$2"
    printf '{"name":"x","version":"1.0.0","scripts":{"test":"%s"}}\n' "$1" > "$R/package.json"
    printf '{"name":"x","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x","version":"1.0.0"}}}\n' > "$R/package-lock.json"
    ( cd "$R" && git add -A && git "${GITID[@]}" commit -qm npm ) >/dev/null 2>&1; rm -f "$B/npm"
}
if command -v npm >/dev/null 2>&1; then
    fixture; npmproj 'exit 0' 'script-shell=/usr/bin/false'; mt
    [[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16: a project .npmrc script-shell that always fails does not stop a passing test (real npm, offline)" || fail "16: a project .npmrc script-shell that always fails does not stop a passing test (real npm, offline)" "rc=$RC out=$OUT"
    fixture; npmproj 'exit 1' 'script-shell=/usr/bin/true'; mt
    [[ "$RC" != 0 ]] && ! has READY_TO_MERGE && has "STOP: npm ci, the build or the tests failed" && [[ ! -e "$(G)/tested.txt" ]] && pass "16: a project .npmrc script-shell that always succeeds does not make a failing test pass" || fail "16: a project .npmrc script-shell that always succeeds does not make a failing test pass" "rc=$RC out=$OUT"
    # D24: a project .npmrc naming a standard shell is honoured (a test that passes only in full, non-posix bash)
    fixture; npmproj 'test -n \"$BASH_VERSION\" && ! shopt -oq posix' 'script-shell=/bin/bash'; mt
    [[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16: a project .npmrc script-shell=/bin/bash runs the tests with bash" || fail "16: a project .npmrc script-shell=/bin/bash runs the tests with bash" "rc=$RC out=$OUT"
    # round 3 (code review LOW): a CRLF .npmrc with a trailing space still names bash
    fixture; npmproj 'test -n \"$BASH_VERSION\" && ! shopt -oq posix' $'script-shell=/bin/bash \r'; mt
    [[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16: a CRLF .npmrc script-shell=/bin/bash with a trailing space runs the tests with bash" || fail "16: a CRLF .npmrc script-shell=/bin/bash with a trailing space runs the tests with bash" "rc=$RC out=$OUT"
    # round 3 (code review LOW): with script-shell=/bin/zsh, the caller's ~/.zshenv never runs in the clean run
    # (needs /bin/zsh: it fails, never skips, without it; macOS ships it, a Linux CI image must install zsh)
    fixture; printf 'exit 0\n' > "$H/.zshenv"; npmproj 'exit 1' 'script-shell=/bin/zsh'; mt; rm -f "$H/.zshenv"
    [[ -x /bin/zsh ]] && [[ "$RC" != 0 ]] && ! has READY_TO_MERGE && has "STOP: npm ci, the build or the tests failed" && [[ ! -e "$(G)/tested.txt" ]] && pass "16: with script-shell=/bin/zsh, ~/.zshenv does not make a failing test pass" || fail "16: with script-shell=/bin/zsh, ~/.zshenv does not make a failing test pass" "rc=$RC out=$OUT"
    # round 2 (pen-test MEDIUM): node-options loads a file that turns the failing exit code into 0
    fixture; printf 'process.exit(1)\n' > "$R/t.js"; printf 'process.on("exit",()=>{process.exitCode=0})\n' > "$R/p.js"
    npmproj 'node t.js' 'node-options=--require ./p.js'; mt
    [[ "$RC" != 0 ]] && ! has READY_TO_MERGE && has "STOP: npm ci, the build or the tests failed" && [[ ! -e "$(G)/tested.txt" ]] && pass "16: a project .npmrc node-options does not make a failing test pass" || fail "16: a project .npmrc node-options does not make a failing test pass" "rc=$RC out=$OUT"
else
    fail "16: real npm is needed for the .npmrc cases" "npm not on PATH"
fi

# --- 16b. D25: a branch that changes the root .npmrc is never tested or merged by this step ---------------------------
branchrc() { ( cd "$R" && if [[ -n $1 ]]; then printf '%s\n' "$1" > .npmrc; else rm -f .npmrc; fi && git add -A && git "${GITID[@]}" commit -qm rc ) >/dev/null 2>&1; }
rcstop() { [[ "$RC" != 0 ]] && ! has READY_TO_MERGE && has "changes the root .npmrc" && [[ ! -e "$(G)/tested.txt" ]] && [[ ! -s "$B/npm.log" ]]; }
fixture; branchrc 'workspaces=true'; mt
rcstop && pass "16b: a branch that adds a root .npmrc STOPs before npm runs" || fail "16b: a branch that adds a root .npmrc STOPs before npm runs" "rc=$RC out=$OUT"
fixture; mainrc 'fund=false'; branchrc 'workspace=a'; mt
rcstop && pass "16b: a branch that edits main's .npmrc STOPs before npm runs" || fail "16b: a branch that edits main's .npmrc STOPs before npm runs" "rc=$RC out=$OUT"
fixture; mainrc 'fund=false'; branchrc ''; mt
rcstop && pass "16b: a branch that removes main's .npmrc STOPs before npm runs" || fail "16b: a branch that removes main's .npmrc STOPs before npm runs" "rc=$RC out=$OUT"
fixture; mainrc 'fund=false'; (cd "$R" && rm .npmrc && ln -s /dev/null .npmrc && git add -A && git "${GITID[@]}" commit -qm link) >/dev/null 2>&1; mt
rcstop && pass "16b: a branch that turns .npmrc into a link STOPs before npm runs" || fail "16b: a branch that turns .npmrc into a link STOPs before npm runs" "rc=$RC out=$OUT"
# round 4 (pen-test HIGH): .NPMRC is another file to git but the same file to npm on a case-insensitive disk
fixture; branchrc ''; (cd "$R" && printf 'workspaces=true\n' > .NPMRC && git add -A && git "${GITID[@]}" commit -qm rc) >/dev/null 2>&1; mt
# on a case-sensitive disk .NPMRC is another file that npm never reads, so the run is tested as usual
touch "$T/casepr$N"; if [[ -e "$T/CASEPR$N" ]]; then
    rcstop && pass "16b: a branch that adds .NPMRC (another case) STOPs before npm runs (case-insensitive disk)" || fail "16b: a branch that adds .NPMRC (another case) STOPs before npm runs (case-insensitive disk)" "rc=$RC out=$OUT"
else
    [[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16b: .NPMRC is not .npmrc on a case-sensitive disk and is tested as usual" || fail "16b: .NPMRC is not .npmrc on a case-sensitive disk and is tested as usual" "rc=$RC out=$OUT"
fi
# (needs a git built with iconv for working-tree-encoding, as macOS and Linux distribution gits are)
# round 4 (pen-test MEDIUM), round 6: a branch .gitattributes that re-encodes main's .npmrc changes what npm reads
fixture; mainrc 'fund=false'; (cd "$R" && printf '.npmrc working-tree-encoding=UTF-16\n' > .gitattributes && git add .gitattributes && git "${GITID[@]}" commit -qm attr) >/dev/null 2>&1; mt
rcstop && pass "16b: a branch .gitattributes that re-encodes main's .npmrc STOPs before npm runs" || fail "16b: a branch .gitattributes that re-encodes main's .npmrc STOPs before npm runs" "rc=$RC out=$OUT"
# round 6 (pen-test, audit MEDIUM): main's .npmrc is a link; the branch edits the file it points to
fixture; (cd "$R" && git checkout -q main && printf 'fund=false\n' > npmrc.shared && ln -s npmrc.shared .npmrc && git add .npmrc npmrc.shared \
  && git "${GITID[@]}" commit -qm rc && git push -q origin main && git checkout -q feat/x && git "${GITID[@]}" merge -q --no-edit main \
  && printf 'workspaces=true\n' > npmrc.shared && git add npmrc.shared && git "${GITID[@]}" commit -qm edit) >/dev/null 2>&1; mt
rcstop && pass "16b: a branch that edits the file main's .npmrc links to STOPs before npm runs" || fail "16b: a branch that edits the file main's .npmrc links to STOPs before npm runs" "rc=$RC out=$OUT"
# round 6 (audit LOW): the tests run on the squash result as a fresh checkout writes it (the branch's attributes)
fixture; (cd "$R" && git checkout -q main && printf 'x\n' > g.txt && git add g.txt && git "${GITID[@]}" commit -qm g && git push -q origin main \
  && git checkout -q feat/x && git "${GITID[@]}" merge -q --no-edit main && printf 'g.txt eol=crlf\n' > .gitattributes && git add .gitattributes \
  && git "${GITID[@]}" commit -qm attr) >/dev/null 2>&1
cat > "$B/npm" <<'NPM'
#!/bin/sh
case "$1" in test) test "$(wc -c < g.txt | tr -d ' ')" = 3 ;; *) exit 0 ;; esac
NPM
chmod +x "$B/npm"; mt
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16b: the tests see a file the way a fresh checkout of the squash result writes it" || fail "16b: the tests see a file the way a fresh checkout of the squash result writes it" "rc=$RC out=$OUT"
# heads-up (no silent tightening): a branch that never touches .npmrc is tested, whatever main's .npmrc setup
fixture; (cd "$R" && git checkout -q main && printf 'fund=false\n' > .npmrc && printf '.npmrc eol=crlf\n' > .gitattributes && git add .npmrc .gitattributes \
  && git "${GITID[@]}" commit -qm rc && git push -q origin main && git checkout -q feat/x && git "${GITID[@]}" merge -q --no-edit main) >/dev/null 2>&1; mt
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16b: main's .gitattributes converting its .npmrc (eol=crlf) does not stop an untouched branch" || fail "16b: main's .gitattributes converting its .npmrc (eol=crlf) does not stop an untouched branch" "rc=$RC out=$OUT"
fixture; (cd "$R" && git checkout -q main && printf 'fund=false\n' > npmrc.shared && ln -s npmrc.shared .npmrc && git add .npmrc npmrc.shared \
  && git "${GITID[@]}" commit -qm rc && git push -q origin main && git checkout -q feat/x && git "${GITID[@]}" merge -q --no-edit main) >/dev/null 2>&1; mt
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16b: main's .npmrc as a link does not stop an untouched branch" || fail "16b: main's .npmrc as a link does not stop an untouched branch" "rc=$RC out=$OUT"
fixture; mainrc 'fund=false'; mt
[[ "$RC" == 0 ]] && has READY_TO_MERGE && pass "16b: main's own .npmrc, unchanged by the branch, is tested as before" || fail "16b: main's own .npmrc, unchanged by the branch, is tested as before" "rc=$RC out=$OUT"

# --- 17. hook security audit (D18): unusual .git layouts, missing in-repo paths, PATH swapped after the check ---------
# a git the repo ships in bin/: records that it ran, then does the real work
spygit() { mkdir -p "$R/bin"; printf '#!/bin/sh\n/usr/bin/touch "%s"\nexec %s "$@"\n' "$T/repo-git-ran$N" "$(command -v git)" > "$R/bin/git"; chmod +x "$R/bin/git"; }
# a .git folder with HEAD and a commondir file (objects and refs live elsewhere), which git accepts
fixture; mv "$R/.git" "$T/common$N"; mkdir "$R/.git"; mv "$T/common$N/HEAD" "$T/common$N/index" "$R/.git/"; printf '%s\n' "$T/common$N" > "$R/.git/commondir"
spygit; MT_PATH="$R/bin:$B:$PATH"; mt; MT_PATH=
[[ ! -e "$T/repo-git-ran$N" ]] && pass "17: a git in the work tree is never run when .git is a folder with a commondir file" || fail "17: a git in the work tree is never run when .git is a folder with a commondir file" "rc=$RC out=$OUT"
# a path setting naming a file in a folder inside the repo that does not exist yet
fixture; sshrepo; MT_PRE="export GIT_SSH='$R/not-yet/ssh'"; mt; MT_PRE=; stopv "17: a GIT_SSH path inside the repo that does not exist yet is refused" GIT_SSH
# the same, through a folder outside the repo that is a dangling symlink into it (round 2, code review LOW)
fixture; sshrepo; ln -s "$R/not-yet" "$T/dangle$N"; MT_PRE="export GIT_SSH='$T/dangle$N/ssh'"; mt; MT_PRE=; stopv "17: a GIT_SSH path through a dangling symlink into the repo is refused" GIT_SSH
# round 2 (pen-test MEDIUM): a .git folder whose HEAD git rejects, so git goes on up to the real repo
fixture; spygit; mkdir -p "$R/sub/.git/objects" "$R/sub/.git/refs"; printf 'garbage\n' > "$R/sub/.git/HEAD"
MT_DIR="$R/sub"; MT_PATH="$R/bin:$B:$PATH"; mt; MT_DIR=; MT_PATH=
[[ ! -e "$T/repo-git-ran$N" ]] && pass "17: a .git folder with an invalid HEAD does not hide the real repo from the PATH filter" || fail "17: a .git folder with an invalid HEAD does not hide the real repo from the PATH filter" "rc=$RC out=$OUT"
# round 3 (audit MEDIUM): HEAD a link to something not under refs/, or an objects folder git cannot enter
fixture; spygit; mkdir -p "$R/sub/.git/objects" "$R/sub/.git/refs"; ln -s garbage "$R/sub/.git/HEAD"
MT_DIR="$R/sub"; MT_PATH="$R/bin:$B:$PATH"; mt; MT_DIR=; MT_PATH=
[[ ! -e "$T/repo-git-ran$N" ]] && pass "17: a .git folder whose HEAD links outside refs/ does not hide the real repo from the PATH filter" || fail "17: a .git folder whose HEAD links outside refs/ does not hide the real repo from the PATH filter" "rc=$RC out=$OUT"
fixture; spygit; mkdir -p "$R/sub/.git/objects" "$R/sub/.git/refs"; printf 'ref: refs/heads/main\n' > "$R/sub/.git/HEAD"; chmod 600 "$R/sub/.git/objects"
MT_DIR="$R/sub"; MT_PATH="$R/bin:$B:$PATH"; mt; MT_DIR=; MT_PATH=; chmod 700 "$R/sub/.git/objects"
[[ ! -e "$T/repo-git-ran$N" ]] && pass "17: a .git folder whose objects folder git cannot enter does not hide the real repo from the PATH filter" || fail "17: a .git folder whose objects folder git cannot enter does not hide the real repo from the PATH filter" "rc=$RC out=$OUT"
# round 2 (audit LOW): a PATH folder whose resolved name holds a ':' must not split into a folder inside the repo
fixture; spygit; mkdir -p "$T/c$N/b:$R/bin"; ln -s "$T/c$N/b:$R/bin" "$T/colon$N"
MT_PATH="$T/colon$N:$B:$PATH"; mt; MT_PATH=
[[ ! -e "$T/repo-git-ran$N" ]] && pass "17: a PATH folder resolving to a name with ':' never puts the repo's bin on PATH" || fail "17: a PATH folder resolving to a name with ':' never puts the repo's bin on PATH" "rc=$RC out=$OUT"
# a PATH entry that is a symlink, pointed into the repo after the PATH check (here by gh, which runs after it)
fixture; spygit; ln -s "$B" "$T/lnk$N"; mv "$B/gh" "$B/gh.real"
printf '#!/bin/sh\nln -sfn "%s" "%s"\nexec "%s" "$@"\n' "$R/bin" "$T/lnk$N" "$B/gh.real" > "$B/gh"; chmod +x "$B/gh"; cp "$B/npm" "$R/bin/npm"
MT_PATH="$T/lnk$N:$PATH"; mt; MT_PATH=
[[ ! -e "$T/repo-git-ran$N" ]] && pass "17: a PATH symlink re-pointed into the repo after the check never runs the repo's git" || fail "17: a PATH symlink re-pointed into the repo after the check never runs the repo's git" "rc=$RC out=$OUT"

echo ""
echo "oss-merge-test: $RUN run, $FAILED failed"
[[ "$FAILED" == 0 ]]
