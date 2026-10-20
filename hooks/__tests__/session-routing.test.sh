#!/bin/bash
# Four sessions, four products, at the same time: every event lands in its own session's product.
#
# @behavior A customer starts four Claude Code sessions - minutes or days apart, in any order - one
#           per product (P1..P4). Whatever folder a command runs from (a product sub-folder that holds
#           a stray .oss, a folder outside any repo, a submodule of the product), its status, logs,
#           failure notices, errors and workflow state land in THAT session's product - never in
#           another product, never in the stray .oss, never in the global ~/.oss. A pointer that is
#           missing, linked, not one absolute line, or whose session id is unset falls back to the
#           cwd walk - never to another session's product. Ending a session removes only its own
#           pointer; pointers older than 30 days are pruned, younger ones kept.
# @business-rule notify-routing-unify ship round 1 (R1-1, R1-2): project = CLAUDE_PROJECT_DIR, else
#           this session's pointer ~/.oss/sessions/<CLAUDE_CODE_SESSION_ID>/project (written by the
#           SessionStart hook, owner-only, checked before use), else the nearest real .oss up to the
#           first .git entry, else the global ~/.oss.
#
# The REAL hooks and the REAL built CLIs from this checkout run, with a sandbox HOME.
# Usage: ./hooks/__tests__/session-routing.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/session-routing.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running session-routing tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-sessions.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID
H="$T/home"; mkdir -p "$H/.oss"
OUTSIDE="$T/outside"; mkdir -p "$OUTSIDE"
SESS="$H/.oss/sessions"

# Products: real repos with a real .oss, a sub-folder holding a stray .oss, and a real submodule.
LIB="$T/lib"; mkdir -p "$LIB"; (cd "$LIB" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init) >/dev/null 2>&1
for n in 1 2 3 4; do
    p="$T/prod $n"; mkdir -p "$p/.oss" "$p/sub/stray/.oss"
    (cd "$p" && git init -q && git -c protocol.file.allow=always submodule add -q "$LIB" mod) >/dev/null 2>&1
    eval "P$n=\"\$p\""
done
prod() { eval "printf '%s' \"\$P$1\""; }

# start_session <id> <project> <days-ago>: the real SessionStart hook as Claude Code runs it, then
# the pointer is aged to <days-ago> (sessions started days apart).
start_session() {
    (cd "$2" && env HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$2" CLAUDE_CODE_SESSION_ID="$1" \
        "$SH" "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 <<< "{\"session_id\":\"$1\",\"source\":\"startup\",\"hook_event_name\":\"SessionStart\"}")
    [[ "$3" == 0 ]] || touch -t "$(date -v-"$3"d +%Y%m%d%H%M 2>/dev/null || date -d "-$3 days" +%Y%m%d%H%M)" "$SESS/$1/project" 2>/dev/null
}
# Shuffled order, days apart.
start_session S3 "$P3" 9
start_session S1 "$P1" 4
start_session S4 "$P4" 2
start_session S2 "$P2" 0

for n in 1 2 3 4; do
    [[ -f "$SESS/S$n/project" && "$(cat "$SESS/S$n/project")" == "$(prod $n)" ]] \
        && pass "SessionStart wrote S$n's pointer to product $n (started in shuffled order, days apart)" \
        || fail "SessionStart wrote S$n's pointer to product $n (started in shuffled order, days apart)" "$(ls -la "$SESS" "$SESS/S$n" 2>&1 | tr '\n' ' ')"
done
modes=$(ls -ld "$SESS" "$SESS/S1" "$SESS/S1/project" 2>/dev/null | awk '{print substr($1,1,10)}' | tr '\n' ' ')
[[ "$modes" == "drwx------ drwx------ -rw------- " ]] && pass "the pointer is owner-only (700 dirs, 600 file)" || fail "the pointer is owner-only (700 dirs, 600 file)" "$modes"

