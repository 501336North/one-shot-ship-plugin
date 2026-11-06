#!/bin/bash
# oss-notify adds one command line to the feature timeline for each start, complete and failed (G2, B2), and
# never stops early on non-JSON input (FOLLOWUPS #130).
#
# @behavior When a command reports `--workflow <cmd> start|complete|failed`, the feature's committed
#           .oss/dev/active/<feature>/timeline.ndjson gains one `command` line with that command and status, also
#           when the plugin has no built watcher (watcher/dist). Other events (task_complete, merged) add none.
#           A refused line (a linked timeline file) never makes oss-notify fail or skip its state update. The
#           copy of oss-notify that served prompts run, ~/.oss/hooks/oss-notify.sh, writes the line too. When the
#           copy service or a context is not JSON, oss-notify still finishes its state update and its log line.
# @business-rule AC-G2-001.1 (a command line per start, complete and failed, watcher or not), AC-G2-001.5 (no write
#           through a link), the status line and workflow log must keep working whatever the timeline does.
# Usage: /bin/bash hooks/__tests__/notify-timeline.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running notify-timeline tests..."
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
# shellcheck source=hooks/__tests__/lib/session-start-alias.sh
source "$ROOT/hooks/__tests__/lib/session-start-alias.sh"

T=$(cd "$(mktemp -d /tmp/oss-notify-timeline.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION CLAUDE_PLUGIN_ROOT
export CLAUDE_CODE_SESSION_ID=nt-session-1
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api-fake"; fake_api_install "$API"   # no config.json: nothing is sent, and any curl reaches only the fake
export PATH="$API/bin:$PATH"

# BARE: the plugin's hooks with no watcher/dist. WATCHED: the same plus a built watcher, whose node (a fake on
# PATH only for these runs) records every call; get-copy.js prints $FAKE_COPY_OUT.
BARE="$T/bare"; mkdir -p "$BARE"; cp -R "$ROOT/hooks" "$BARE/hooks"
WATCHED="$T/watched"; mkdir -p "$WATCHED/watcher/dist/cli" "$T/bin"; cp -R "$ROOT/hooks" "$WATCHED/hooks"
for f in update-workflow-state.js chain-trigger.cjs get-copy.js; do : > "$WATCHED/watcher/dist/cli/$f"; done
cat > "$T/bin/node" << EOF
#!/bin/bash
echo "\$*" >> "$T/node.calls"
[[ "\$1" == *get-copy.js ]] && printf '%s\n' "\${FAKE_COPY_OUT:-}"
exit 0
EOF
chmod +x "$T/bin/node"

# a product repo on feat/demo/build with the demo feature folder
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
TL="$P/.oss/dev/active/demo/timeline.ndjson"

# notify <plugin root> <args...> -> RC; the hook as a served prompt runs it, from the product repo
notify() {
    local root="$1"; shift
    (cd "$P" && CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$root" PATH="$T/bin:$PATH" \
        run_capped 30 /bin/bash "$root/hooks/oss-notify.sh" "$@" </dev/null >/dev/null 2>"$T/err")
    RC=$?
}
commands() { [[ -f "$TL" ]] || { echo '[]'; return; }; jq -sc '[.[] | select(.kind == "command") | {command, status, feature, session}]' "$TL" 2>/dev/null; }
count() { local c=0; [[ -f "$TL" ]] && c=$(wc -l < "$TL" | tr -d ' '); echo "$c"; }

# --- start, complete and failed: one command line each ----------------------------------------------------------
rm -f "$T/node.calls"
rcs=""
for e in start complete failed; do notify "$WATCHED" --workflow build "$e" '{}'; rcs="$rcs$RC"; done
want='[{"command":"build","status":"start","feature":"demo","session":"nt-session-1"},{"command":"build","status":"complete","feature":"demo","session":"nt-session-1"},{"command":"build","status":"failed","feature":"demo","session":"nt-session-1"}]'
got=$(commands)
[[ "$rcs" == 000 && "$got" == "$want" ]] && grep -q 'setActiveStep build' "$T/node.calls" 2>/dev/null \
    && pass "should append one command line for start, complete and failed" \
    || fail "should append one command line for start, complete and failed" "rcs=$rcs got=$got err=$(cat "$T/err")"

# --- other events add nothing -----------------------------------------------------------------------------------
before=$(count)
notify "$WATCHED" --workflow build task_complete '{"current":1,"total":3,"taskName":"t1"}'; r1=$RC
notify "$WATCHED" --workflow ship merged '{}'; r2=$RC
[[ "$r1$r2" == 00 && "$(count)" == "$before" ]] \
    && pass "should append nothing for task_complete or merged" \
    || fail "should append nothing for task_complete or merged" "rc=$r1$r2 lines $before -> $(count)"

# --- no built watcher -------------------------------------------------------------------------------------------
rm -f "$TL"
notify "$BARE" --workflow plan start '{}'
got=$(commands)
[[ $RC -eq 0 && "$got" == '[{"command":"plan","status":"start","feature":"demo","session":"nt-session-1"}]' ]] \
    && pass "should still append the line when watcher/dist is absent" \
    || fail "should still append the line when watcher/dist is absent" "rc=$RC got=$got err=$(cat "$T/err")"

# --- a refused line never stops oss-notify ----------------------------------------------------------------------
rm -f "$TL" "$T/node.calls"; : > "$T/elsewhere"; ln -s "$T/elsewhere" "$TL"
notify "$WATCHED" --workflow build start '{}'
[[ $RC -eq 0 && ! -s "$T/elsewhere" ]] && grep -q 'setActiveStep build' "$T/node.calls" 2>/dev/null \
    && pass "should exit 0 and still update the state when the timeline line is refused (linked file)" \
    || fail "should exit 0 and still update the state when the timeline line is refused (linked file)" \
        "rc=$RC elsewhere=$(cat "$T/elsewhere") node=$(tr '\n' '|' < "$T/node.calls" 2>/dev/null)"
rm -f "$TL"

# --- the copy served prompts run: ~/.oss/hooks/oss-notify.sh ----------------------------------------------------
SSA="$T/ssa"; SS_HOOK=$(session_start_alias "$BARE/hooks" "$SSA/hooks")
(cd "$T" && CLAUDE_PLUGIN_ROOT="$BARE" run_capped 60 /bin/bash "$SS_HOOK" </dev/null >/dev/null 2>&1)
(cd "$P" && CLAUDE_PROJECT_DIR="$P" run_capped 30 /bin/bash "$HOME/.oss/hooks/oss-notify.sh" --workflow ship start '{}' \
    </dev/null >/dev/null 2>"$T/err")
RC=$?
got=$(commands)
[[ $RC -eq 0 && "$got" == '[{"command":"ship","status":"start","feature":"demo","session":"nt-session-1"}]' ]] \
    && pass "should append the line from the ~/.oss/hooks copy that session start installs" \
    || fail "should append the line from the ~/.oss/hooks copy that session start installs" \
        "rc=$RC got=$got installed=$(ls "$HOME/.oss/hooks" 2>/dev/null | tr '\n' ' ')"

# --- #130: non-JSON input never ends the hook before its state update -------------------------------------------
rm -f "$T/node.calls"
FAKE_COPY_OUT='not json' notify "$WATCHED" --workflow build start '{}'
[[ $RC -eq 0 ]] && grep -q 'setActiveStep build' "$T/node.calls" 2>/dev/null \
    && pass "should finish the state update when the copy service prints non-JSON (#130)" \
    || fail "should finish the state update when the copy service prints non-JSON (#130)" \
        "rc=$RC node=$(tr '\n' '|' < "$T/node.calls" 2>/dev/null)"

notify "$WATCHED" --workflow build task_complete 'not json'
[[ $RC -eq 0 ]] && pass "should exit 0 when a task_complete context is not JSON (#130)" \
    || fail "should exit 0 when a task_complete context is not JSON (#130)" "rc=$RC"

rm -f "$T/node.calls"
notify "$WATCHED" --issue loop_detected 'not json'
[[ $RC -eq 0 ]] && grep -rqF '[loop_detected] not json' "$P/.oss/logs" 2>/dev/null \
    && pass "should still write the issue log line when the --issue context is not JSON (#130)" \
    || fail "should still write the issue log line when the --issue context is not JSON (#130)" \
        "rc=$RC logs=$(cat "$P"/.oss/logs/current-session/issue.log 2>/dev/null)"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
