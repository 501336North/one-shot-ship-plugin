#!/bin/bash
# The bash project-write guard (hooks/oss-safe-path.sh) itself, and how oss-log.sh uses it.
#
# @behavior A path the guard approves is exactly the path that gets written: no newline,
#           control character or traversal can make it approve one path and the caller write
#           another. oss-log.sh only builds `<name>.log` from a plain command name.
# @business-rule ADR-1 (oss-writer-nofollow) + ship round 1 findings G2-G14.
#
# Usage: ./hooks/__tests__/oss-safe-path.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-safe-path.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-safe-path tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-safe-path.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/proj/.oss" "$T/outside"
# guard <fn> <project> <rel>: run one guard function in a fresh shell; prints rc
guard() { HOME="$T/home" "$SH" -c 'source "$1"; "$2" "$3" "$4"; echo $?' _ "$ROOT/hooks/oss-safe-path.sh" "$@" 2>/dev/null; }

# --- G2: newline / control characters -------------------------------------------------------
rc=$(guard oss_safe_target "$T/proj" $'.oss/ok.log\n/../../outside/x')
[[ "$rc" == 1 ]] && pass "G2: a rel with a newline is refused (target)" || fail "G2: a rel with a newline is refused (target)" "rc=$rc"
rc=$(guard oss_safe_mkdir "$T/proj" $'.oss/a\n/../../outside')
[[ "$rc" == 1 ]] && pass "G2: a rel with a newline is refused (mkdir)" || fail "G2: a rel with a newline is refused (mkdir)" "rc=$rc"
rc=$(guard oss_safe_target "$T/proj" $'.oss/tab\there.log')
[[ "$rc" == 1 ]] && pass "G2: a rel with a control character is refused" || fail "G2: a rel with a control character is refused" "rc=$rc"
rc=$(guard oss_safe_target "$T/proj" '.oss/logs/current-session/build.log')
[[ "$rc" == 0 ]] && pass "G2 control: an ordinary rel is approved" || fail "G2 control: an ordinary rel is approved" "rc=$rc"
[[ ! -e "$T/outside/x" && -z "$(ls -A "$T/outside")" ]] && pass "G2: nothing created outside" || fail "G2: nothing created outside" "$(ls -A "$T/outside")"

# --- G2 (IRON LAW #1b): oss-log.sh builds <name>.log only from a plain command name ----------
i=0
for bad in 'a/b' $'x\ny' 'Build' '../up'; do
    i=$((i + 1)); mkdir -p "$T/p2-$i"
    out=$(cd "$T/p2-$i" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/p2-$i" "$SH" "$ROOT/hooks/oss-log.sh" write "$bad" "msg" 2>&1 </dev/null); rc=$?
    created=$(cd "$T/p2-$i" && find .oss -mindepth 3 2>/dev/null | grep -v '/archive$' | grep -v 'session.log$' | tr '\n' ' ')
    if [[ $rc -eq 0 && -z "$created" ]]; then pass "G2: oss-log.sh write refuses command name $(printf %q "$bad")"
    else fail "G2: oss-log.sh write refuses command name $(printf %q "$bad")" "rc=$rc created=[$created] out=$out"; fi
done
mkdir -p "$T/p2"
(cd "$T/p2" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/p2" "$SH" "$ROOT/hooks/oss-log.sh" write custom-cmd2 "hello" >/dev/null 2>&1 </dev/null)
grep -q hello "$T/p2/.oss/logs/current-session/custom-cmd2.log" 2>/dev/null && pass "G2 control: a plain command name still logs" || fail "G2 control: a plain command name still logs" "missing"

# --- G3: a component owned by the PROJECT ROOT's owner is accepted (bind mounts, root in a
#     container, shared repos). Root-free fixture: project "/" (owned by root) and the
#     root-owned system tmp directory as the components; the leaf dir is created by us.
if [[ -d /private/tmp && ! -L /private/tmp ]]; then sysrel=private/tmp; else sysrel=tmp; fi
leaf="oss-g3.$$"
rc=$(guard oss_safe_target / "$sysrel/$leaf/probe.json")
if [[ "$rc" == 0 && -d "/$sysrel/$leaf" ]]; then pass "G3: components owned by the project root's owner are accepted"
else fail "G3: components owned by the project root's owner are accepted" "rc=$rc"; fi
rmdir "/$sysrel/$leaf" 2>/dev/null

# --- G4: sourced from a non-bash shell (zsh) the guard fails CLOSED -----------------------------
if command -v zsh >/dev/null 2>&1; then
    mkdir -p "$T/p4"; ln -s "$T/outside" "$T/p4/.oss"
    rc=$(HOME="$T/home" zsh -f -c 'source "$1" 2>/dev/null; oss_safe_target "$2" .oss/x.log 2>/dev/null; echo $?' _ "$ROOT/hooks/oss-safe-path.sh" "$T/p4")
    [[ "$rc" != 0 ]] && pass "G4: under zsh a linked .oss is still refused (fail closed)" || fail "G4: under zsh a linked .oss is still refused (fail closed)" "rc=$rc"
fi

# --- G5: project == $HOME is the user's own dir: a dotfiles symlink there is accepted (as Node)
mkdir -p "$T/home/.claude" "$T/dotfiles"; echo '{}' > "$T/dotfiles/settings.local.json"
ln -s "$T/dotfiles/settings.local.json" "$T/home/.claude/settings.local.json"
rc=$(guard oss_safe_target "$T/home" .claude/settings.local.json)
[[ "$rc" == 0 ]] && pass "G5: HOME-launched session keeps a symlinked ~/.claude/settings.local.json" || fail "G5: HOME-launched session keeps a symlinked ~/.claude/settings.local.json" "rc=$rc"

# --- G8: read-only oss-log.sh actions create nothing in the project ---------------------------
for act in read path list status session-path; do
    mkdir -p "$T/p8-$act"
    (cd "$T/p8-$act" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/p8-$act" "$SH" "$ROOT/hooks/oss-log.sh" "$act" build >/dev/null 2>&1 </dev/null)
    [[ ! -e "$T/p8-$act/.oss" ]] && pass "G8: oss-log.sh $act creates no .oss" || fail "G8: oss-log.sh $act creates no .oss" "$(cd "$T/p8-$act" && find .oss | tr '\n' ' ')"
done

# --- G14: archive cleanup survives names with whitespace (no stray rm in the cwd) -------------
mkdir -p "$T/p14/.oss/logs/archive" "$T/p14/cwd"; echo keep > "$T/p14/cwd/b.log.gz"
# six newer archives (future mtime, so the age sweep leaves them) + the oldest one with a space
for i in 1 2 3 4 5 6; do echo x > "$T/p14/.oss/logs/archive/session-$i.log.gz"; touch -t 20300101000$i "$T/p14/.oss/logs/archive/session-$i.log.gz"; done
echo x > "$T/p14/.oss/logs/archive/session-a b.log.gz"
(cd "$T/p14/cwd" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/p14" "$SH" "$ROOT/hooks/oss-log.sh" clean >/dev/null 2>&1 </dev/null)
if [[ -f "$T/p14/cwd/b.log.gz" && ! -e "$T/p14/.oss/logs/archive/session-a b.log.gz" ]]; then pass "G14: whitespace archive name is deleted itself, nothing else"
else fail "G14: whitespace archive name is deleted itself, nothing else" "cwd=$(ls "$T/p14/cwd") archive=$(ls "$T/p14/.oss/logs/archive" | tr '\n' '|')"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
