#!/bin/bash
# The node the gate hooks run is recorded once, before any review agent acts (C1), and never silently
# switched to a different one (security HIGH-1).
#
# @behavior hooks/oss-node-path.sh (SessionStart) and the first gate hook call (oss-node.sh's oss_node)
#           record PATH's node in ~/.oss/node-path (mode 600, written atomically) when there is no
#           record: its STABLE link path (/opt/homebrew/bin/node), so a `brew upgrade` that swaps the
#           Cellar version keeps the record usable. Every link hop is followed and checked (owner, no temp
#           folder, folders resolved physically). A version manager's link in a temp folder (fnm
#           multishell) records the real file it points to. A usable record is kept, so a node planted on
#           PATH later is never adopted. A record that existed and is now unusable is never replaced by a
#           DIFFERENT node: the hooks fail closed and the user is told, naming the old and new paths.
# @business-rule The gate hooks must run the user's real node, never one a review agent placed on PATH,
#           and never silently switch to another one.
#
# Usage: ./hooks/__tests__/oss-node-path.test.sh   (needs jq)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-node-path.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

TMP="$(mktemp -d)"
# The node fixtures must lie outside every temp folder (temp is refused), so they live under the repo.
FIX="$(mktemp -d "$ROOT/.oss-node-fixture.XXXXXX")"
trap 'rm -rf "$TMP" "$FIX"' EXIT

if jq -e --arg cmd "\${CLAUDE_PLUGIN_ROOT}/hooks/oss-node-path.sh" '[.hooks.SessionStart[].hooks[] | select(.command == $cmd)] | length == 1' "$ROOT/hooks.json" >/dev/null; then
    pass "hooks.json: SessionStart runs oss-node-path.sh"
else
    fail "hooks.json: SessionStart runs oss-node-path.sh" "missing"
fi

# A brew-like install: bin/node -> ../Cellar/node/<v>/bin/node (a relative link, as brew makes it).
cellar() { # version
    rm -rf "$FIX/Cellar"; mkdir -p "$FIX/Cellar/node/$1/bin" "$FIX/bin"
    printf '#!/bin/sh\necho %s\n' "$1" > "$FIX/Cellar/node/$1/bin/node"; chmod +x "$FIX/Cellar/node/$1/bin/node"
    ln -sfn "../Cellar/node/$1/bin/node" "$FIX/bin/node"
}
record() { head -1 "$1/.oss/node-path" 2>/dev/null; }
# oss_node in a fresh bash with that HOME and PATH: prints rc, OSS_NODE, OSS_NODE_PROBLEM
oss_node_in() { # home path
    HOME="$1" PATH="$2" /bin/bash -c 'source "$0"; oss_node; echo "rc=$? node=$OSS_NODE problem=${OSS_NODE_PROBLEM:-}"' "$ROOT/hooks/oss-node.sh"
}

cellar 1.0
H="$TMP/home"; mkdir -p "$H"
out="$(HOME="$H" PATH="$FIX/bin:/usr/bin:/bin" "$HOOK" </dev/null 2>&1)"; rc=$?
if [[ $rc == 0 && -z "$out" && "$(record "$H")" == "$FIX/bin/node" ]]; then pass "no record: PATH's node is recorded by its stable link path (not the Cellar path), silently"
else fail "no record: PATH's node is recorded by its stable link path (not the Cellar path), silently" "rc=$rc out=$out file=$(cat "$H/.oss/node-path" 2>&1)"; fi
mode="$(stat -c %a "$H/.oss/node-path" 2>/dev/null || stat -f %Lp "$H/.oss/node-path" 2>/dev/null)"
if [[ "$mode" == 600 ]]; then pass "the record is private (mode 600)"
else fail "the record is private (mode 600)" "mode=$mode"; fi
if [[ -z "$(ls -A "$H/.oss" | grep -v '^node-path$')" ]]; then pass "the record is written atomically (no temp file left beside it)"
else fail "the record is written atomically (no temp file left beside it)" "$(ls -A "$H/.oss")"; fi

