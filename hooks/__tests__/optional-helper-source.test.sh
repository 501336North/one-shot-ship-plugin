#!/bin/bash
# Hooks that treat a sibling helper (oss-api-curl.sh) as OPTIONAL must survive it being absent.
#
# @behavior A customer whose ~/.oss/hooks/ holds oss-notify.sh but not oss-api-curl.sh still gets
#           every workflow notification (log line, state update); only the API call is skipped.
# @business-rule On stock macOS /bin/bash 3.2, `source missing 2>/dev/null || true` under `set -e`
#           exits the script with rc 1 before the `|| true` runs. bash 4+ honours the fallback, so
#           the hooks are run under /bin/bash explicitly, never via whatever `bash` PATH resolves.
#
# Usage: ./hooks/__tests__/optional-helper-source.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/optional-helper-source.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }
echo "Running optional-helper-source tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

# A sandbox: temp HOME, a hooks dir holding only what the case copies in, and a fake plugin root
# whose oss-log.sh / node / curl record what the hook asked them to do.
sandbox() {
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/hooks" "$T/plugin/hooks" "$T/plugin/watcher/dist/cli" "$T/bin"
    printf '#!/bin/sh\necho "$*" >> "%s/log.calls"\n' "$T" > "$T/plugin/hooks/oss-log.sh"
    printf '#!/bin/sh\nexit 0\n' > "$T/bin/node"
    printf '#!/bin/sh\necho "$*" >> "%s/curl.calls"\ncat >/dev/null\n' "$T" > "$T/bin/curl"
    chmod +x "$T/plugin/hooks/oss-log.sh" "$T/bin/node" "$T/bin/curl"
    cp "$ROOT/hooks/oss-notify.sh" "$T/hooks/"
    # oss-safe-path.sh always ships beside oss-notify.sh (HOOKS_TO_COPY); without it workflow
    # names cannot be validated and every --workflow event is refused (fail closed, v2.0.87).
    cp "$ROOT/hooks/oss-safe-path.sh" "$T/hooks/"
}
# $(...) waits for the hook's backgrounded analytics subshell too (it inherits stdout).
run_notify() {
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$PATH" \
        "$SH" "$T/hooks/oss-notify.sh" "$@" 2>&1 </dev/null)
}
logged_in() {
    echo '{"apiKey":"ossk_test_key","apiUrl":"https://example.invalid"}' > "$T/home/.oss/config.json"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
}

# 1. Helper absent: a failed event still exits 0 and writes its log line.
sandbox
out=$(run_notify --workflow build failed '{"reason":"x"}'); rc=$?
if [[ $rc -eq 0 ]] && grep -q '^write build \[failed\] reason=x$' "$T/log.calls" 2>/dev/null; then
    pass "notify without oss-api-curl.sh: failed event exits 0 and is logged"
else fail "notify without oss-api-curl.sh: failed event exits 0 and is logged" "rc=$rc log=$(cat "$T/log.calls" 2>/dev/null) out=$out"; fi
rm -rf "$T"

# 2. Helper absent, logged in: a start event exits 0, is logged, and skips the analytics call.
sandbox; logged_in
out=$(run_notify --workflow build start); rc=$?
if [[ $rc -eq 0 ]] && grep -q '^write build \[start\]' "$T/log.calls" 2>/dev/null && [[ ! -e "$T/curl.calls" ]]; then
    pass "notify without oss-api-curl.sh: start event exits 0, is logged, analytics skipped"
else fail "notify without oss-api-curl.sh: start event exits 0, is logged, analytics skipped" "rc=$rc log=$(cat "$T/log.calls" 2>/dev/null) curl=$(cat "$T/curl.calls" 2>/dev/null) out=$out"; fi
rm -rf "$T"

# 3. Helper present: oss_api_curl is defined and used (-q first, --globoff, key on stdin via --config -, not argv).
sandbox; logged_in; cp "$ROOT/hooks/oss-api-curl.sh" "$T/hooks/"
out=$(run_notify --workflow build start); rc=$?
calls=$(cat "$T/curl.calls" 2>/dev/null)
if [[ $rc -eq 0 ]] && [[ "$calls" == "-q --globoff --config - "*"/api/v1/analytics/track"* ]] && [[ "$calls" != *ossk_test_key* ]]; then
    pass "notify with oss-api-curl.sh: analytics goes through oss_api_curl"
else fail "notify with oss-api-curl.sh: analytics goes through oss_api_curl" "rc=$rc curl=$calls out=$out"; fi
rm -rf "$T"

# 4. Session start without the helper beside it still copies the hooks into ~/.oss/hooks.
T=$(mktemp -d); mkdir -p "$T/home" "$T/hooks"; cp "$ROOT/hooks/oss-session-start.sh" "$T/hooks/"
(cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$ROOT" "$SH" "$T/hooks/oss-session-start.sh" >/dev/null 2>&1 </dev/null); rc=$?
if [[ $rc -eq 0 && -f "$T/home/.oss/hooks/oss-notify.sh" && -f "$T/home/.oss/hooks/oss-api-curl.sh" ]]; then
    pass "session start without oss-api-curl.sh beside it: exits 0 and installs the hooks"
else fail "session start without oss-api-curl.sh beside it: exits 0 and installs the hooks" "rc=$rc"; fi
rm -rf "$T"

# 5. Guard: no tracked script that runs under errexit sources a file with an `||` fallback
#    (on bash 3.2 that fallback is dead code: the failed source has already exited the script).
offenders=""
while IFS= read -r f; do
    grep -qE '^[[:space:]]*set -[a-z]*e|^[[:space:]]*set -o errexit' "$ROOT/$f" || continue
    hits=$(grep -nE '^[[:space:]]*(source|\.)[[:space:]].*\|\|' "$ROOT/$f" | cut -d: -f1 | tr '\n' ' ')
    [[ -n "$hits" ]] && offenders="$offenders $f:${hits% }"
done < <(cd "$ROOT" && git ls-files '*.sh' | grep -v '/__tests__/')
if [[ -z "$offenders" ]]; then pass "no errexit script relies on a '|| fallback' after source"
else fail "no errexit script relies on a '|| fallback' after source" "offenders:$offenders"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
