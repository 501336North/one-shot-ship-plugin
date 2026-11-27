#!/bin/bash
# A ship re-run's gate lines after the archive commit go to the archived folder (complete-gaps Task 2b, D7).
#
# @behavior After /oss:ship's archive commit moved .oss/dev/active/<f>/ to .oss/dev/completed/<f>-<date>/, a fix round and
#           a ship re-run on the same branch record their gate rounds with `oss-value.sh timeline gate`. Each line lands
#           in that archived folder's timeline.ndjson with feature "<f>", so assemble ship finds the rounds. The folder
#           is the one the D84 lookup picks (the phase-result CLI): the single completed folder of this branch's feature
#           that this branch added. Zero such folders, two or more, or only another feature's folder: the line stays in
#           .oss/dev/timeline-unfiled.ndjson, as before. A linked timeline file or someone else's folder is never
#           written through: the line stays unfiled.
# @business-rule D7 (widens D2): only this branch's single archived folder for this feature, the D84 rules, fail closed.
# Usage: /bin/bash hooks/__tests__/timeline-gate-archived.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-gate-archived tests..."

R=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$R"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 CLAUDE_CODE_SESSION_ID=gate-archived-1
mkdir "$R/node-only"; ln -s "$(node -p 'require("fs").realpathSync(process.execPath)')" "$R/node-only/node"
# a curl that never reaches the network (the detached push stops at "no key" anyway)
mkdir "$R/bin"; printf '#!/bin/sh\nexit 7\n' > "$R/bin/curl"; chmod +x "$R/bin/curl"
DAY=2026-11-23

# fresh: a temp HOME whose plugin root holds the real bundled phase-result CLI, and a repo on feat/demo/build branched
# from main (origin/main at main's tip) with an active demo folder -> T, P, UNF
fresh() {
    T=$(cd "$(mktemp -d "$R/case.XXXXXX")" && pwd -P)
    mkdir -p "$T/home/.oss/hooks" "$T/plugin/watcher/dist/cli"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    ln -s "$ROOT/watcher/dist/cli/phase-result.cjs" "$T/plugin/watcher/dist/cli/phase-result.cjs"
    printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"
    cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    P="$T/repo"; mkdir -p "$P"
    (cd "$P" && git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base \
        && git update-ref refs/remotes/origin/main main && git checkout -q -b feat/demo/build \
        && mkdir -p .oss/dev/active/demo && echo d > .oss/dev/active/demo/DESIGN.md && git add -A && git -c user.name=t -c user.email=t@t commit -q -m design)
    UNF="$P/.oss/dev/timeline-unfiled.ndjson"
    # the node SessionStart records in ~/.oss/node-path, as in a real session
    run /bin/bash "$ROOT/hooks/oss-node-path.sh" >/dev/null 2>&1
    [[ -s "$T/home/.oss/node-path" ]] || fail "setup" "no node recorded"
}
# archive <folder...>: the archive commit: the active folder is moved to the first folder, any other folder is added too
archive() {
    (cd "$P" && mkdir -p .oss/dev/completed && mv .oss/dev/active/demo ".oss/dev/completed/$1" && shift \
        && for f in "$@"; do mkdir -p ".oss/dev/completed/$f" && echo x > ".oss/dev/completed/$f/DESIGN.md"; done \
        && git add -A .oss && git -c user.name=t -c user.email=t@t commit -q -m 'docs: archive')
}
run() { (cd "$P" && HOME="$T/home" PATH="$R/bin:$R/node-only:/usr/bin:/bin:/usr/sbin:/sbin" CLAUDE_PLUGIN_ROOT="$T/plugin" \
    CLAUDE_PROJECT_DIR="$P" "$@" </dev/null); }
# gate: one passing round-1 code-review line through oss-value.sh timeline gate -> RC, ERR
gate() {
    local vd
    vd=$(run /bin/bash "$ROOT/hooks/oss-value.sh" dir 2>/dev/null)
    [[ -d "$vd" ]] || { RC=99; ERR="no value folder"; return; }
    printf '1\n' > "$vd/round.txt"; printf 'code-review\n' > "$vd/gate.txt"; printf 'pass\n' > "$vd/verdict.txt"
    : > "$vd/findings.txt"; : > "$vd/fixed.txt"; printf 'full\n' > "$vd/mode.txt"
    run /bin/bash "$ROOT/hooks/oss-value.sh" timeline gate >/dev/null 2>"$T/err"; RC=$?
    ERR=$(cat "$T/err")
}
gates_in() { [[ -f "$1" ]] && grep -c '"kind":"gate"' "$1" || echo 0; }
diag() { echo "rc=$RC unfiled=$(tail -n 1 "$UNF" 2>/dev/null) completed=$(cat "$P"/.oss/dev/completed/*/timeline.ndjson 2>/dev/null | head -c 400) err=$ERR"; }