cellar 2.0
got="$(oss_node_in "$H" "/usr/bin:/bin")"
if [[ "$got" == "rc=0 node=$FIX/bin/node problem=" && "$(record "$H")" == "$FIX/bin/node" ]]; then pass "the stable-link record survives a Cellar version swap (brew upgrade)"
else fail "the stable-link record survives a Cellar version swap (brew upgrade)" "$got file=$(record "$H")"; fi

mkdir -p "$FIX/planted"; printf '#!/bin/sh\necho planted\n' > "$FIX/planted/node"; chmod +x "$FIX/planted/node"
HOME="$H" PATH="$FIX/planted:$FIX/bin:/usr/bin:/bin" "$HOOK" </dev/null >/dev/null 2>&1
got="$(oss_node_in "$H" "$FIX/planted:/usr/bin:/bin")"
if [[ "$(record "$H")" == "$FIX/bin/node" && "$got" == "rc=0 node=$FIX/bin/node problem=" ]]; then pass "a usable record is kept: a node planted first on PATH later is not adopted"
else fail "a usable record is kept: a node planted first on PATH later is not adopted" "$got file=$(record "$H")"; fi

# --- first use: the first gate hook call records it, with the same checks ------------------------
H1="$TMP/home-first"; mkdir -p "$H1"
got="$(oss_node_in "$H1" "$FIX/bin:/usr/bin:/bin")"
if [[ "$got" == "rc=0 node=$FIX/bin/node problem=" && "$(record "$H1")" == "$FIX/bin/node" ]]; then pass "first use with no record: oss_node records PATH's node and uses it"
else fail "first use with no record: oss_node records PATH's node and uses it" "$got file=$(record "$H1")"; fi

# --- a changed node after a record: never adopted silently (HIGH-1) ------------------------------
H2="$TMP/home-changed"; mkdir -p "$H2/.oss"
printf '%s\n' "$FIX/old/bin/node" > "$H2/.oss/node-path"
got="$(oss_node_in "$H2" "$FIX/bin:/usr/bin:/bin")"
if [[ "$got" == "rc=1 node= problem=changed" && "$(record "$H2")" == "$FIX/old/bin/node" ]]; then pass "a record that is gone and a different node on PATH: not adopted, oss_node fails closed (problem=changed)"
else fail "a record that is gone and a different node on PATH: not adopted, oss_node fails closed (problem=changed)" "$got file=$(record "$H2")"; fi
out="$(HOME="$H2" PATH="$FIX/bin:/usr/bin:/bin" "$HOOK" </dev/null 2>/dev/null)"; rc=$?
if [[ $rc == 0 && "$(record "$H2")" == "$FIX/old/bin/node" ]] \
    && jq -e --arg old "$FIX/old/bin/node" --arg new "$FIX/bin/node" '.systemMessage | contains($old) and contains($new)' <<<"$out" >/dev/null 2>&1; then
    pass "SessionStart with a changed node: the record is kept and the user is told, naming the old and new paths"
else fail "SessionStart with a changed node: the record is kept and the user is told, naming the old and new paths" "rc=$rc out=$out file=$(record "$H2")"; fi

ln -s "$FIX/bin/node" "$TMP/linked-node"
printf '%s\n' "$TMP/linked-node" > "$H2/.oss/node-path"
got="$(oss_node_in "$H2" "$FIX/bin:/usr/bin:/bin")"
if [[ "$got" == "rc=1 node= problem=changed" && "$(record "$H2")" == "$TMP/linked-node" ]]; then pass "a record naming a link in a temp folder is unusable, and is not silently replaced by another node"
else fail "a record naming a link in a temp folder is unusable, and is not silently replaced by another node" "$got file=$(record "$H2")"; fi

