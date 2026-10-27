#!/bin/bash
# ensure-decrypt-cli.sh installs the decrypt CLI that matches the plugin's channel (ship round 1, FR1).
#
# @behavior A stable plugin (no pre-release part in its version) keeps the pinned stable CLI tag
#           (cli-decrypt-v1.2.4) exactly as before. A beta plugin (e.g. 2.1.0-beta.1) pins the beta CLI tag
#           (cli-decrypt-v1.3.0-beta.1, which carries the staging signing key) and its own committed checksum
#           file. A pre-release binary never satisfies a stable pin and a stable binary never satisfies a beta
#           pin, so switching channel always installs the right binary. The hook finds the plugin version beside
#           itself, or through ~/.oss/plugin-root when it runs from the ~/.oss/hooks copy.
# @business-rule Stable customers are unchanged; a beta machine gets the CLI that can verify STAGING prompts.
#
# Usage: ./hooks/__tests__/ensure-decrypt-channel.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
STABLE_TAG="cli-decrypt-v1.2.4"; BETA_TAG="cli-decrypt-v1.3.0-beta.1"

# run <plugin version> <installed binary version or ""> [copy]: runs the hook from a throwaway plugin tree (or, with
# "copy", from a ~/.oss/hooks copy whose ~/.oss/plugin-root names that tree). Sets RC, OUT and URLS (downloads asked).
run() {
    local t; t="$(mktemp -d)"; mkdir -p "$t/plugin/.claude-plugin" "$t/plugin/hooks" "$t/home/.oss/bin" "$t/mock"
    printf '{"name":"oss","version":"%s"}\n' "$1" > "$t/plugin/.claude-plugin/plugin.json"
    cp "$ROOT/hooks/ensure-decrypt-cli.sh" "$ROOT"/hooks/oss-decrypt-checksums*.txt "$t/plugin/hooks/"
    if [[ -n "$2" ]]; then
        printf '#!/bin/sh\n[ "$1" = --version ] && echo "oss-decrypt v%s"\nexit 0\n' "$2" > "$t/home/.oss/bin/oss-decrypt"
        chmod +x "$t/home/.oss/bin/oss-decrypt"
    fi
    printf '#!/bin/sh\nfor a in "$@"; do case "$a" in https://*) echo "$a" >> "%s/urls";; esac; done\nexit 22\n' "$t" > "$t/mock/curl"
    chmod +x "$t/mock/curl"; : > "$t/urls"
    local hook="$t/plugin/hooks/ensure-decrypt-cli.sh"
    if [[ "${3:-}" == copy ]]; then
        mkdir -p "$t/home/.oss/hooks"; cp "$hook" "$t/home/.oss/hooks/"; hook="$t/home/.oss/hooks/ensure-decrypt-cli.sh"
        printf '%s\n' "$t/plugin" > "$t/home/.oss/plugin-root"
    fi
    OUT=$(cd "$t" && env -u CLAUDE_PLUGIN_ROOT -u OSS_DECRYPT_TAG HOME="$t/home" PATH="$t/mock:$PATH" bash "$hook" 2>&1); RC=$?
    URLS=$(cat "$t/urls"); rm -rf "$t"
}

run 2.0.94 ""
[[ "$URLS" == *"/download/$STABLE_TAG/"* && "$URLS" != *"$BETA_TAG"* ]] && pass "stable plugin, no binary: downloads the stable tag $STABLE_TAG (unchanged)" \
    || fail "stable plugin, no binary: downloads the stable tag" "urls: $URLS"
run 2.1.0-beta.1 ""
[[ "$URLS" == *"/download/$BETA_TAG/"* ]] && pass "beta plugin, no binary: downloads the beta tag $BETA_TAG" \
    || fail "beta plugin, no binary: downloads the beta tag" "urls: $URLS out: $OUT"
run 2.1.0-beta.1 1.2.4
[[ "$URLS" == *"/download/$BETA_TAG/"* ]] && pass "beta plugin with the stable binary installed: replaces it with the beta CLI" \
    || fail "beta plugin with the stable binary installed: replaces it" "rc=$RC urls: $URLS"
run 2.0.94 1.3.0-beta.1
[[ "$URLS" == *"/download/$STABLE_TAG/"* ]] && pass "stable plugin with a beta binary installed: replaces it with the stable CLI" \
    || fail "stable plugin with a beta binary installed: replaces it" "rc=$RC urls: $URLS"
run 2.1.0-beta.1 1.3.0-beta.1
[[ "$RC" == 0 && -z "$URLS" ]] && pass "beta plugin with the beta binary: kept, nothing downloaded" \
    || fail "beta plugin with the beta binary: kept" "rc=$RC urls: $URLS out: $OUT"
run 2.0.94 1.2.4
[[ "$RC" == 0 && -z "$URLS" ]] && pass "stable plugin with the stable binary: kept, nothing downloaded (unchanged)" \
    || fail "stable plugin with the stable binary: kept" "rc=$RC urls: $URLS"
run 2.1.0-beta.1 "" copy
[[ "$URLS" == *"/download/$BETA_TAG/"* ]] && pass "the ~/.oss/hooks copy finds the beta plugin through plugin-root" \
    || fail "the ~/.oss/hooks copy finds the beta plugin through plugin-root" "urls: $URLS out: $OUT"

[[ -f "$ROOT/hooks/oss-decrypt-checksums.beta.txt" ]] && pass "the beta CLI has its own committed checksum file" \
    || fail "the beta CLI has its own committed checksum file" "hooks/oss-decrypt-checksums.beta.txt missing"
grep -qF '"oss-decrypt-checksums.beta.txt"' "$ROOT/hooks/oss-session-start.sh" && pass "session start copies the beta checksum file into ~/.oss/hooks" \
    || fail "session start copies the beta checksum file into ~/.oss/hooks" "not in the copy list"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
