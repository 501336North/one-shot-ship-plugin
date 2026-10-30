#!/bin/bash
# Session start's status-line notification gets a JSON context whatever the project and branch are named (S6).
#
# @behavior Session start hands oss-notify.sh --session <event> a JSON object built from the project
#           folder name, the saved branch (.oss/session-context.md), the save age and the uncommitted
#           count. With jq: the object parses, the values arrive intact, and a name holding JSON syntax
#           (", \, ", "injected": true) adds no key. Without jq: a value outside a plain charset means no
#           notification at all (never a broken or injected object); plain values still notify.
# @business-rule A folder or branch name is the user's data, never the payload's structure.
# @boundary oss-session-start.sh (system boundary); oss-notify.sh and curl are faked collaborators.
#
# Usage:   /bin/bash hooks/__tests__/session-start-notify-payload.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}"
source "$SCRIPT_DIR/lib/warm-stub.sh"
source "$SCRIPT_DIR/lib/session-start-alias.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN+1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN+1)); FAILED=$((FAILED+1)); }
echo "Running session-start-notify-payload tests..."
command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is needed to check the payloads"; exit 1; }

# Made and warmed once: a sandbox plugin root holding the real hook and what it sources, an
# oss-notify.sh stub that records its event and context argument, and a curl stub (no network).
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
mkdir -p "$KS/plugin/hooks"
for n in oss-session-start.sh oss-api-curl.sh oss-safe-path.sh oss-config.sh oss-settings-cleanup.sh; do
    [[ -f "$HOOKS/$n" ]] && cp "$HOOKS/$n" "$KS/plugin/hooks/$n"
done
SS_HOOK=$(session_start_alias "$KS/plugin/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
WARM=y
warm_stub "$KS/plugin/hooks/oss-notify.sh" 'printf "%s" "${3-}" > "$STUB_STATE/payload.$2"; exit 0' || WARM=n
warm_stub "$KS/bin/curl" 'exit 0' || WARM=n
[[ $WARM == y ]] || { echo "✗ FAIL: stub warm-up — a stub did not run"; exit 1; }

# A PATH with every command on the real PATH except jq (a symlink farm), for the no-jq branch.
NOJQ="$KS/nojq"; mkdir -p "$NOJQ"
IFS=: read -r -a _dirs <<< "$PATH"
for _d in "${_dirs[@]}"; do
    [[ -d "$_d" ]] || continue
    for _f in "$_d"/*; do
        [[ -x "$_f" && "${_f##*/}" != jq && ! -e "$NOJQ/${_f##*/}" ]] && ln -s "$_f" "$NOJQ/${_f##*/}" 2>/dev/null
    done
done
PATH="$NOJQ" command -v jq >/dev/null 2>&1 && { echo "✗ FAIL: could not hide jq"; exit 1; }

HOSTILE_PROJECT='p", "injected": true, "q\'
HOSTILE_BRANCH='feat/x", "injected": true, "y": "\z'

# start <project folder name> <branch or ""> <jq|nojq> : one session start; $T/state/payload.<event> is
# what oss-notify.sh received. 3>&1: $(...) returns only after the detached notify job has exited.
start() {
    T=$(mktemp -d "$KS/case.XXXXXX"); mkdir -p "$T/home/.oss" "$T/state"
    P="$T/$1"; mkdir -p "$P"
    printf '%s' '{"apiKey":"fake-key-not-real","apiUrl":"http://127.0.0.1:9"}' > "$T/home/.oss/config.json"
    if [[ -n "$2" ]]; then
        mkdir -p "$P/.oss"
        printf '# Session Context\n\n**Branch:** %s\n\n_Saved: 2026-01-01 10:00:00_\n' "$2" > "$P/.oss/session-context.md"
    fi
    local path="$KS/bin:$PATH"; [[ $3 == nojq ]] && path="$KS/bin:$NOJQ"
    out=$(cd "$P" && env -u OSS_SKIP_HEALTH_CHECK -u OSS_CONFIG_DIR -u CLAUDE_CODE_SESSION_ID -u OSS_RUN_HEALTH_CHECK \
        HOME="$T/home" CLAUDE_PLUGIN_ROOT="$KS/plugin" CLAUDE_PROJECT_DIR="$P" STUB_STATE="$T/state" PATH="$path" \
        perl -e 'alarm 60; exec @ARGV' /bin/bash "$SS_HOOK" </dev/null 2>&1 3>&1)
}
payload() { cat "$T/state/payload.$1" 2>/dev/null; }

# (a) jq, saved context, hostile project and branch: exactly the four keys, values intact.
name="jq: context_restored payload parses, hostile project and branch arrive intact, no injected key"
start "$HOSTILE_PROJECT" "$HOSTILE_BRANCH" jq
if payload context_restored | jq -e --arg p "$HOSTILE_PROJECT" --arg b "$HOSTILE_BRANCH" \
     '(keys == ["branch","project","saveDate","uncommitted"]) and .project == $p and .branch == $b
      and (.uncommitted | type) == "number"' >/dev/null 2>&1; then pass "$name"
else fail "$name" "payload=$(payload context_restored) out=$out"; fi

# (b) jq, fresh start, hostile project: exactly {project}, value intact.
name="jq: fresh_start payload parses, hostile project arrives intact, no injected key"
start "$HOSTILE_PROJECT" "" jq
if payload fresh_start | jq -e --arg p "$HOSTILE_PROJECT" '(keys == ["project"]) and .project == $p' >/dev/null 2>&1; then pass "$name"
else fail "$name" "payload=$(payload fresh_start) out=$out"; fi

# (c) jq, plain names: the payload still parses (control for the uncommitted count in a non-git folder).
name="jq: plain project and branch give a parsing context_restored payload"
start "my-proj" "feat/plain" jq
if payload context_restored | jq -e '.project == "my-proj" and .branch == "feat/plain" and (.uncommitted | type) == "number"' >/dev/null 2>&1; then pass "$name"
else fail "$name" "payload=$(payload context_restored) out=$out"; fi

# (d) no jq, hostile values: no notification at all.
for ev in context_restored fresh_start; do
    name="no jq: hostile values ($ev) mean no notification, never a broken or injected payload"
    if [[ $ev == context_restored ]]; then start "$HOSTILE_PROJECT" "$HOSTILE_BRANCH" nojq; else start "$HOSTILE_PROJECT" "" nojq; fi
    if [[ ! -e "$T/state/payload.$ev" && "$out" == *"OSS: Ready"* ]]; then pass "$name"
    else fail "$name" "payload=$(payload "$ev") out=$out"; fi
done

# (e) no jq, plain values: the notification still goes, and its payload parses.
name="no jq: plain project and branch still notify with a parsing payload"
start "my-proj" "feat/plain" nojq
if payload context_restored | jq -e '(keys == ["branch","project","saveDate","uncommitted"]) and .project == "my-proj" and .branch == "feat/plain"' >/dev/null 2>&1; then pass "$name"
else fail "$name" "payload=$(payload context_restored) out=$out"; fi
name="no jq: plain project still gets its fresh_start notification"
start "my-proj" "" nojq
if payload fresh_start | jq -e '. == {"project":"my-proj"}' >/dev/null 2>&1; then pass "$name"
else fail "$name" "payload=$(payload fresh_start) out=$out"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
