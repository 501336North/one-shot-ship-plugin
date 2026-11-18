#!/bin/bash
# The IRON LAWS and the CLAUDE.md template are written only after `oss-decrypt --verify-body` passes (R-273 P5), so
# every doc that installs or refreshes them must install (or upgrade) oss-decrypt first.
#
# @behavior A user logs in for the first time on a machine with no oss-decrypt (or the old 1.2.4 one, which has no
#           --verify-body): when /oss:login ends, the project's CLAUDE.md holds the IRON LAWS block.
# @business-rule ensure-decrypt-cli.sh runs before oss-iron-laws-sync.sh and oss-claude-md-template.sh in every doc
#           that runs both (login, the ideate skill, /oss:ideate, /oss:auto); login never skips the install because
#           some oss-decrypt is already there (R-273 plan gate round 2, code-review HIGH).
# @boundary The login.md blocks run as written, in the order login.md lists them, with a sandbox HOME holding the
#           real hooks, except ensure-decrypt-cli.sh: a stub that installs an oss-decrypt stub which really hashes
#           stdin against the fixture servedHash (hooks/__tests__/lib/verify-body-stub.sh). curl is a stub that
#           serves the laws. No network, never the real ~/.oss.
#
# Usage: ./commands/__tests__/decrypt-before-laws.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$C/.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# --- static: the install comes first in each doc that runs both ------------------------------------
# first_line <file> <ERE>: the line number of the first line matching, or 0
first_line() { awk -v re="$2" '$0 ~ re { print NR; f = 1; exit } END { if (!f) print 0 }' "$1"; }
ENSURE='~/\.oss/hooks/ensure-decrypt-cli\.sh --long-step'
for doc in commands/login.md skills/ideate.md commands/ideate.md commands/auto.md; do
    f="$ROOT/$doc"
    e=$(first_line "$f" "$ENSURE")
    s=$(first_line "$f" '~/\.oss/hooks/oss-iron-laws-sync\.sh')
    t=$(first_line "$f" '~/\.oss/hooks/oss-claude-md-template\.sh')
    bad=""
    (( e > 0 )) || bad+="no ensure-decrypt-cli.sh --long-step; "
    (( s > 0 && s < e )) && bad+="oss-iron-laws-sync.sh (line $s) before ensure-decrypt-cli.sh (line $e); "
    (( t > 0 && t < e )) && bad+="oss-claude-md-template.sh (line $t) before ensure-decrypt-cli.sh (line $e); "
    [[ -z "$bad" ]] && pass "$doc installs oss-decrypt before it syncs the IRON LAWS or fetches the template" \
        || fail "$doc installs oss-decrypt before the IRON LAWS / template" "$bad"
done

# An installed 1.2.4 has no --verify-body: login must not skip the install step because a CLI is there.
SKIP=$(grep -nE 'Skip this step.*CLI is already installed' "$C/login.md")
[[ -z "$SKIP" ]] && pass "login.md never skips the oss-decrypt install because a CLI is already installed" \
    || fail "login.md never skips the oss-decrypt install because a CLI is already installed" "$SKIP"

# --- behaviour: a first login ends with the IRON LAWS block in CLAUDE.md --------------------------
source "$ROOT/hooks/__tests__/lib/verify-body-stub.sh"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT

# fence_with <literal>: "<line> <body>" of the first fenced block in login.md holding <literal> (body de-indented,
# newlines kept). Same reader as login-config-dir.test.sh, plus the line of the opening fence.
fence_line() {
    awk -v lit="$1" '/^[[:space:]]*```/ { if (!inf) { inf = 1; start = NR; next } inf = 0; next } inf && index($0, lit) { print start; exit }' "$C/login.md"
}
fence_with() {
    awk -v lit="$1" '
        /^[[:space:]]*```/ { if (!inf) { inf = 1; n = 0; hit = 0; match($0, /^[[:space:]]*/); ind = RLENGTH; next } inf = 0; if (hit) { for (i = 1; i <= n; i++) print b[i]; exit } next }
        inf { l = $0; if (substr(l, 1, ind) ~ /^[[:space:]]*$/) l = substr(l, ind + 1); b[++n] = l; if (index($0, lit)) hit = 1 }' "$C/login.md"
}

# first_login <label> <old|none>: a sandbox HOME with the real hooks and a stub ensure-decrypt-cli.sh; runs the
# install block and the --install block of login.md in the order login.md lists them; checks CLAUDE.md.
first_login() {
    local label="$1" had="$2" H="$T/$1/home" P="$T/$1/proj" M="$T/$1/mock" b out rc lit
    mkdir -p "$H/.oss/hooks" "$H/.oss/bin" "$P" "$M"
    cp "$ROOT"/hooks/*.sh "$H/.oss/hooks/"
    printf '{"apiKey": "sk-test-%s-%s"}\n' "$label" "$RANDOM" > "$H/.oss/config.json"
    { echo '# IRON LAWS'; echo; echo '## LAW 1: TDD'
      for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "IRON LAW padding line $i: a real laws body is several KB, the sync rejects anything under 500 bytes."; done
    } > "$M/laws"
    jq -n --rawfile b "$M/laws" '{base: $b}' > "$M/reply.json"
    served_hash "$M" shared/iron-laws "$M/laws"
    printf '#!/bin/bash\ncat %q\nprintf %q\n' "$M/reply.json" '\n200\n' > "$M/curl"; chmod +x "$M/curl"
    # The verifying oss-decrypt the stub installer puts in place (the pinned one has --verify-body).
    verify_body_stub "$M/oss-decrypt.pinned" "$M"
    [[ "$had" == old ]] && old_decrypt_stub "$H/.oss/bin/oss-decrypt" "$M"
    printf '#!/bin/bash\ncp %q "$HOME/.oss/bin/oss-decrypt" && chmod 0755 "$HOME/.oss/bin/oss-decrypt"\n' "$M/oss-decrypt.pinned" \
        > "$H/.oss/hooks/ensure-decrypt-cli.sh"
    chmod +x "$H/.oss/hooks/ensure-decrypt-cli.sh"
    out=""
    for lit in $( { echo "$(fence_line 'ensure-decrypt-cli.sh --long-step') ensure-decrypt-cli.sh"
                    echo "$(fence_line 'oss-iron-laws-sync.sh --install') oss-iron-laws-sync.sh"; } | sort -n | cut -d' ' -f2); do
        b=$(fence_with "$lit")
        [[ -n "$b" ]] || { fail "$label: login.md has a block running $lit" "none"; return; }
        out+=$(cd "$P" && env -u CLAUDE_PLUGIN_ROOT HOME="$H" CLAUDE_PROJECT_DIR="$P" PATH="$M:$PATH" "$SH" -c "$b" 2>&1 </dev/null)$'\n'
    done
    if [[ -f "$P/CLAUDE.md" ]] && grep -q '^<!-- IRON LAWS START' "$P/CLAUDE.md" && grep -q '^## LAW 1: TDD' "$P/CLAUDE.md"; then
        pass "a first login on a machine with $( [[ $had == old ]] && echo 'oss-decrypt 1.2.4' || echo 'no oss-decrypt') ends with the IRON LAWS block in CLAUDE.md"
    else
        fail "a first login ($label) ends with the IRON LAWS block in CLAUDE.md" "CLAUDE.md: $(cat "$P/CLAUDE.md" 2>/dev/null | head -3 | tr '\n' '|') out: $out"
    fi
}
first_login fresh none
first_login upgrade old

echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
