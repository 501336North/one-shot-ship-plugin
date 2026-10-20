#!/bin/bash
# The cwd walk finds the project the command runs in - never an enclosing one - and the shell and
# TypeScript resolvers give the same answer for the same tree.
#
# @behavior With no CLAUDE_PROJECT_DIR and no session pointer, a command run inside a repo sends its
#           events to the nearest real .oss at or below that repo's root. A repo whose git config
#           points its work tree at an enclosing project (core.worktree=../.., or an absolute path)
#           cannot pull a nested repo's events into that enclosing project. Names with spaces,
#           trailing spaces and newlines, and a `.git` FILE (worktrees, submodules), resolve the
#           same in hooks/oss-safe-path.sh and watcher/src/utils/project-dir.ts.
# @business-rule notify-routing-unify ship round 1 (R1-2, R1-3): step 3 of the routing rule is the
#           nearest real .oss walking up from the physical cwd, stopping at (and including) the
#           first directory that holds a `.git` entry - no git calls, so no git config or GIT_*
#           variable can move the bound and there is no git output to trim. No `.git` anywhere
#           above: no project.
#
# Usage: ./hooks/__tests__/project-walk.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/project-walk.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running project-walk tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-walk.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
H="$T/home"; mkdir -p "$H/.oss"
repo() { mkdir -p "$1" && (cd "$1" && git init -q) >/dev/null 2>&1; }
# R2-2: another user's folder, simulated - FOREIGN lists exact paths (":"-separated) that the shell
# `test -O` (BASH_ENV) and the TS lstat uid (a --require shim) report as owned by someone else.
FOREIGN=""
cat > "$T/foreign.sh" <<'SH'
test() { if [[ "${1:-}" == -O && -n "${OSS_T_FOREIGN:-}" && ":$OSS_T_FOREIGN:" == *":${2:-}:"* ]]; then return 1; fi; builtin test "$@"; }
SH
cat > "$T/foreign.cjs" <<'JS'
const fs = require('fs');
const list = (process.env.OSS_T_FOREIGN || '').split(':').filter(Boolean);
const orig = fs.lstatSync;
fs.lstatSync = function (p, ...a) {
  const st = orig.call(fs, p, ...a);
  if (!st || !list.includes(String(p))) return st;
  return new Proxy(st, { get: (t, k) => (k === 'uid' ? t.uid + 1 : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
};
require('module').syncBuiltinESMExports();
JS

# shell_proj <cwd> / ts_proj <cwd>: the project each resolver picks (no env, no pointer); "" = none.
# A trailing "." is printed and removed so a name ending in a newline or space survives $(...).
shell_proj() { # <cwd> [session id]
    local o; o=$(cd "$1" && env -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_SESSION_ID HOME="$H" ${2:+CLAUDE_CODE_SESSION_ID="$2"} BASH_ENV="$T/foreign.sh" OSS_T_FOREIGN="$FOREIGN" "$SH" -c \
        'source "$1/hooks/oss-safe-path.sh"; oss_resolve_project; printf "%s." "$_OSS_PROJ"' _ "$ROOT" 2>&1); printf '%s' "${o%.}"
}
ts_proj() { # <cwd> [session id]
    local o; o=$(cd "$1" && env -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_SESSION_ID HOME="$H" ${2:+CLAUDE_CODE_SESSION_ID="$2"} OSS_T_FOREIGN="$FOREIGN" node --require "$T/foreign.cjs" --input-type=module -e '
        const m = await import(process.argv[1]);
        const p = m.resolveProjectDir({ HOME: process.env.HOME, CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID }, process.cwd());
        process.stdout.write((p ?? "") + ".");' "$ROOT/watcher/dist/utils/project-dir.js" 2>&1); printf '%s' "${o%.}"
}
# expect <label> <cwd> <want> [session id]: both resolvers give <want>
expect() {
    local s t; s=$(shell_proj "$2" "${4:-}"); t=$(ts_proj "$2" "${4:-}")
    [[ "$s" == "$3" ]] && pass "shell: $1" || fail "shell: $1" "got [$s] want [$3]"
    [[ "$t" == "$3" ]] && pass "ts: $1" || fail "ts: $1" "got [$t] want [$3]"
}

# --- R1-3: pen-test repros (git config cannot move the bound into an enclosing project) --------
E="$T/enclosing"; repo "$E"; mkdir -p "$E/.oss"
R="$E/R"; repo "$R"; (cd "$R" && git config core.worktree ../..)
expect "a nested repo with core.worktree=../.. never resolves the enclosing project" "$R" ""
A="$T/projA"; repo "$A"; mkdir -p "$A/.oss"
N="$A/x/N"; repo "$N"; (cd "$N" && git config core.worktree "$A")
expect "a nested repo with core.worktree=<A> never resolves A" "$N" ""
mkdir -p "$N/deep"
expect "a subfolder of that nested repo never resolves A either" "$N/deep" ""
OUT=$(cd "$A/x" && GIT_DIR="$N/.git" GIT_WORK_TREE="$E" "$SH" -c 'source "$1/hooks/oss-safe-path.sh"; oss_project_walk "$(pwd -P)"; printf "%s" "$_OSS_PROJ"' _ "$ROOT" 2>&1)
[[ "$OUT" == "$A" ]] && pass "GIT_DIR / GIT_WORK_TREE in the environment do not move the walk" || fail "GIT_DIR / GIT_WORK_TREE in the environment do not move the walk" "got [$OUT]"

# --- R1-2: the same tree through both twins -------------------------------------------------------
S="$T/p one "; repo "$S"; mkdir -p "$S/.oss" "$S/a b/c "
expect "a repo whose name ends in a space resolves itself" "$S/a b/c " "$S"
NL="$T/nl
proj"; repo "$NL"; mkdir -p "$NL/.oss" "$NL/sub"
expect "a repo whose name holds a newline resolves itself" "$NL/sub" "$NL"
W="$T/wt"; mkdir -p "$W/.oss" "$W/sub"; printf 'gitdir: %s\n' "$T/elsewhere" > "$W/.git"
expect "a .git FILE (worktree/submodule) bounds the walk and its .oss counts" "$W/sub" "$W"
M="$W/sub/mod"; mkdir -p "$M/in"; printf 'gitdir: %s\n' "$T/elsewhere2" > "$M/.git"
expect "a submodule (.git file) with no .oss resolves nothing, not its superproject" "$M/in" ""
I="$S/inner"; repo "$I"
expect "a nested repo with no .oss borrows nothing from its parent" "$I" ""
mkdir -p "$S/a b/.oss"
expect "the nearest real .oss below the repo root wins" "$S/a b/c " "$S/a b"
O="$T/norepo"; mkdir -p "$O/.oss" "$O/sub"
expect "outside any repo a stray .oss is not a project" "$O/sub" ""
expect "the sandbox HOME (not a repo) is not a project" "$H" ""
L="$T/linked"; repo "$L"; mkdir -p "$T/target"; ln -s "$T/target" "$L/.oss"
expect "a linked .oss is never followed" "$L" ""

# --- R2-1: the session pointer against the walk (pointer named through a link to the product) ----
Q="$T/prodQ"; repo "$Q"; mkdir -p "$Q/.oss" "$Q/sub/stray/.oss"; ln -s "$Q" "$T/linkQ"
mkdir -m 700 -p "$H/.oss/sessions/SQ"; printf '%s\n' "$T/linkQ" > "$H/.oss/sessions/SQ/project"; chmod 600 "$H/.oss/sessions/SQ/project"
expect "a stray .oss inside the pointer's repo (pointer spelled through a link) keeps the pointer" "$Q/sub/stray" "$T/linkQ" SQ
expect "another repo's own .oss wins over the pointer" "$S/a b/c " "$S/a b" SQ
expect "a nested repo with no .oss keeps the pointer" "$I" "$T/linkQ" SQ

# --- R2-2: only the user's own .oss, only in the user's own repo (mirrors git safe.directory) ------
X="$T/tmpX"; repo "$X"; mkdir -p "$X/.oss" "$X/foo"
FOREIGN="$X:$X/.oss"
expect "another user's folder holding .git and .oss (attacker-made /tmp/.git + /tmp/.oss) is no project" "$X/foo" ""
expect "... and the session pointer keeps its product there" "$X/foo" "$T/linkQ" SQ
FOREIGN="$X"
expect "the user's own .oss inside another user's repo is no project" "$X/foo" ""
G="$T/mine"; repo "$G"; mkdir -p "$G/.oss" "$G/sub/.oss" "$G/sub/x"
FOREIGN="$G/sub/.oss"
expect "a .oss owned by another user is skipped (the user's own one above is found)" "$G/sub/x" "$G"
FOREIGN="$G/sub/.oss"
expect "... also when the session pointer names another product" "$G/sub/x" "$G" SQ
FOREIGN=""
expect "control: the same trees with nothing foreign" "$X/foo" "$X"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
