#!/bin/bash
# hooks/oss-timeline.sh: finding its own folder never runs PATH's dirname (R-257 round 3, security L5 INFO).
#
# @behavior Sourcing or running the timeline hook with a program named dirname planted early on PATH never runs
#           that program, so it cannot point the hook at planted copies of the helpers it sources.
# @business-rule Security L5: a hook resolves its own folder with bash builtins (${BASH_SOURCE[0]%/*}), as
#           oss-stop-dispatch.sh does, before it sources anything.
#
# Hermetic: temp HOME whose settings.json says style "none"; PATH is the sandbox bin plus the system folders. The case
# only sources the hook (it defines functions and starts nothing in the background), so no fd-9 drain is needed.
# Usage: ./hooks/__tests__/timeline-dirname.test.sh   (BASH_UNDER_TEST=/opt/homebrew/bin/bash for bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR CLAUDE_CODE_SESSION_ID
ROOT="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd)"
# shellcheck source=lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-timeline.sh"
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-dirname tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.oss" "$T/bin"
chmod 700 "$T/home/.oss"
printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
printf '#!/bin/sh\necho dirname >> "%s/dirname.calls"\nexit 1\n' "$T" > "$T/bin/dirname"
chmod 755 "$T/bin/dirname"

# 1. Sourcing the hook with a planted dirname first on PATH: the hook's functions load, the planted dirname never runs.
OUT=$(cd "$T" && run_capped 30 env -i HOME="$T/home" PATH="$T/bin:$SAFE_PATH" "$SH" -c \
    'source "$1" && declare -F oss_timeline_append >/dev/null && echo loaded' _ "$HOOK" 2>/dev/null); RC=$?
if [[ $RC -eq 0 && "$OUT" == loaded && ! -e "$T/dirname.calls" ]]; then
    pass "sourcing with a planted dirname: the hook loads, the planted dirname never runs"
else fail "sourcing with a planted dirname: the hook loads, the planted dirname never runs" "rc=$RC out=$OUT calls=$(cat "$T/dirname.calls" 2>/dev/null)"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
