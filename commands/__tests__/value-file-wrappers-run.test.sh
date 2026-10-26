#!/bin/bash
# Runs wrapper shell blocks exactly as written, in a sandbox HOME (never the real ~/.oss).
#
# Usage: ./value-file-wrappers-run.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./value-file-wrappers-run.test.sh
#
# @behavior A user runs /oss:login --key, /oss:models set, /oss:workflows <name> or /oss:trust from
#           any folder, inside a git repository or not, and the command takes its value from the
#           value folder that `oss-value.sh dir` printed.
# @business-rule Ship round 4, R4-1: outside a git repository the value folder is the one per-user
#           folder ~/.oss/run/home (same checks), so these commands work there again.
# @behavior /oss:settings, /oss:custom, /oss:watcher, /oss:webhook, /oss:login,
#           /oss:oss-audio and /oss:visual-test work as before, and a ' or $( in a value never runs.
# @business-rule Ship round 4, R4-2: a block uses only values it reads from a value file (checked in
#           code by oss-value.sh read), computes itself (config.json, oss-value.sh root, fixed
#           paths) or reads from its own file with a check (watcher.pid); never one the model types.
#
# The model's part (run `dir`, Write the value file) is done here by the test; every shell block is
# taken from the wrapper by a literal line it contains and run unchanged. curl, node and oss-decrypt
# are stubs that record their arguments.

