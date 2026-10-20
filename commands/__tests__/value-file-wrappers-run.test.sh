#!/bin/bash
# Runs wrapper shell blocks exactly as written, in a sandbox HOME (never the real ~/.oss).
#
# Usage: ./value-file-wrappers-run.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./value-file-wrappers-run.test.sh
#
# @behavior A user runs /oss:login --key, /oss:models set, /oss:workflows <name> or /oss:trust from
#           any folder, inside a git repository or not, and the command takes its value from the
#           value folder that `oss-value.sh dir` printed.
# @business-rule Ship round 4, R4-1: outside a git repository the value folder is the one per-user
#           folder ~/.oss/run/home (same checks), so these commands work there again.
#
# The model's part (run `dir`, Write the value file) is done here by the test; every shell block is
# taken from the wrapper by a literal line it contains and run unchanged. curl, node and oss-decrypt
# are stubs that record their arguments.

set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$C/.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
TESTS_RUN=0; TESTS_FAILED=0
pass() { echo "✓ PASS: $1"; TESTS_RUN=$((TESTS_RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; TESTS_RUN=$((TESTS_RUN + 1)); TESTS_FAILED=$((TESTS_FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-wrun.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

# fence_with <file> <literal>: the body of the first fenced block in commands/<file> holding <literal>
fence_with() {
    awk -v lit="$2" '
        /^[[:space:]]*```/ { if (!inf) { inf = 1; n = 0; hit = 0; next } inf = 0; if (hit) { for (i = 1; i <= n; i++) print b[i]; exit } next }
        inf { b[++n] = $0; if (index($0, lit)) hit = 1 }' "$C/$1"
}

# stubs: each records "<name> <args>" in $T/calls; curl prints $T/curl.out
mkdir -p "$T/bin"
for s in curl node; do
    printf '#!/bin/sh\necho "%s $*" >> "%s/calls"\n[ "%s" = curl ] && cat "%s/curl.out" 2>/dev/null\nexit 0\n' "$s" "$T" "$s" "$T" > "$T/bin/$s"
    chmod +x "$T/bin/$s"
done

N=0
# sandbox <cwd-kind>: fresh HOME with the real hooks, a cwd (norepo|repo) -> H, W
sandbox() {
    N=$((N + 1)); H="$T/h$N"; mkdir -p "$H/.oss/hooks" "$H/.oss/bin"
    cp "$ROOT/hooks/oss-value.sh" "$ROOT/hooks/oss-safe-path.sh" "$ROOT/hooks/oss-log.sh" "$ROOT/hooks/oss-notify.sh" "$H/.oss/hooks/"
    printf '#!/bin/sh\necho "oss-decrypt $*" >> "%s/calls"\n' "$T" > "$H/.oss/bin/oss-decrypt"; chmod +x "$H/.oss/bin/oss-decrypt"
    W="$T/w$N/cwd"; mkdir -p "$W"
    [[ "$1" == repo ]] && (cd "$W" && git init -q) >/dev/null 2>&1
    rm -f "$T/calls" "$T/curl.out"
}
# in_sandbox <cmd...>: run in the cwd with the sandbox HOME and the stubs first on PATH
in_sandbox() {
    (cd "$W" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w$N" HOME="$H" PATH="$T/bin:$PATH" "$@")
}
# model_writes <name> <value> [<name> <value>...]: what the model does: run dir once, then Write
# each <name>.txt in the folder it printed
model_writes() {
    local d; d=$(in_sandbox "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null) && [[ -n "$d" ]] || return 1
    while (( $# >= 2 )); do printf '%s\n' "$2" > "$d/$1.txt"; shift 2; done
}
# run_block <file> <literal>: run that wrapper block as written -> OUT, RC
run_block() {
    local b; b=$(fence_with "$1" "$2")
    [[ -n "$b" ]] || { OUT="(no block holding '$2' in $1)"; RC=99; return; }
    OUT=$(in_sandbox "$SH" -c "$b" 2>&1 </dev/null); RC=$?
}
calls() { cat "$T/calls" 2>/dev/null; }

# === R4-1: the value lines work from a folder that is in no git repository ===================
for kind in norepo repo; do
    sandbox "$kind"; printf '{"plan":"pro"}\n200\n' > "$T/curl.out"
    model_writes key ossk_test_key_123; run_block login.md 'read key)'
    [[ "$RC" == 0 && "$(jq -r .apiKey "$H/.oss/config.json" 2>/dev/null)" == ossk_test_key_123 && "$OUT" == *"Plan: pro"* ]] \
        && pass "$kind: /oss:login --key saves the key it read" || fail "$kind: /oss:login --key saves the key it read" "rc=$RC out=$OUT"

    sandbox "$kind"; model_writes prompt oss:code-reviewer model ollama/codellama; run_block models.md 'read prompt)'
    [[ "$RC" == 0 && "$(calls)" == *"models.js set agents oss:code-reviewer ollama/codellama"* ]] \
        && pass "$kind: /oss:models set passes the prompt and model it read" || fail "$kind: /oss:models set passes the prompt and model it read" "rc=$RC out=$OUT calls=$(calls)"

    sandbox "$kind"; model_writes workflow build; run_block workflows.md 'read workflow)'
    [[ "$RC" == 0 && "$OUT" == build ]] && pass "$kind: /oss:workflows <name> prints the name it read" || fail "$kind: /oss:workflows <name> prints the name it read" "rc=$RC out=$OUT"

    sandbox "$kind"; model_writes category commands name build; run_block trust.md 'read category)'
    [[ "$RC" == 0 && "$(calls)" == "oss-decrypt --type commands --name build" ]] \
        && pass "$kind: /oss:trust decrypts with the category and name it read" || fail "$kind: /oss:trust decrypts with the category and name it read" "rc=$RC out=$OUT calls=$(calls)"
done
# the wrappers no longer say the folder needs a git repository
for f in login.md models.md workflows.md trust.md; do
    grep -qiF 'inside a git repository' "$C/$f" && fail "$f does not say the value folder needs a git repository" "$(grep -niF 'inside a git repository' "$C/$f" | head -1)" \
        || pass "$f does not say the value folder needs a git repository"
done

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
