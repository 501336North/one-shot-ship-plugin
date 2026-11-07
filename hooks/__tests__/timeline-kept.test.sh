#!/bin/bash
# A feature's timeline is never removed by the plugin (G2, B6).
#
# @behavior A feature's timeline.ndjson and the project's timeline-unfiled.ndjson stay exactly as they were
#           (same file, same bytes) when Claude removes a worktree (oss-worktree-remove.sh) and when the logs
#           are started, rotated or purged (oss-log.sh init, rotate, purge --force). No hook script contains a
#           command that removes, moves or truncates either file.
# @business-rule radical-observability G2 AC-G2-001.4: the timeline is committed history. Only the person
#           (or git) may delete it; nothing in the plugin deletes or rotates it. Log cleanup and worktree
#           cleanup keep their hands off it.
#
# The REAL hooks from this checkout (or HOOKS_UNDER_TEST, a mutant copy) run with a sandbox HOME whose OSS
# config points at a fake API (a `curl` first on PATH: hooks/__tests__/fake-oss-api.sh) and an obviously fake
# key, in a sandbox product repo.
# Usage: /bin/bash hooks/__tests__/timeline-kept.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/timeline-kept.test.sh  (mutant copies)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$ROOT/hooks}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-kept tests..."
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)

T=$(cd "$(mktemp -d /tmp/oss-timeline-kept.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR OSS_TL_SESSION CLAUDE_PLUGIN_ROOT CLAUDE_WORKTREE_PATH
export CLAUDE_CODE_SESSION_ID=tk-session-1
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api-fake"; fake_api_install "$API"
export PATH="$API/bin:$PATH"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' 'fake-oss-key-timeline-kept-0042' > "$HOME/.oss/config.json"

# a product repo on feat/demo/build, with both timeline files and the state the hooks do clean up
P="$T/product"
TL="$P/.oss/dev/active/demo/timeline.ndjson"
UNF="$P/.oss/dev/timeline-unfiled.ndjson"
make_repo() {
    rm -rf "$P"; mkdir -p "$P/.oss/dev/active/demo" "$P/.oss/logs" "$P/.oss/hooks"
    (cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
    printf '%s\n' '{"v":1,"id":"tl-kept-1","kind":"command","command":"build","status":"start"}' \
        '{"v":1,"id":"tl-kept-2","kind":"command","command":"build","status":"complete"}' > "$TL"
    printf '%s\n' '{"v":1,"id":"tl-kept-3","kind":"command","command":"plan","status":"start"}' > "$UNF"
    echo '{}' > "$P/.oss/workflow-state.json"
}
# snap: each timeline file's inode, size and hash ("missing" when gone): a file moved away and rewritten
# with the same bytes still counts as touched
snap() {
    local f
    for f in "$TL" "$UNF"; do
        if [[ -f "$f" ]]; then printf '%s %s %s\n' "$(ls -i "$f" | awk '{print $1}')" "$(wc -c < "$f" | tr -d ' ')" "$(shasum -a 256 < "$f" | cut -c1-64)"
        else echo missing; fi
    done
}

# --- worktree removal -----------------------------------------------------------------------------------------------
name='should leave timeline.ndjson and timeline-unfiled.ndjson untouched after oss-worktree-remove.sh'
make_repo; before=$(snap)
(cd "$T" && CLAUDE_WORKTREE_PATH="$P" run_capped 20 "$HOOKS/oss-worktree-remove.sh" </dev/null >/dev/null 2>"$T/err"); rc=$?
after=$(snap)
# the remover did run: the state it owns is gone
[[ $rc -eq 0 && "$after" == "$before" && ! -e "$P/.oss/workflow-state.json" && ! -e "$P/.oss/logs" ]] && pass "$name" \
    || fail "$name" "rc=$rc before=[$before] after=[$after] state-left=$([[ -e "$P/.oss/workflow-state.json" ]] && echo yes || echo no) err=$(head -c 300 "$T/err")"

# --- log init, rotate, purge ----------------------------------------------------------------------------------------
name='should leave both files untouched after oss-log.sh init, rotate and purge --force'
make_repo; before=$(snap); LOGS="$P/.oss/logs"
log() { (cd "$P" && CLAUDE_PROJECT_DIR="$P" run_capped 20 "$HOOKS/oss-log.sh" "$@" </dev/null >/dev/null 2>>"$T/err"); }
: > "$T/err"
log init build; r1=$?; s1=$(snap); inited=$([[ -f "$LOGS/current-session/build.log" ]] && echo yes || echo no)
log rotate; r2=$?; s2=$(snap); rotated=$(find "$LOGS/archive" -type f 2>/dev/null | wc -l | tr -d ' ')
# purge reads --force as its third word: the usage line's `oss-log.sh purge --force` only prints the warning
log purge build --force; r3=$?; s3=$(snap); left=$(find "$LOGS" -type f 2>/dev/null | wc -l | tr -d ' ')
# each step did its job (a log made, an archive made, every log gone) and the timeline is the same file throughout
[[ "$r1$r2$r3" == 000 && "$s1" == "$before" && "$s2" == "$before" && "$s3" == "$before" \
    && "$inited" == yes && "$rotated" -ge 1 && "$left" == 0 ]] && pass "$name" \
    || fail "$name" "rc=$r1$r2$r3 inited=$inited archives=$rotated logs-left=$left before=[$before] init=[$s1] rotate=[$s2] purge=[$s3] err=$(head -c 300 "$T/err")"

# --- the guard ------------------------------------------------------------------------------------------------------
# timeline_removals <dir>: "<file>:<line>: <text>" for every hook line (tests excluded, comments ignored) that
# removes, moves or truncates a protected timeline file. A protected path is one that names timeline.ndjson or
# timeline-unfiled.ndjson, or a variable assigned from such a path in the same file, directly or through
# another such variable (`rec=.../timeline.ndjson` then `file="$dir/${rec##*/}"`). A value computed by $(...)
# is not a path to the file (the outbox name is a hash of it), so it does not carry the protection: the
# outbox and the push's own temp folders are not timeline files.
timeline_removals() {
    local f
    find "$1" -path "$1/__tests__" -prune -o -type f -print | sort | while IFS= read -r f; do
        awk -v file="${f#"$1"/}" '
            function refs(s,   v) {
                if (s ~ /timeline(-unfiled)?\.ndjson/) return 1
                for (v in prot) if (s ~ ("[$][{]?" v "([^A-Za-z0-9_]|$)")) return 1
                return 0
            }
            { line[NR] = $0 }
            END {
                do {
                    grew = 0
                    for (i = 1; i <= NR; i++) {
                        s = line[i]; if (s ~ /^[ \t]*#/) continue
                        while (match(s, /(^|[ \t;&|(])(local |export |readonly |declare )?[A-Za-z_][A-Za-z0-9_]*=[^=]/)) {
                            a = substr(s, RSTART, RLENGTH - 1); s = substr(s, RSTART + RLENGTH - 1)
                            sub(/^[ \t;&|(]/, "", a); sub(/^(local|export|readonly|declare) /, "", a); sub(/=$/, "", a)
                            rhs = s; sub(/(;|&&|\|\|).*/, "", rhs)
                            if (!(a in prot) && rhs !~ /[$][(]|`/ && refs(rhs)) { prot[a] = 1; grew = 1 }
                        }
                    }
                } while (grew)
                for (i = 1; i <= NR; i++) {
                    s = line[i]; if (s ~ /^[ \t]*#/ || !refs(s)) continue
                    hit = s ~ /(^|[^A-Za-z0-9_.-])(rm|mv|unlink|truncate|shred|gzip)([^A-Za-z0-9_.-]|$)/ || s ~ /-delete([^A-Za-z0-9_-]|$)/ \
                        || s ~ /cp[ \t]+\/dev\/null/
                    # a truncating redirect (> or >|, never >>) onto a protected path
                    if (!hit && s ~ /(^|[^>])>[|]?[ \t]*["\047]?[^ \t;|&]*timeline(-unfiled)?\.ndjson/) hit = 1
                    for (v in prot) if (!hit && s ~ ("(^|[^>])>[|]?[ \t]*[\"\047]?[$][{]?" v "([^A-Za-z0-9_]|$)")) hit = 1
                    if (hit) print file ":" i ": " line[i]
                }
            }' "$f"
    done
}

name='should find no rm, mv or truncation of timeline files anywhere in hooks/'
hits=$(timeline_removals "$HOOKS")
[[ -d "$HOOKS" && -z "$hits" ]] && pass "$name" || fail "$name" "${hits:-no hooks folder at $HOOKS}"

echo "$RUN run, $FAILED failed"; [[ $FAILED -eq 0 ]]