# Event artifacts a run may leave, anywhere.
ARTS=(.oss/logs .oss/workflow-state.json .oss/workflow.log)
places() { local n; for n in 1 2 3 4; do printf '%s\n' "$(prod $n)" "$(prod $n)/sub/stray" "$(prod $n)/mod"; done; printf '%s\n' "$H" "$OUTSIDE"; }
clean() { local x a; while IFS= read -r x; do for a in "${ARTS[@]}"; do rm -rf "$x/$a"; done; done < <(places); }
# landed <n>: product n holds an artifact; nowhere else does
landed() {
    local x a hit="" stray=""
    while IFS= read -r x; do
        for a in "${ARTS[@]}"; do
            [[ -e "$x/$a" ]] || continue
            if [[ "$x" == "$(prod "$1")" ]]; then hit=1; else stray="$stray $x/$a"; fi
        done
    done < <(places)
    [[ -n "$hit" && -z "$stray" ]] || { WHY="hit=${hit:-none} elsewhere:${stray:- none}"; return 1; }
}
# ev <n> <cwd> <cmd...>: run as the Bash tool runs it in session n (no CLAUDE_PROJECT_DIR)
ev() {
    local n="$1" cwd="$2"; shift 2
    OUT=$(cd "$cwd" && env -u CLAUDE_PROJECT_DIR HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_WATCHER=1 CLAUDE_CODE_SESSION_ID="S$n" "$@" 2>&1 </dev/null); RC=$?
}
vfailed() { # <n> <cwd>
    local vd; vd=$(cd "$2" && env -u CLAUDE_PROJECT_DIR HOME="$H" CLAUDE_CODE_SESSION_ID="S$1" "$SH" "$ROOT/hooks/oss-value.sh" dir 2>/dev/null </dev/null)
    [[ -n "$vd" ]] && echo "reason-$1" > "$vd/reason.txt"
    ev "$1" "$2" "$SH" "$ROOT/hooks/oss-value.sh" failed build
}
wait_agent() { local i; for i in 1 2 3 4 5 6 7 8 9 10; do [[ -f "$(prod "$1")/.oss/workflow-state.json" ]] && grep -qF oss:debugger "$(prod "$1")/.oss/workflow-state.json" && return; sleep 0.3; done; }

check() { # <label>
    if landed "$N"; then pass "$1"; else fail "$1" "$WHY rc=$RC out=$(printf '%s' "$OUT" | head -3)"; fi
}
ERR_ARGS=(--code OSS-API-001 --severity HIGH --message routing-msg --source cmd:build)
for N in 4 2 1 3; do
    p=$(prod $N)
    for where in stray outside submodule; do
        case $where in stray) cwd="$p/sub/stray" ;; outside) cwd="$OUTSIDE" ;; submodule) cwd="$p/mod" ;; esac
        clean; ev $N "$cwd" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build start '{}';   check "S$N from $where: oss-notify lands in product $N only"
        clean; ev $N "$cwd" "$SH" "$ROOT/hooks/oss-log.sh" write build "msg-$N";             check "S$N from $where: oss-log write lands in product $N only"
        clean; ev $N "$cwd" "$SH" "$ROOT/hooks/oss-log.sh" phase build RED start;            check "S$N from $where: oss-log phase lands in product $N only"
        clean; ev $N "$cwd" "$SH" "$ROOT/hooks/oss-log.sh" agent build oss:debugger "x"; wait_agent $N; check "S$N from $where: oss-log agent lands in product $N only"
        clean; vfailed $N "$cwd";                                                            check "S$N from $where: oss-value failed lands in product $N only"
        clean; ev $N "$cwd" node "$ROOT/watcher/dist/cli/oss-error.js" "${ERR_ARGS[@]}";     check "S$N from $where: oss-error lands in product $N only"
        clean; ev $N "$cwd" node "$ROOT/watcher/dist/cli/update-workflow-state.js" setSupervisor intervening; check "S$N from $where: update-workflow-state lands in product $N only"
    done