name='should file a gate line written after the archive commit in the archived folder, with the feature'
fresh; archive "demo-$DAY"; gate
CTL="$P/.oss/dev/completed/demo-$DAY/timeline.ndjson"
if [[ $RC -eq 0 && "$(tail -n 1 "$CTL" 2>/dev/null | jq -r '[.kind, .feature, .gate] | join(" ")' 2>/dev/null)" == "gate demo code-review" \
    && "$(gates_in "$UNF")" -eq 0 ]]; then pass "$name"; else fail "$name" "$(diag)"; fi

name='should leave the gate line unfiled when this branch added no completed folder of its feature'
fresh; (cd "$P" && git checkout -q main && mkdir -p ".oss/dev/completed/demo-$DAY" && echo x > ".oss/dev/completed/demo-$DAY/DESIGN.md" \
    && git add -A .oss && git -c user.name=t -c user.email=t@t commit -q -m 'archive already on main' \
    && git update-ref refs/remotes/origin/main main && git checkout -q feat/demo/build \
    && git -c user.name=t -c user.email=t@t merge -q main -m 'merge main' \
    && git rm -rq .oss/dev/active/demo && git -c user.name=t -c user.email=t@t commit -q -m 'drop active') >/dev/null 2>&1
[[ -d "$P/.oss/dev/completed/demo-$DAY" && ! -e "$P/.oss/dev/active/demo" ]] || fail "$name" "setup: no folder from main"
gate
if [[ "$(gates_in "$UNF")" -eq 1 && "$(gates_in "$P/.oss/dev/completed/demo-$DAY/timeline.ndjson")" -eq 0 ]]; then pass "$name"; else fail "$name" "$(diag)"; fi

name='should leave the gate line unfiled when this branch added two completed folders of its feature'
fresh; archive "demo-$DAY" "demo-2026-11-22"; gate
if [[ "$(gates_in "$UNF")" -eq 1 && "$(cat "$P"/.oss/dev/completed/*/timeline.ndjson 2>/dev/null | grep -c gate)" -eq 0 ]]; then pass "$name"; else fail "$name" "$(diag)"; fi

name="should leave the gate line unfiled when the only added folder is another feature's"
fresh; (cd "$P" && mkdir -p .oss/dev/completed && mv .oss/dev/active/demo ".oss/dev/completed/other-$DAY" && git add -A .oss \
    && git -c user.name=t -c user.email=t@t commit -q -m archive); gate
if [[ "$(gates_in "$UNF")" -eq 1 && "$(gates_in "$P/.oss/dev/completed/other-$DAY/timeline.ndjson")" -eq 0 ]]; then pass "$name"; else fail "$name" "$(diag)"; fi

name='should never write through a linked timeline file in the archived folder'
fresh; archive "demo-$DAY"; : > "$T/outside.ndjson"; ln -s "$T/outside.ndjson" "$P/.oss/dev/completed/demo-$DAY/timeline.ndjson"; gate
if [[ ! -s "$T/outside.ndjson" && "$(gates_in "$UNF")" -eq 1 ]]; then pass "$name"; else fail "$name" "$(diag) outside=$(head -c 200 "$T/outside.ndjson")"; fi

name="should never file the gate line in someone else's archived folder"
fresh; archive "demo-$DAY"
# someone else's folder, through `test -O` (the repo's other-user seam), exported to the writer's own bash. oss-value.sh
# drops exported functions named like a builtin, so this case runs the writer's gate verb as oss-value.sh runs it.
(export OSS_T_FOREIGN="/.oss/dev/completed/demo-$DAY"
    # shellcheck disable=SC2329 # run by the writer's bash, through export -f
    test() { if [[ "${1:-}" == -O && "${2%/}" == *"$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
    export -f test
    run "$ROOT/hooks/oss-timeline.sh" gate 1 code-review pass "" "" full >/dev/null 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
if [[ "$(gates_in "$UNF")" -eq 1 && "$(gates_in "$P/.oss/dev/completed/demo-$DAY/timeline.ndjson")" -eq 0 ]]; then pass "$name"; else fail "$name" "$(diag)"; fi

echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