set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$C/.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
TESTS_RUN=0; TESTS_FAILED=0
pass() { echo "✓ PASS: $1"; TESTS_RUN=$((TESTS_RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; TESTS_RUN=$((TESTS_RUN + 1)); TESTS_FAILED=$((TESTS_FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-wrun.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

# fence_with <file> <literal>: the body of the first fenced block in commands/<file> holding <literal>,
# less the indent of its opening fence (a block inside a list item)
fence_with() {
    awk -v lit="$2" '
        /^[[:space:]]*```/ { if (!inf) { inf = 1; n = 0; hit = 0; match($0, /^[[:space:]]*/); ind = RLENGTH; next } inf = 0; if (hit) { for (i = 1; i <= n; i++) print b[i]; exit } next }
        inf { l = $0; if (substr(l, 1, ind) ~ /^[[:space:]]*$/) l = substr(l, ind + 1); b[++n] = l; if (index($0, lit)) hit = 1 }' "$C/$1"
}

# stubs: each records "<name> <args>" in $T/calls; curl prints $T/curl.out and exits $T/curl.rc
mkdir -p "$T/bin"
for s in curl node say afplay terminal-notifier sips launchctl sleep npm brew; do
    printf '#!/bin/sh\necho "%s $*" >> "%s/calls"\n[ "%s" = curl ] && { cat "%s/curl.out" 2>/dev/null; exit "$(cat "%s/curl.rc" 2>/dev/null || echo 0)"; }\nexit 0\n' "$s" "$T" "$s" "$T" "$T" > "$T/bin/$s"
    chmod +x "$T/bin/$s"
done
# a plugin root for ~/.oss/plugin-root to name (the wrappers compute it with oss-value.sh root)
FR="$T/fakeroot"; mkdir -p "$FR/watcher/dist/cli" "$FR/daemon/dist" "$FR/assets"
for j in models webhook-setup webhook-toggle update-workflow-state; do : > "$FR/watcher/dist/cli/$j.js"; done; : > "$FR/assets/icon.png"

N=0
# sandbox <cwd-kind>: fresh HOME with the real hooks, a cwd (norepo|repo) -> H, W
sandbox() {
    N=$((N + 1)); H="$T/h$N"; mkdir -p "$H/.oss/hooks" "$H/.oss/bin"
    cp "$ROOT/hooks/oss-value.sh" "$ROOT/hooks/oss-login.sh" "$ROOT/hooks/oss-safe-path.sh" "$ROOT/hooks/oss-api-curl.sh" "$ROOT/hooks/oss-log.sh" "$ROOT/hooks/oss-notify.sh" "$H/.oss/hooks/"
    printf '#!/bin/sh\necho "oss-decrypt $*" >> "%s/calls"\n' "$T" > "$H/.oss/bin/oss-decrypt"; chmod +x "$H/.oss/bin/oss-decrypt"
    printf '%s\n' "$FR" > "$H/.oss/plugin-root"
    W="$T/w$N/cwd"; mkdir -p "$W"
    [[ "$1" == repo ]] && (cd "$W" && git init -q) >/dev/null 2>&1
    rm -f "$T/calls" "$T/curl.out" "$T/curl.rc"
}
# in_sandbox <cmd...>: run in the cwd with the sandbox HOME and the stubs first on PATH
in_sandbox() {
    (cd "$W" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w$N" HOME="$H" PATH="$T/bin:$PATH" "$@")
}
# model_writes <name> <value> [<name> <value>...]: what the model does: run dir once, then Write
# each <name>.txt in the folder it printed
model_writes() {
    local d; d=$(in_sandbox "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null) && [[ -n "$d" ]] || return 1
    while (( $# >= 2 )); do printf '%s\n' "$2" > "$d/$1.txt"; shift 2; done
}
# run_block <file> <literal>: run that wrapper block as written -> OUT, RC
run_block() {
    local b; b=$(fence_with "$1" "$2")
    [[ -n "$b" ]] || { OUT="(no block holding '$2' in $1)"; RC=99; return; }
    OUT=$(in_sandbox "$SH" -c "$b" 2>&1 </dev/null); RC=$?
}
calls() { cat "$T/calls" 2>/dev/null; }

# === R4-1: the value lines work from a folder that is in no git repository ===================
for kind in norepo repo; do
    sandbox "$kind"; printf '{"plan":"pro"}\n200\n' > "$T/curl.out"
    model_writes key ossk_test_key_123; run_block login.md 'oss-login.sh'
    [[ "$RC" == 0 && "$(jq -r .apiKey "$H/.oss/config.json" 2>/dev/null)" == ossk_test_key_123 && "$OUT" == *"Plan: pro"* ]] \
        && pass "$kind: /oss:login --key saves the key it read" || fail "$kind: /oss:login --key saves the key it read" "rc=$RC out=$OUT"

    sandbox "$kind"; model_writes prompt oss:code-reviewer model ollama/codellama; run_block models.md 'oss-value.sh models-set'
    [[ "$RC" == 0 && "$(calls)" == "node $FR/watcher/dist/cli/models.js set agents oss:code-reviewer ollama/codellama" ]] \
        && pass "$kind: /oss:models set passes the prompt and model it read" || fail "$kind: /oss:models set passes the prompt and model it read" "rc=$RC out=$OUT calls=$(calls)"

    sandbox "$kind"; model_writes workflow build; run_block workflows.md 'oss-value.sh read workflow'
    [[ "$RC" == 0 && "$OUT" == build ]] && pass "$kind: /oss:workflows <name> prints the name it read" || fail "$kind: /oss:workflows <name> prints the name it read" "rc=$RC out=$OUT"

    sandbox "$kind"; model_writes category commands name build; run_block trust.md 'oss-value.sh decrypt'
    [[ "$RC" == 0 && "$(calls)" == "oss-decrypt --type commands --name build" ]] \
        && pass "$kind: /oss:trust decrypts with the category and name it read" || fail "$kind: /oss:trust decrypts with the category and name it read" "rc=$RC out=$OUT calls=$(calls)"
done
# the wrappers no longer say the folder needs a git repository
for f in login.md models.md workflows.md trust.md; do
    grep -qiF 'inside a git repository' "$C/$f" && fail "$f does not say the value folder needs a git repository" "$(grep -niF 'inside a git repository' "$C/$f" | head -1)" \
        || pass "$f does not say the value folder needs a git repository"
done

# === R4-2: every value a block uses is read from a value file or computed in the block ========
pwned() { [[ -e "$W/PWNED" || -e "$H/PWNED" || -e "$T/PWNED" ]]; }
cfg() { printf '{"apiKey": "%s", "apiUrl": "%s"}\n' "$1" "$2" > "$H/.oss/config.json"; }

# --- settings: the save block reads the choices and writes them; it calls no API -------------
SAVE='read notify_style)'
sandbox repo; cfg ossk_k1 https://api.example.invalid
model_writes notify_style audio verbosity all voice Daniel; run_block settings.md "$SAVE"
j() { jq -r "$1" "$H/.oss/settings.json" 2>/dev/null; }
[[ "$RC" == 0 && "$(j .notifications.style)" == audio && "$(j .notifications.voice)" == Daniel && "$(j .notifications.sound)" == Glass \
   && "$(j .notifications.verbosity)" == all && "$(j '.notifications | has("telegram")')" == false && "$(j .version)" == 2 ]] \
    && pass "settings: the save block writes the choices it read (voice read, sound kept)" || fail "settings: the save block writes the choices it read (voice read, sound kept)" "rc=$RC out=$OUT settings=$(cat "$H/.oss/settings.json" 2>&1)"
[[ "$(calls)" == *"say -v Daniel"* && "$(calls)" != *curl* ]] \
    && pass "settings: the test notice uses the voice read; no API is called" || fail "settings: the test notice uses the voice read; no API is called" "calls=$(calls)"
[[ "$OUT" == *"Style:     audio"* && "$OUT" == *"Voice:     Daniel"* ]] && pass "settings: the save block prints the new configuration" || fail "settings: the save block prints the new configuration" "$OUT"
# sound chosen: sound read, voice kept from settings.json
sandbox repo; cfg ossk_k1 https://api.example.invalid
printf '{"notifications":{"style":"visual","voice":"Karen","sound":"Glass","verbosity":"important"},"version":2}\n' > "$H/.oss/settings.json"
model_writes notify_style sound verbosity important sound Pop; run_block settings.md "$SAVE"
[[ "$RC" == 0 && "$(j .notifications.voice)" == Karen && "$(j .notifications.sound)" == Pop && "$(calls)" == *"afplay /System/Library/Sounds/Pop.aiff"* ]] \
    && pass "settings: sound chosen: sound read, voice kept from settings.json" || fail "settings: sound chosen: sound read, voice kept from settings.json" "rc=$RC out=$OUT calls=$(calls)"
# P2R1-B: the save block merges into settings.json; it never drops the keys it does not own
# @behavior A user changes notification style with /oss:settings and keeps their model routing,
#           API keys, supervisor and any other settings exactly as they were.
# @business-rule /oss:settings owns notifications.{style,voice,sound,verbosity} and .version only.
#           Every other key, at the top level or inside notifications, is kept byte for byte. A file
#           it cannot merge safely (not valid JSON, a symlink) is refused and left as it is.
sandbox repo; cfg ossk_k1 https://api.example.invalid
cat > "$H/.oss/settings.json" <<'JSON'
{"models":{"agents":{"oss:code-reviewer":"ollama/gpt-oss:120b"},"think":{"ollama/gpt-oss:120b":false}},
 "apiKeys":{"openrouter":"sk-or-test"},"supervisor":{"enabled":true,"interval":30},"zzUnrelated":[1,"two",{"3":null}],
 "notifications":{"style":"visual","voice":"Karen","sound":"Ping","verbosity":"important","extra":{"keep":true}},"version":1}
JSON
chmod 640 "$H/.oss/settings.json"
OTHERS_BEFORE=$(jq -S 'del(.notifications, .version)' "$H/.oss/settings.json")
model_writes notify_style sound verbosity errors-only sound Pop
LS_BEFORE=$(ls -A "$H/.oss"); run_block settings.md "$SAVE"
[[ "$RC" == 0 && "$(jq -S 'del(.notifications, .version)' "$H/.oss/settings.json" 2>&1)" == "$OTHERS_BEFORE" ]] \
    && pass "settings: models, apiKeys, supervisor and unrelated keys are unchanged after a save" || fail "settings: models, apiKeys, supervisor and unrelated keys are unchanged after a save" "rc=$RC out=$OUT settings=$(cat "$H/.oss/settings.json" 2>&1)"
[[ "$(j .notifications.style)" == sound && "$(j .notifications.voice)" == Karen && "$(j .notifications.sound)" == Pop \
   && "$(j .notifications.verbosity)" == errors-only && "$(jq -c .notifications.extra "$H/.oss/settings.json" 2>/dev/null)" == '{"keep":true}' && "$(j .version)" == 2 ]] \
    && pass "settings: the save sets the four choices and version 2, keeping other notification keys" || fail "settings: the save sets the four choices and version 2, keeping other notification keys" "settings=$(cat "$H/.oss/settings.json" 2>&1)"
MODE=$(stat -c %a "$H/.oss/settings.json" 2>/dev/null || stat -f %Lp "$H/.oss/settings.json")
[[ "$MODE" == 640 && ! -L "$H/.oss/settings.json" && "$(ls -A "$H/.oss")" == "$LS_BEFORE" ]] \
    && pass "settings: the save keeps the file's mode and leaves no temp file" || fail "settings: the save keeps the file's mode and leaves no temp file" "mode=$MODE ls=$(ls -A "$H/.oss" | tr '\n' ' ')"
# no settings.json: created with just notifications and version, mode 600
sandbox repo; model_writes notify_style visual verbosity all; run_block settings.md "$SAVE"
MODE=$(stat -c %a "$H/.oss/settings.json" 2>/dev/null || stat -f %Lp "$H/.oss/settings.json" 2>/dev/null)
[[ "$RC" == 0 && "$(jq -c keys "$H/.oss/settings.json" 2>/dev/null)" == '["notifications","version"]' && "$(jq -c ".notifications | keys" "$H/.oss/settings.json" 2>/dev/null)" == '["sound","style","verbosity","voice"]' && "$MODE" == 600 ]] \
    && pass "settings: a missing settings.json is created with notifications and version only (mode 600)" || fail "settings: a missing settings.json is created with notifications and version only (mode 600)" "rc=$RC mode=$MODE settings=$(cat "$H/.oss/settings.json" 2>&1)"
# settings.json that is not valid JSON: refused with a clear message, the file left as it was
sandbox repo; printf '{"models": {"agents": BROKEN\n' > "$H/.oss/settings.json"
model_writes notify_style visual verbosity all; LS_BEFORE=$(ls -A "$H/.oss"); run_block settings.md "$SAVE"
[[ "$RC" != 0 && "$(cat "$H/.oss/settings.json")" == '{"models": {"agents": BROKEN' && "$OUT" == *"not valid JSON"* \
   && "$(ls -A "$H/.oss")" == "$LS_BEFORE" && "$(calls)" != *terminal-notifier* ]] \
    && pass "settings: an invalid settings.json is refused with a message and left untouched" || fail "settings: an invalid settings.json is refused with a message and left untouched" "rc=$RC out=$OUT calls=$(calls) settings=$(cat "$H/.oss/settings.json" 2>&1)"
# settings.json that is a symlink: refused, the link and its target left as they were
sandbox repo; echo '{"keep":1}' > "$H/target.json"; ln -s "$H/target.json" "$H/.oss/settings.json"
model_writes notify_style visual verbosity all; run_block settings.md "$SAVE"
[[ "$RC" != 0 && -L "$H/.oss/settings.json" && "$(cat "$H/target.json")" == '{"keep":1}' && "$(calls)" != *terminal-notifier* ]] \
    && pass "settings: a symlinked settings.json is refused, link and target untouched" || fail "settings: a symlinked settings.json is refused, link and target untouched" "rc=$RC out=$OUT link=$([[ -L "$H/.oss/settings.json" ]] && echo y || echo n) target=$(cat "$H/target.json")"
# telegram is no longer a style: refused, settings.json untouched, nothing run, no API called
sandbox repo; cfg ossk_k1 https://api.example.invalid; echo '{"keep":1}' > "$H/.oss/settings.json"
model_writes notify_style telegram verbosity important; run_block settings.md "$SAVE"
[[ "$RC" != 0 && "$(cat "$H/.oss/settings.json")" == '{"keep":1}' && -z "$(calls)" ]] \
    && pass "settings: telegram is refused as a style, settings.json untouched, nothing run" || fail "settings: telegram is refused as a style, settings.json untouched, nothing run" "rc=$RC out=$OUT calls=$(calls) settings=$(cat "$H/.oss/settings.json" 2>&1)"
# hostile choices: refused, settings.json untouched, nothing run
for nv in 'notify_style $(touch PWNED)' "notify_style visual'; touch PWNED; '" 'verbosity $(touch PWNED)' 'voice $(touch PWNED)' 'sound `touch PWNED`' 'voice Samantha
$(touch PWNED)'; do
    n=${nv%% *}; v=${nv#* }
    sandbox repo; cfg ossk_k1 https://api.example.invalid; echo '{"keep":1}' > "$H/.oss/settings.json"
    case "$n" in notify_style) model_writes notify_style "$v" verbosity all ;; verbosity) model_writes notify_style visual verbosity "$v" ;;
                 voice) model_writes notify_style audio verbosity all voice "$v" ;; sound) model_writes notify_style sound verbosity all sound "$v" ;; esac
    run_block settings.md "$SAVE"
    if pwned; then fail "settings: hostile $n is refused" "something ran"
    elif [[ "$RC" == 0 || "$(cat "$H/.oss/settings.json")" != '{"keep":1}' || "$(calls)" == *say* || "$(calls)" == *afplay* || "$(calls)" == *curl* ]]; then fail "settings: hostile $n is refused" "rc=$RC calls=$(calls) settings=$(cat "$H/.oss/settings.json")"
    else pass "settings: hostile $n '$v' is refused, settings.json untouched, nothing run"; fi
done

# --- oss-custom: the team command name is read from custom.txt --------------------------------
sandbox repo; model_writes custom review-standards; run_block oss-custom.md 'oss-value.sh decrypt custom'
[[ "$RC" == 0 && "$(calls)" == "oss-decrypt --type custom --name review-standards" ]] && pass "oss-custom: decrypts the name it read" || fail "oss-custom: decrypts the name it read" "rc=$RC out=$OUT calls=$(calls)"
for v in '$(touch PWNED)' 'team:review' "a'b" 'review
$(touch PWNED)' '../x'; do
    sandbox repo; model_writes custom "$v"; run_block oss-custom.md 'oss-value.sh decrypt custom'
    if pwned; then fail "oss-custom: hostile name is refused" "something ran"
    elif [[ "$RC" == 0 || -n "$(calls)" ]]; then fail "oss-custom: hostile name '$v' is refused" "rc=$RC calls=$(calls)"
    else pass "oss-custom: hostile name '$v' is refused, nothing decrypted"; fi
done

# --- watcher: the PID is read from .oss/watcher.pid and must be a number -----------------------
sleep_pid() { /bin/sleep 30 & SP=$!; }
sandbox repo; mkdir -p "$W/.oss"; sleep_pid; echo "$SP" > "$W/.oss/watcher.pid"; run_block watcher.md 'watcher.pid'
kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null
[[ "$RC" == 0 && "$OUT" == *"Running"* && "$OUT" == *"$SP"* ]] && pass "watcher: a live PID from the file reads as running" || fail "watcher: a live PID from the file reads as running" "rc=$RC out=$OUT"
sandbox repo; run_block watcher.md 'watcher.pid'
[[ "$OUT" == *"Stopped"* ]] && pass "watcher: no PID file reads as stopped" || fail "watcher: no PID file reads as stopped" "rc=$RC out=$OUT"
for v in '$(touch PWNED)' '1; touch PWNED' '12345678901' '-1' '1 1' '1,1'; do
    sandbox repo; mkdir -p "$W/.oss"; printf '%s\n' "$v" > "$W/.oss/watcher.pid"; run_block watcher.md 'watcher.pid'
    if pwned; then fail "watcher: PID '$v' is refused" "something ran"
    elif [[ "$OUT" != *"Stopped"* ]]; then fail "watcher: PID '$v' is refused" "out=$OUT"
    else pass "watcher: PID file '$v' reads as stopped, nothing run"; fi
done

# --- plugin root: computed with oss-value.sh root (webhook, login) ----------------------------
for lit in 'cli webhook-setup setup' 'cli webhook-toggle on' 'cli webhook-setup setup --port 8080'; do
    sandbox repo; run_block webhook.md "$lit"
    [[ "$RC" == 0 && "$(calls)" == "node $FR/watcher/dist/cli/webhook-"* ]] && pass "webhook: the block holding '$lit' runs the plugin root's script" || fail "webhook: the block holding '$lit' runs the plugin root's script" "rc=$RC out=$OUT calls=$(calls)"
done
sandbox repo; rm -f "$H/.oss/plugin-root"; run_block webhook.md 'cli webhook-setup setup'
[[ "$RC" != 0 && -z "$(calls)" ]] && pass "webhook: without a plugin root nothing runs" || fail "webhook: without a plugin root nothing runs" "rc=$RC calls=$(calls)"
sandbox repo; run_block login.md 'cli update-workflow-state init'
[[ "$RC" == 0 && "$(calls)" == "node $FR/watcher/dist/cli/update-workflow-state.js init" ]] && pass "login: workflow state init runs the plugin root's CLI" || fail "login: workflow state init runs the plugin root's CLI" "rc=$RC calls=$(calls)"
sandbox repo; echo 1 > "$T/curl.rc"; run_block login.md 'notification-icon.png"'
[[ "$(calls)" == *"sips -s format png $FR/assets/icon.png"* ]] && pass "login: the icon fallback converts the plugin root's icon" || fail "login: the icon fallback converts the plugin root's icon" "rc=$RC calls=$(calls)"
sandbox repo; run_block login.md 'Skipping daemon setup'
[[ "$RC" == 0 && "$OUT" != *Skipping* ]] && pass "login: the daemon check finds the plugin root's daemon folder" || fail "login: the daemon check finds the plugin root's daemon folder" "rc=$RC out=$OUT"
sandbox repo; run_block login.md 'npm run build'
[[ "$RC" == 0 && "$(calls)" != *npm* ]] && pass "login: the daemon build step runs in the plugin root (dist exists: no build)" || fail "login: the daemon build step runs in the plugin root (dist exists: no build)" "rc=$RC out=$OUT calls=$(calls)"
sandbox repo; run_block login.md 'oss-daemon.js</string>'
P="$H/Library/LaunchAgents/com.oneshotship.daemon.plist"
[[ "$RC" == 0 ]] && grep -qF "<string>$FR/daemon/bin/oss-daemon.js</string>" "$P" 2>/dev/null && pass "login: the plist names the plugin root's daemon" || fail "login: the plist names the plugin root's daemon" "rc=$RC out=$OUT plist=$(cat "$P" 2>&1 | head -3)"
sandbox repo; run_block login.md 'launchctl load "$PLIST_PATH"'
[[ "$RC" == 0 && "$(calls)" == *"launchctl load $H/Library/LaunchAgents/com.oneshotship.daemon.plist"* ]] && pass "login: the daemon load step loads the fixed plist path" || fail "login: the daemon load step loads the fixed plist path" "rc=$RC calls=$(calls)"
sandbox repo; run_block login.md 'start it manually with'
[[ "$OUT" == *"launchctl load $H/Library/LaunchAgents/com.oneshotship.daemon.plist"* ]] && pass "login: the daemon check names the fixed plist path" || fail "login: the daemon check names the fixed plist path" "out=$OUT"
sandbox repo; printf '#!/bin/sh\n' > "$H/.oss/oss-statusline.sh"; chmod +x "$H/.oss/oss-statusline.sh"; run_block login.md 'Status line script ready'
[[ "$OUT" == *"Status line script ready"* ]] && pass "login: the status line check uses the fixed script path" || fail "login: the status line check uses the fixed script path" "rc=$RC out=$OUT"

# --- oss-audio: status reads the three settings without running the file ----------------------
sandbox repo; printf 'export OSS_AUDIO_ENABLED="true"\nexport OSS_USE_VOICE="false"\nexport OSS_VOICE="Daniel"\n' > "$H/.oss/audio-config"; run_block oss-audio.md 'audio-config ]'
[[ "$RC" == 0 && "$OUT" == *"Enabled: true"* && "$OUT" == *"Mode: Sound"* && "$OUT" == *"Voice: Daniel"* ]] && pass "oss-audio: status shows the three settings" || fail "oss-audio: status shows the three settings" "rc=$RC out=$OUT"
sandbox repo; printf 'export OSS_AUDIO_ENABLED="true"\ntouch "$HOME/PWNED"\nexport OSS_VOICE="$(touch $HOME/PWNED)"\n' > "$H/.oss/audio-config"; run_block oss-audio.md 'audio-config ]'
! pwned && [[ "$OUT" == *"Enabled: true"* ]] && pass "oss-audio: status never runs the config file" || fail "oss-audio: status never runs the config file" "pwned=$(pwned && echo y || echo n) out=$OUT"

# --- visual-test: the key check reads the fixed config path ------------------------------------
sandbox repo; cfg ossk_k3 x; run_block visual-test.md '"apiKey"'
[[ "$OUT" == "API key configured" ]] && pass "visual-test: the key check reads ~/.oss/config.json" || fail "visual-test: the key check reads ~/.oss/config.json" "rc=$RC out=$OUT"

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
