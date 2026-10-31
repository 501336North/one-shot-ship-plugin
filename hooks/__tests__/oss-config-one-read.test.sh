#!/bin/bash
# Every hook that sends the API key takes the key and the URL from ONE read of the config (T37).
#
# @behavior The template hook, oss-iron-laws-sync.sh, fetch-iron-laws.sh, oss-push-metrics.sh, session start,
#           oss-notify.sh's analytics call and the team-laws hook send key A only to URL A: when the config is
#           replaced between two reads (here: right after the first one, by the jq or node that read it), no
#           request carries the first file's key to the second file's URL, or the reverse. With jq and without.
# @business-rule The key goes only to the API configured beside it in the same file, even while the file changes.
# @boundary each hook run as its caller runs it (system boundary); curl is faked, jq and node are the real ones
#           wrapped so the config changes after the first read.
#
# Usage:   /bin/bash hooks/__tests__/oss-config-one-read.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
HOOKS="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}"
source "$SCRIPT_DIR/lib/warm-stub.sh"
# Session start runs under an alias (lib/session-start-alias.sh): an outside `pkill -f oss-session-start` misses it (T48).
source "$SCRIPT_DIR/lib/session-start-alias.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-config-one-read tests..."
REAL_JQ=$(command -v jq) || { echo "✗ FAIL: jq is needed for the jq branch"; exit 1; }
REAL_NODE=$(command -v node) || { echo "✗ FAIL: node is needed for the no-jq branch"; exit 1; }

KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT

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

DOC_A='{"apiKey":"fake-key-A","apiUrl":"https://a.example.com"}'
DOC_B='{"apiKey":"fake-key-B","apiUrl":"https://b.example.com"}'
printf '%s' "$DOC_B" > "$KS/doc-b.json"

# jq and node wrappers: run the real one, then, the first time a run named the case's config, replace that
# config with document B. So a hook that reads the config twice sees A, then B.
SWAP='for a in "$@"; do if [ "$a" = "$SHIM/home/.oss/config.json" ] && [ ! -e "$SHIM/swapped" ]; then : > "$SHIM/swapped"; cat "'"$KS"'/doc-b.json" > "$a"; fi; done; exit $rc'
WARM=y
warm_stub "$KS/jqbin/jq" '"'"$REAL_JQ"'" "$@"; rc=$?; '"$SWAP" || WARM=n
warm_stub "$KS/bin/node" '"'"$REAL_NODE"'" "$@"; rc=$?; '"$SWAP" || WARM=n
# A recording curl: one line per keyed request, "<key> <first URL>".
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
key=""; prev=""; for a in "$@"; do [ "$prev" = --config ] && [ "$a" = - ] && key=$(cat); prev="$a"; done
k=$(printf '%s' "$key" | grep -oE 'fake-key-[A-Z]' | head -1)
u=$(printf '%s\n' "$@" | grep -oE '^https?://[A-Za-z0-9.-]+' | head -1)
[ -n "$k" ] && printf '%s %s\n' "$k" "$u" >> "$SHIM/pairs"
printf '# IRON LAWS\n'
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "IRON LAW padding line $i: a real laws body is several KB, the sync rejects anything under 500 bytes."; done
printf '\n200'
EOF
)" || WARM=n
# Two plugin roots holding the real hooks: one for session start and the keyed scripts (no-op notify), one
# for oss-notify.sh (a workflow-state CLI file present, so its analytics call runs).
mkdir -p "$KS/plugin/hooks" "$KS/pluginN/hooks" "$KS/pluginN/watcher/dist/cli"
for n in oss-session-start.sh oss-api-curl.sh oss-safe-path.sh oss-config.sh oss-settings-cleanup.sh \
         fetch-iron-laws.sh oss-fetch-team-iron-laws.sh oss-push-metrics.sh oss-iron-laws-sync.sh oss-claude-md-template.sh; do
    [[ -f "$HOOKS/$n" ]] && cp "$HOOKS/$n" "$KS/plugin/hooks/$n"