done

# --- fallbacks: a pointer that cannot be trusted is ignored -> the cwd walk (here: product 2) ----
# Run from product 2's plain sub-folder with a session whose pointer would say product 1.
mkdir -p "$P2/plain"
fb() { # <label> <id> [home]
    clean
    OUT=$(cd "$P2/plain" && env -u CLAUDE_PROJECT_DIR HOME="${3:-$H}" CLAUDE_PLUGIN_ROOT="$ROOT" ${2:+CLAUDE_CODE_SESSION_ID="$2"} \
        "$SH" "$ROOT/hooks/oss-log.sh" write build fb 2>&1 </dev/null); RC=$?
    local s t; s=$(grep -lF fb "$P2/.oss/logs/current-session/build.log" 2>/dev/null); t=$(ls "$P1/.oss/logs" 2>/dev/null)
    OUT2=$(cd "$P2/plain" && env -u CLAUDE_PROJECT_DIR HOME="${3:-$H}" ${2:+CLAUDE_CODE_SESSION_ID="$2"} node "$ROOT/watcher/dist/cli/update-workflow-state.js" setSupervisor intervening 2>&1 </dev/null)
    [[ -n "$s" && -z "$t" && -f "$P2/.oss/workflow-state.json" && ! -e "$P1/.oss/workflow-state.json" ]] \
        && pass "fallback: $1 -> the cwd walk (shell and TS), never the pointer's product" \
        || fail "fallback: $1 -> the cwd walk (shell and TS), never the pointer's product" "P2 log=${s:-none} P1 logs=${t:-none} out=$OUT $OUT2"
}
fb "no pointer for this session id" S9
fb "CLAUDE_CODE_SESSION_ID unset" ""
mkdir -m 700 "$SESS/LF"; printf '%s\n' "$P1" > "$T/ptr"; ln -s "$T/ptr" "$SESS/LF/project"
fb "the pointer file is a symlink" LF
ln -s "$SESS/S1" "$SESS/LD"
fb "the session folder is a symlink" LD
H2="$T/home2"; mkdir -p "$H2/.oss"; ln -s "$SESS" "$H2/.oss/sessions"
fb "~/.oss/sessions is a symlink" S1 "$H2"
mkdir -m 700 "$SESS/RL"; printf '%s\n' "../../prod 1" > "$SESS/RL/project"; chmod 600 "$SESS/RL/project"   # from the cwd: product 1
fb "the pointer holds a relative path" RL
TWO="$T/two
lines"; mkdir -p "$TWO/.oss"   # a real folder whose name is two lines
mkdir -m 700 "$SESS/ML"; printf '%s\n' "$TWO" > "$SESS/ML/project"; chmod 600 "$SESS/ML/project"
fb "the pointer is more than one line" ML
mkdir -m 700 "$SESS/NO"; printf '%s\n' "$T/outside" > "$SESS/NO/project"; chmod 600 "$SESS/NO/project"
fb "the pointer names a folder with no real .oss" NO
fb "the session id has characters outside [A-Za-z0-9-]" "S1/../S1"