# --- what is never recorded -----------------------------------------------------------------------
H3="$TMP/home3"; mkdir -p "$H3" "$TMP/tmpbin"
printf '#!/bin/sh\necho fake\n' > "$TMP/tmpbin/node"; chmod +x "$TMP/tmpbin/node"
out="$(HOME="$H3" PATH="$TMP/tmpbin:/usr/bin:/bin" "$HOOK" </dev/null 2>&1)"; rc=$?
if [[ $rc == 0 && -z "$out" && ! -e "$H3/.oss/node-path" ]]; then pass "a node in a temp folder is never recorded; still exit 0, silent"
else fail "a node in a temp folder is never recorded; still exit 0, silent" "rc=$rc out=$out file=$(cat "$H3/.oss/node-path" 2>&1)"; fi

ln -s "$TMP/tmpbin" "$FIX/linked-dir"
out="$(HOME="$H3" PATH="$FIX/linked-dir:/usr/bin:/bin" "$HOOK" </dev/null 2>&1)"; rc=$?
if [[ $rc == 0 && ! -e "$H3/.oss/node-path" ]]; then pass "a node reached through a folder link into a temp folder is never recorded (folders resolved physically)"
else fail "a node reached through a folder link into a temp folder is never recorded (folders resolved physically)" "rc=$rc file=$(cat "$H3/.oss/node-path" 2>&1)"; fi

dots="$FIX/bin/../../../../../../../../../../..$(cd -P "$TMP/tmpbin" && pwd -P)"
out="$(HOME="$H3" PATH="$dots:/usr/bin:/bin" "$HOOK" </dev/null 2>&1)"; rc=$?
if [[ $rc == 0 && ! -e "$H3/.oss/node-path" ]]; then pass "a node reached through .. into a temp folder is never recorded"
else fail "a node reached through .. into a temp folder is never recorded" "rc=$rc file=$(cat "$H3/.oss/node-path" 2>&1)"; fi

out="$(HOME="$H3" PATH="/nonexistent" "$HOOK" </dev/null 2>&1)"; rc=$?
if [[ $rc == 0 && -z "$out" && ! -e "$H3/.oss/node-path" ]]; then pass "no node on PATH: nothing recorded, exit 0, silent"
else fail "no node on PATH: nothing recorded, exit 0, silent" "rc=$rc out=$out"; fi

# --- a version manager's link in a temp folder (fnm multishell): the real file is recorded (CR L2) --
H4="$TMP/home-fnm"; mkdir -p "$H4" "$TMP/fnm_multishells/123_456/bin"
ln -s "$FIX/Cellar/node/2.0/bin/node" "$TMP/fnm_multishells/123_456/bin/node"
out="$(HOME="$H4" PATH="$TMP/fnm_multishells/123_456/bin:/usr/bin:/bin" "$HOOK" </dev/null 2>&1)"; rc=$?
if [[ $rc == 0 && -z "$out" && "$(record "$H4")" == "$FIX/Cellar/node/2.0/bin/node" ]]; then pass "a version manager's node linked from a temp folder: its real file is recorded"
else fail "a version manager's node linked from a temp folder: its real file is recorded" "rc=$rc out=$out file=$(record "$H4")"; fi

# --- the record never runs PATH's node, mv, chmod, mkdir or rm --------------------------------------
H5="$TMP/home-pinned"; mkdir -p "$H5" "$FIX/fakes"; RAN="$TMP/fake-ran"
for tool in mv chmod mkdir rm mktemp readlink stat; do
    printf '#!/bin/sh\necho %s >> "%s"\nexit 1\n' "$tool" "$RAN" > "$FIX/fakes/$tool"; chmod +x "$FIX/fakes/$tool"
done
HOME="$H5" PATH="$FIX/fakes:$FIX/bin:/usr/bin:/bin" "$HOOK" </dev/null >/dev/null 2>&1
if [[ "$(record "$H5")" == "$FIX/bin/node" && ! -e "$RAN" ]]; then pass "recording runs no program from PATH (mv, chmod, mkdir, rm, mktemp, readlink, stat at fixed paths)"
else fail "recording runs no program from PATH (mv, chmod, mkdir, rm, mktemp, readlink, stat at fixed paths)" "file=$(record "$H5") ran=$(cat "$RAN" 2>&1)"; fi

echo "Ran $RUN checks, $FAILED failed"
[[ $FAILED -eq 0 ]]