done
warm_stub "$KS/plugin/hooks/oss-notify.sh" 'exit 0' || WARM=n
SS_HOOK=$(session_start_alias "$KS/plugin/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
for n in oss-notify.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$n" "$KS/pluginN/hooks/$n"; done
warm_stub "$KS/pluginN/hooks/oss-log.sh" 'exit 0' || WARM=n
: > "$KS/pluginN/watcher/dist/cli/update-workflow-state.js"
[[ $WARM == y ]] || { echo "✗ FAIL: stub warm-up — a stub did not run"; exit 1; }

mode_path() { case "$1" in (jq) printf '%s' "$KS/jqbin:$KS/bin:$PATH" ;; (*) printf '%s' "$KS/bin:$KS/nojq" ;; esac; }

# site <name> <mode> [config] : runs one hook as its caller does, config = document A unless given; sets OUT and
# PAIRS (one line per keyed request). The run waits for detached jobs through fd 3.
site() {
    SHIM=$(mktemp -d "$KS/s.XXXXXX"); mkdir -p "$SHIM/home/.oss" "$SHIM/proj"
    printf '%s' "${3:-$DOC_A}" > "$SHIM/home/.oss/config.json"
    printf '# Mine\n' > "$SHIM/proj/CLAUDE.md"
    local root="$KS/plugin"
    local -a cmd
    case "$1" in
        (fetch-iron-laws) cmd=(/bin/bash "$root/hooks/fetch-iron-laws.sh") ;;
        (team-iron-laws) cmd=(/bin/bash "$root/hooks/oss-fetch-team-iron-laws.sh" --force) ;;
        (push-metrics) cmd=(/bin/bash "$root/hooks/oss-push-metrics.sh" '{"command":"build"}') ;;
        (iron-laws-sync) cmd=(/bin/bash "$root/hooks/oss-iron-laws-sync.sh" --install) ;;
        (claude-md-template) cmd=(/bin/bash "$root/hooks/oss-claude-md-template.sh") ;;
        (session-start) cmd=(/bin/bash "$SS_HOOK") ;;
        (notify) root="$KS/pluginN"; cmd=(/bin/bash "$root/hooks/oss-notify.sh" --workflow build start) ;;
    esac
    OUT=$(cd "$SHIM/proj" && run_capped 60 env -u OSS_SKIP_HEALTH_CHECK -u CLAUDE_CODE_SESSION_ID -u OSS_RUN_HEALTH_CHECK \
        SHIM="$SHIM" HOME="$SHIM/home" CLAUDE_PLUGIN_ROOT="$root" CLAUDE_PROJECT_DIR="$SHIM/proj" PATH="$(mode_path "$2")" \
        "${cmd[@]}" </dev/null 2>&1 3>&1)
    PAIRS=$(cat "$SHIM/pairs" 2>/dev/null)
}

for MODE in jq nojq; do
    for S in fetch-iron-laws team-iron-laws push-metrics iron-laws-sync claude-md-template session-start notify; do
        name="[$MODE] $S: the key goes only to the URL of the same read, while the config changes"
        site "$S" "$MODE"
        mixed=$(printf '%s\n' "$PAIRS" | grep -vE '^(fake-key-A https://a\.example\.com|fake-key-B https://b\.example\.com)$' | grep -v '^$')
        if [[ -n "$PAIRS" && -z "$mixed" ]]; then pass "$name"
        else fail "$name" "pairs=$(printf '%q' "$PAIRS") out=$(printf '%q' "${OUT:0:200}")"; fi
    done
done

# The messages stay as they were: the template hook still tells an unreadable config from a missing key.
for MODE in jq nojq; do
    site claude-md-template "$MODE" '{"apiKey":"fake-key-A","apiUrl":"https://a.example.com"} trailing'
    name="[$MODE] claude-md-template: an unreadable config still says it is not valid JSON; no request"
    if [[ "$OUT" == *"is not valid JSON"* && "$OUT" != *"not logged in"* && -z "$PAIRS" ]]; then pass "$name"
    else fail "$name" "pairs=$(printf '%q' "$PAIRS") out=$(printf '%q' "${OUT:0:300}")"; fi
    site claude-md-template "$MODE" '{"apiUrl":"https://a.example.com"}'
    name="[$MODE] claude-md-template: a config with no apiKey still says not logged in; no request"
    if [[ "$OUT" == *"not logged in"* && "$OUT" != *"is not valid JSON"* && -z "$PAIRS" ]]; then pass "$name"
    else fail "$name" "pairs=$(printf '%q' "$PAIRS") out=$(printf '%q' "${OUT:0:300}")"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
