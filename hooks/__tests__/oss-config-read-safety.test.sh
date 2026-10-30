#!/bin/bash
# The OSS config is opened only when it is a regular file (T35).
#
# @behavior oss_api_key and oss_api_url (hooks/oss-api-curl.sh), and the hooks that read the config through
#           them (oss-fetch-team-iron-laws.sh, oss-claude-md-template.sh), with jq and without it (node):
#           - a config.json that is a FIFO is never opened (no hang): no key, no URL, the default team laws;
#           - a config.json that is a symlink to /dev/zero is never read (no hang): no key, no URL;
#           - a config.json that is a directory: no key, no URL;
#           - a config.json that is a symlink to a regular config (dotfile setups) still works.
# @business-rule A hook that reads the config never hangs the session on a file that is not a regular file,
#           and the key is only ever read from a real config file.
# @boundary oss-api-curl.sh helpers and the hooks that read the config (system boundary); curl is faked.
#
# Usage:   /bin/bash hooks/__tests__/oss-config-read-safety.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}"
source "$SCRIPT_DIR/lib/warm-stub.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-config-read-safety tests..."
command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is needed for the jq branch"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ FAIL: node is needed for the no-jq branch"; exit 1; }

KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
WRITER=""
trap '[[ -n "$WRITER" ]] && kill "$WRITER" 2>/dev/null; rm -rf "$KS"' EXIT

# A symlink farm of every command on the real PATH except jq: node reads the config there.
mkdir -p "$KS/nojq"
OLDIFS=$IFS; IFS=:
for d in $PATH; do
    [[ -d "$d" ]] || continue
    for f in "$d"/*; do
        b=${f##*/}
        [[ "$b" != jq && -x "$f" && ! -e "$KS/nojq/$b" ]] && ln -s "$f" "$KS/nojq/$b" 2>/dev/null
    done
done
IFS=$OLDIFS
PATH="$KS/nojq" command -v jq >/dev/null 2>&1 && { echo "✗ FAIL: could not hide jq"; exit 1; }
PATH="$KS/nojq" command -v node >/dev/null 2>&1 || { echo "✗ FAIL: node missing from the no-jq PATH"; exit 1; }
mode_path() { case "$1" in (jq) printf '%s' "$KS/bin:$PATH" ;; (*) printf '%s' "$KS/bin:$KS/nojq" ;; esac; }

# A recording curl, warmed once: argv and the --config - stdin, where the Authorization header travels.
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
printf '%s\n' "$*" >> "$SHIM/argv"
prev=""; for a in "$@"; do [[ "$prev" == --config && "$a" == - ]] && cat >> "$SHIM/stdin"; prev="$a"; done
printf '{"law1_tdd":{"enabled":true,"locked":true},"from":"stub"}\n200'
EOF
)" || { echo "✗ FAIL: curl stub warm-up did not run"; exit 1; }

URL="https://dev.example.com"
VALID='{"apiKey":"fake-key-S","apiUrl":"https://dev.example.com"}'

# make_config <kind> <path> : puts a config of that kind at <path>.
#   fifo: a FIFO with a writer waiting on it the whole run (WRITER). A read that opened it would get EOF (no
#         hang) and end the writer, which is how a case sees it: the writer still waiting = never opened.
make_config() {
    WRITER=""
    case "$1" in
        (fifo) mkfifo "$2"; ( exec 4>"$2" ) </dev/null >/dev/null 2>&1 & WRITER=$! ;;
        (devzero) ln -s /dev/zero "$2" ;;
        (dir) mkdir "$2" ;;
        (symlink-valid) printf '%s' "$VALID" > "$2.real"; ln -s "$2.real" "$2" ;;
    esac
}
# check_opened <kind> : sets OPENED=y when a FIFO config was opened (its writer is gone); ends the writer.
check_opened() {
    OPENED=n
    [[ "$1" == fifo ]] || return 0
    kill -0 "$WRITER" 2>/dev/null || OPENED=y
    kill "$WRITER" 2>/dev/null; wait "$WRITER" 2>/dev/null
    WRITER=""
}

