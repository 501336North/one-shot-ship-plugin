#!/bin/bash
# A merge after the archive move is filed in the archived feature folder and queued for push
# (radical-observability G2, Phase B2, B7).
#
# @behavior /oss:ship moves the feature's dev docs from .oss/dev/active/<f>/ to .oss/dev/completed/<f>-YYYY-MM-DD/
#           before it merges. When the prompt then runs `oss-value.sh timeline merge`, the merge line still belongs
#           to that feature: it is appended to the archived folder's timeline.ndjson with feature "<f>", and it is
#           queued as pending in the private outbox (~/.oss/timeline-outbox/<rid>.ndjson) so it reaches the API.
#           It is not dropped into .oss/dev/timeline-unfiled.ndjson.
# @business-rule AC-G2-003.3 as amended / API ADR-017 (the merge line reaches the API after the archive move),
#           P-3 (unfiled lines are never pushed, so a merge filed as unfiled would never reach the API).
# Usage: /bin/bash hooks/__tests__/timeline-archived.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OV="$ROOT/hooks/oss-value.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-archived tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-archived.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION
export CLAUDE_CODE_SESSION_ID=archived-sess-1

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
# No config.json: the writer still queues (with an empty fp) and the detached push stops at "no key", so the outbox
# entry stays pending and any curl reaches only the fake.
API="$T/api-fake"; fake_api_install "$API"

# The fake gh: records each argv in $T/gh/argv and answers `pr view` from $T/gh/reply with exit status $T/gh/rc.
mkdir -p "$T/gh/bin"
cat > "$T/gh/bin/gh" << 'GH'
#!/bin/bash
d="$(dirname "$0")/.."
printf '%s\n' "$*" >> "$d/argv"
[[ -e "$d/hang" ]] && exec sleep 60
[[ "$1 $2" == "pr view" ]] || exit 1
cat "$d/reply"
exit "$(cat "$d/rc")"
GH
chmod +x "$T/gh/bin/gh"
SHA=0123456789abcdef0123456789abcdef01234567
MERGED='{"number":4242,"state":"MERGED","mergeCommit":{"oid":"'$SHA'"},"mergedAt":"2026-11-06T09:30:00Z","mergedBy":{"login":"octo-dev"}}'
# reply <json> [rc]: what the fake gh answers next
reply() { printf '%s\n' "$1" > "$T/gh/reply"; printf '%s\n' "${2:-0}" > "$T/gh/rc"; rm -f "$T/gh/hang"; }
reply "$MERGED"
export PATH="$T/gh/bin:$API/bin:$PATH"

# a product repo on feat/demo/ship whose demo folder was already archived: completed/demo-2026-11-07, no active/demo
P="$T/product"; mkdir -p "$P/.oss/dev/active" "$P/.oss/dev/completed/demo-2026-11-07"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/ship)
CTL="$P/.oss/dev/completed/demo-2026-11-07/timeline.ndjson"
UNF="$P/.oss/dev/timeline-unfiled.ndjson"
OB_DIR="$HOME/.oss/timeline-outbox"
# one earlier gate line, written before the move
printf '%s\n' '{"v":1,"id":"7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f","ts":"2026-11-07T08:00:00Z","kind":"gate","feature":"demo","session":"archived-sess-0","round":1,"gate":"code-review","verdict":"pass","findings":{},"fixed":{},"mode":"full"}' > "$CTL"
export CLAUDE_PROJECT_DIR="$P"
D=$(cd "$P" && "$OV" dir 2>/dev/null)
[[ -d "$D" ]] || { echo "oss-value.sh dir printed no folder"; exit 1; }

# approve <text>: approval.txt as a prompt writes it
approve() { printf '%s\n' "$1" > "$D/approval.txt"; }
# merge: the verb as a served prompt runs it -> RC, ERR
merge() {
    (cd "$P" && run_capped 40 "$OV" timeline merge > /dev/null 2> "$T/err"); RC=$?
    ERR=$(cat "$T/err")
}
lines() { local c=0; [[ -f "$1" ]] && c=$(wc -l < "$1" | tr -d ' '); echo "$c"; }
outbox() { cat "$OB_DIR"/*.ndjson 2>/dev/null; }
diag() {
    echo "rc=$RC completed_lines=$(lines "$CTL") completed_last=$(tail -n 1 "$CTL" 2>/dev/null)" \
        "unfiled=$([[ -e "$UNF" ]] && echo present || echo absent) unfiled_last=$(tail -n 1 "$UNF" 2>/dev/null)" \
        "outbox=[$(outbox | head -c 600)] err=$ERR"
}

# --- B7: the merge after the archive move -------------------------------------------------------------------------
name='should file the merge line in the archived folder and queue it for push when the active folder was moved to completed/'
approve merge-flag; merge
last=$(tail -n 1 "$CTL" 2>/dev/null)
facts=$(jq -c '{kind, feature, pr, sha, mergedAt, mergedBy, approval}' <<< "$last" 2>/dev/null)
nid=$(jq -r '.id' <<< "$last" 2>/dev/null)
ob=$(outbox | jq -sc . 2>/dev/null)
if [[ $RC -eq 0 && $(lines "$CTL") -eq 2 \
    && "$facts" == '{"kind":"merge","feature":"demo","pr":4242,"sha":"'$SHA'","mergedAt":"2026-11-06T09:30:00Z","mergedBy":"octo-dev","approval":{"type":"merge-flag"}}' \
    && ! -e "$UNF" \
    && -n "$nid" && "$(jq -c 'map({id, state})' <<< "$ob" 2>/dev/null)" == '[{"id":"'$nid'","state":"pending"}]' ]]; then
    pass "$name"
else
    fail "$name" "$(diag)"
fi

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