# --- SessionEnd removes only its own pointer; PreCompact keeps it ----------------------------------
(cd "$P3" && env HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$P3" CLAUDE_CODE_SESSION_ID=S3 \
    "$SH" "$ROOT/hooks/oss-session-end.sh" >/dev/null 2>&1 <<< '{"session_id":"S3","hook_event_name":"PreCompact"}')
[[ -f "$SESS/S3/project" ]] && pass "PreCompact (same hook) keeps the session's pointer" || fail "PreCompact (same hook) keeps the session's pointer" "$(ls "$SESS" | tr '\n' ' ')"
(cd "$P3" && env HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$P3" CLAUDE_CODE_SESSION_ID=S3 \
    "$SH" "$ROOT/hooks/oss-session-end.sh" >/dev/null 2>&1 <<< '{"session_id":"S3","hook_event_name":"SessionEnd","reason":"exit"}')
[[ ! -e "$SESS/S3" && -f "$SESS/S1/project" && -f "$SESS/S2/project" && -f "$SESS/S4/project" ]] \
    && pass "SessionEnd removes S3's pointer only (S1, S2, S4 kept)" || fail "SessionEnd removes S3's pointer only (S1, S2, S4 kept)" "$(ls "$SESS" | tr '\n' ' ')"

# --- the stdin session_id, when it differs, gets a pointer too -----------------------------------
start_stdin() { (cd "$P4" && env HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$P4" CLAUDE_CODE_SESSION_ID=S4 \
    "$SH" "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 <<< "{\"session_id\":\"$1\",\"source\":\"clear\",\"hook_event_name\":\"SessionStart\"}"); }
start_stdin S4b
[[ "$(cat "$SESS/S4b/project" 2>/dev/null)" == "$P4" && "$(cat "$SESS/S4/project" 2>/dev/null)" == "$P4" ]] \
    && pass "SessionStart also writes the pointer under a different stdin session_id" || fail "SessionStart also writes the pointer under a different stdin session_id" "$(ls "$SESS" | tr '\n' ' ')"
start_stdin '../../evil'
[[ ! -e "$H/evil" && ! -e "$H/.oss/evil" && ! -e "$T/evil" ]] && pass "an invalid stdin session_id writes nothing" || fail "an invalid stdin session_id writes nothing" "$(ls "$H" "$H/.oss" | tr '\n' ' ')"

# --- prune: older than 30 days goes, younger stays, the current one never -----------------------
age() { touch -t "$(date -v-"$2"d +%Y%m%d%H%M 2>/dev/null || date -d "-$2 days" +%Y%m%d%H%M)" "$SESS/$1/project"; }
for id in OLD31 YNG29; do mkdir -m 700 "$SESS/$id"; printf '%s\n' "$P1" > "$SESS/$id/project"; chmod 600 "$SESS/$id/project"; done
age OLD31 31; age YNG29 29; age S1 40
(cd "$P1" && env HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$P1" CLAUDE_CODE_SESSION_ID=S1 \
    "$SH" "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 <<< '{"session_id":"S1","source":"resume","hook_event_name":"SessionStart"}')
[[ ! -e "$SESS/OLD31" ]] && pass "a 31-day-old pointer is pruned" || fail "a 31-day-old pointer is pruned" "$(ls "$SESS" | tr '\n' ' ')"
[[ -f "$SESS/YNG29/project" ]] && pass "a 29-day-old pointer is kept" || fail "a 29-day-old pointer is kept" "$(ls "$SESS" | tr '\n' ' ')"
[[ -f "$SESS/S1/project" && -n "$(find "$SESS/S1/project" -mmin -5)" ]] && pass "the starting session's own (40-day-old) pointer is rewritten, not pruned" || fail "the starting session's own (40-day-old) pointer is rewritten, not pruned" "$(ls -la "$SESS/S1" 2>&1 | tr '\n' ' ')"

# --- a linked ~/.oss/sessions is refused by the writer ---------------------------------------------
H3="$T/home3"; mkdir -p "$H3/.oss" "$T/elsewhere"; ln -s "$T/elsewhere" "$H3/.oss/sessions"
(cd "$P1" && env HOME="$H3" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$P1" CLAUDE_CODE_SESSION_ID=S1 \
    "$SH" "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 <<< '{"session_id":"S1"}')
[[ -z "$(ls -A "$T/elsewhere")" ]] && pass "the writer refuses a linked ~/.oss/sessions (nothing written through it)" || fail "the writer refuses a linked ~/.oss/sessions (nothing written through it)" "$(ls -A "$T/elsewhere")"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