# The alarm only stops a run that hangs (a reader stuck on /dev/zero); every assertion is on output and status,
# and a run the alarm stops has status 142, never the 1 a refusal gives. The run gets its own process group and
# the alarm kills that whole group: killing only the hook's shell left its jq/node child reading /dev/zero
# forever (orphans that grew without bound across runs).
capped() {
    perl -e '$p = fork; die unless defined $p;
        if (!$p) { setpgrp(0, 0); exec @ARGV or exit 127 }
        $SIG{ALRM} = sub { kill "KILL", -$p; waitpid($p, 0); exit 142 }; alarm 20;
        waitpid($p, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$@"
}

# helper <mode> <kind> <function> : runs the function from oss-api-curl.sh; sets OUT, RC and OPENED.
helper() {
    local T; T=$(mktemp -d "$KS/h.XXXXXX"); mkdir -p "$T/.oss"
    make_config "$2" "$T/.oss/config.json"
    RC=0
    OUT=$(HOME="$T" PATH="$(mode_path "$1")" capped /bin/bash -c 'source "$1"; '"$3" _ "$HOOKS/oss-api-curl.sh" </dev/null 2>/dev/null) || RC=$?
    check_opened "$2"
}

# hook <mode> <kind> <name> : runs one hook as its caller does; sets OUT, RC, OPENED and SENT (y when a request
# carried the key).
hook() {
    SHIM=$(mktemp -d "$KS/s.XXXXXX"); mkdir -p "$SHIM/home/.oss"
    make_config "$2" "$SHIM/home/.oss/config.json"
    local -a cmd
    case "$3" in
        (team-iron-laws) cmd=(/bin/bash "$HOOKS/oss-fetch-team-iron-laws.sh" --force) ;;
        (claude-md-template) cmd=(/bin/bash "$HOOKS/oss-claude-md-template.sh") ;;
    esac
    RC=0
    OUT=$(cd "$SHIM" && SHIM="$SHIM" HOME="$SHIM/home" PATH="$(mode_path "$1")" capped "${cmd[@]}" </dev/null 2>/dev/null) || RC=$?
    check_opened "$2"
    SENT=n; grep -q 'Bearer fake-key-S' "$SHIM/stdin" 2>/dev/null && SENT=y
}
is_default() { [[ "$OUT" == *'"law6_dev_docs"'* && "$OUT" != *stub* ]]; }

for MODE in jq nojq; do
    # --- the helpers: a FIFO, /dev/zero or a directory gives no key and no URL, and is never opened --------
    for KIND in fifo devzero dir; do
        for FN in oss_api_key oss_api_url; do
            name="[$MODE] $FN: a config.json that is a $KIND is refused without opening it"
            helper "$MODE" "$KIND" "$FN"
            if [[ $RC == 1 && -z "$OUT" && $OPENED == n ]]; then pass "$name"
            else fail "$name" "rc=$RC opened=$OPENED out=$(printf '%q' "${OUT:0:200}")"; fi
        done
    done
    # --- the helpers: a symlink to a regular config (dotfile setups) still works ---------------------------
    helper "$MODE" symlink-valid oss_api_key
    if [[ $RC == 0 && "$OUT" == fake-key-S ]]; then pass "[$MODE] oss_api_key: a symlink to a regular config gives its key"
    else fail "[$MODE] oss_api_key: a symlink to a regular config gives its key" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    helper "$MODE" symlink-valid oss_api_url
    if [[ $RC == 0 && "$OUT" == "$URL" ]]; then pass "[$MODE] oss_api_url: a symlink to a regular config gives its URL"
    else fail "[$MODE] oss_api_url: a symlink to a regular config gives its URL" "rc=$RC out=$(printf '%q' "$OUT")"; fi

    # --- the per-prompt team-laws hook --------------------------------------------------------------------
    for KIND in fifo devzero dir; do
        name="[$MODE] team-iron-laws: a config.json that is a $KIND is never opened; default laws, no request"
        hook "$MODE" "$KIND" team-iron-laws
        if [[ $RC == 0 && $OPENED == n && $SENT == n ]] && is_default; then pass "$name"
        else fail "$name" "rc=$RC opened=$OPENED sent=$SENT out=$(printf '%q' "${OUT:0:200}")"; fi
    done
    hook "$MODE" symlink-valid team-iron-laws
    if [[ $RC == 0 && $SENT == y && "$OUT" == *'"from":"stub"'* ]] && grep -q "$URL/api/v1/iron-laws/defaults" "$SHIM/argv"; then
        pass "[$MODE] team-iron-laws: a symlink to a regular config sends its key to its apiUrl"
    else fail "[$MODE] team-iron-laws: a symlink to a regular config sends its key to its apiUrl" "rc=$RC sent=$SENT out=$(printf '%q' "${OUT:0:200}")"; fi

    # --- the template hook (/oss:login Step 4.2): refuses, never hangs ------------------------------------
    for KIND in fifo devzero; do
        name="[$MODE] claude-md-template: a config.json that is a $KIND is never opened; exit 1, no request"
        hook "$MODE" "$KIND" claude-md-template
        if [[ $RC == 1 && $OPENED == n && $SENT == n && -z "$OUT" ]]; then pass "$name"
        else fail "$name" "rc=$RC opened=$OPENED sent=$SENT out=$(printf '%q' "${OUT:0:200}")"; fi
    done
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
