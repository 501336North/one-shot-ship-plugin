#!/bin/bash
# /oss:login follows the OSS config the hooks use, and sends the key only to the API that config names.
#
# @behavior A user with OSS_CONFIG_DIR set logs in with --key: the cached credentials removed are the ones
#           in $OSS_CONFIG_DIR (where oss-decrypt keeps them), and the success message names
#           $OSS_CONFIG_DIR/config.json, the file the key was saved to. Without it, both are under ~/.oss.
# @behavior On a full login the CLAUDE.md template comes from the configured API through one fixed hook
#           command; when it fails, login skips the merge and tells the user.
# @business-rule No step of login.md sends the key to a hardcoded host (T33, security F8, CR3, CR4).
# @boundary The login.md shell blocks are run exactly as written, with a sandbox HOME and the real
#           hooks copied into it. No network, never the real ~/.oss.
#
# Usage: ./commands/__tests__/login-config-dir.test.sh
set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$C/.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
# A developer's exported overrides must not lead the blocks to the real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT

# fence_with <literal>: the body of the first fenced block in login.md holding <literal>, less the indent
# of its opening fence (a block inside a list item). Same reader as value-file-wrappers-run.test.sh.
fence_with() {
    awk -v lit="$1" '
        /^[[:space:]]*```/ { if (!inf) { inf = 1; n = 0; hit = 0; match($0, /^[[:space:]]*/); ind = RLENGTH; next } inf = 0; if (hit) { for (i = 1; i <= n; i++) print b[i]; exit } next }
        inf { l = $0; if (substr(l, 1, ind) ~ /^[[:space:]]*$/) l = substr(l, ind + 1); b[++n] = l; if (index($0, lit)) hit = 1 }' "$C/login.md"
}
N=0
sandbox() {
    N=$((N + 1)); H="$T/h$N"; CFG="$T/cfg$N"; mkdir -p "$H/.oss/hooks" "$CFG"
    cp "$ROOT/hooks/oss-api-curl.sh" "$H/.oss/hooks/"
}
# run_block <literal> [VAR=value...]: run that login.md block as written -> OUT, RC
run_block() {
    local lit="$1" b; shift; b=$(fence_with "$lit")
    [[ -n "$b" ]] || { OUT="(no block holding '$lit' in login.md)"; RC=99; return; }
    OUT=$(cd "$T" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="$H" "$@" "$SH" -c "$b" 2>&1 </dev/null); RC=$?
}

# --- --key step 3: the cached credentials removed are the ones oss-decrypt uses ------------------
CREDS='credentials.enc'
sandbox; : > "$H/.oss/credentials.enc"; : > "$CFG/credentials.enc"
run_block "$CREDS" OSS_CONFIG_DIR="$CFG"
[[ "$RC" == 0 && ! -e "$CFG/credentials.enc" && -e "$H/.oss/credentials.enc" ]] \
    && pass "with OSS_CONFIG_DIR: --key clears \$OSS_CONFIG_DIR/credentials.enc and leaves ~/.oss alone" \
    || fail "with OSS_CONFIG_DIR: --key clears \$OSS_CONFIG_DIR/credentials.enc" "rc=$RC out=$OUT cfg=$(ls -A "$CFG") home=$(ls -A "$H/.oss")"
sandbox; : > "$H/.oss/credentials.enc"
run_block "$CREDS"
[[ "$RC" == 0 && ! -e "$H/.oss/credentials.enc" ]] \
    && pass "without OSS_CONFIG_DIR: --key clears ~/.oss/credentials.enc" || fail "without OSS_CONFIG_DIR: --key clears ~/.oss/credentials.enc" "rc=$RC out=$OUT home=$(ls -A "$H/.oss")"

# --- --key step 5: the success message names the file the key was saved to -----------------------
sandbox; run_block 'API key updated successfully' OSS_CONFIG_DIR="$CFG"
[[ "$RC" == 0 && "$OUT" == *"Config: $CFG/config.json"* ]] \
    && pass "with OSS_CONFIG_DIR: the success message names \$OSS_CONFIG_DIR/config.json" || fail "with OSS_CONFIG_DIR: the success message names \$OSS_CONFIG_DIR/config.json" "rc=$RC out=$OUT"
sandbox; run_block 'API key updated successfully'
[[ "$RC" == 0 && "$OUT" == *"Config: $H/.oss/config.json"* ]] \
    && pass "without OSS_CONFIG_DIR: the success message names ~/.oss/config.json" || fail "without OSS_CONFIG_DIR: the success message names ~/.oss/config.json" "rc=$RC out=$OUT"

# --- Step 4.2: the template comes through the hook, never from a hardcoded host -----------------
STEP42=$(awk '/^### 4\.2/ { f = 1; next } /^### / && f { exit } f' "$C/login.md")
[[ "$(fence_with 'oss-claude-md-template.sh')" == '~/.oss/hooks/oss-claude-md-template.sh' && "$STEP42" == *'~/.oss/hooks/oss-claude-md-template.sh'* ]] \
    && pass "Step 4.2 fetches the template with the one fixed command ~/.oss/hooks/oss-claude-md-template.sh" || fail "Step 4.2 runs ~/.oss/hooks/oss-claude-md-template.sh" "step=$STEP42"
[[ "$STEP42" == *'non-zero'* && "$STEP42" == *'skip 4.3'* ]] \
    && pass "Step 4.2 says: on a non-zero exit, skip 4.3 and tell the user" || fail "Step 4.2 says what to do on a non-zero exit" "step=$STEP42"
H_REQ=$(grep -nE '(GET|POST)[[:space:]]+https?://|Authorization: Bearer' "$C/login.md")
[[ -z "$H_REQ" ]] && pass "login.md tells the model to send no request (and no key) to any host itself" || fail "login.md sends no request to a host itself" "$H_REQ"

echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
