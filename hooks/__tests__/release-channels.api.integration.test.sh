#!/bin/bash
# Integration (no fakes on either side of the wire): the plugin's hooks and decrypt CLI against the REAL OSS API,
# booted from an API checkout on 127.0.0.1 (release channels, ship round 2 /oss:integration).
#
# @behavior The unit suites fake the API: packages/cli-decrypt tests serve a fake ?base=1, the shell suites stub curl
#           for ?part=custom, and the API's workflow-name fixture is a copy of the plugin's names. This test checks
#           those fakes against the real thing: the CLI's IRON LAWS request carries ?base=1 and the API answers it with
#           exactly the bytes its signed manifest hashes; the hooks' team-laws section is exactly the section the API
#           appends for today's stable plugin; every workflow name the plugin fetches has a signed manifest entry; and
#           a channel home that is a symlink (~/.oss -> ~/.oss-beta) works with the real status line, value helper and
#           CLI setup.
# @business-rule Prompts are delivered only when they match the signed manifest; team laws still reach CLAUDE.md,
#           marked unverified; a staging/DEV session says so in the status line.
# @boundary Real API (in-memory database double, manifest signed at startup with a THROWAWAY key made by the harness;
#           the real staging/production keys are never used), real curl, real oss-decrypt bundle, temp HOMEs.
#
# The shipped bundle pins the real staging key for a loopback address, so it must REFUSE this manifest (asserted);
# the signature path is then exercised by the CLI's own decryptCommand (packages/cli-decrypt/src) with the throwaway
# key injected as its staging key (hooks/__tests__/api-integration/decrypt-with-key.ts).
#
# Usage: OSS_API_REPO=/path/to/AgenticDevWorkflow-checkout ./hooks/__tests__/release-channels.api.integration.test.sh
#        (the checkout needs `npm install` done; nothing in it is written). Without OSS_API_REPO it prints SKIP.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/hooks/__tests__/api-integration"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
check() { if [[ "$2" == 0 ]]; then pass "$1"; else fail "$1" "$3"; fi; }

API_REPO="${OSS_API_REPO:-}"
if [[ -z "$API_REPO" ]]; then
    echo "SKIP: OSS_API_REPO is not set (path to an API checkout with node_modules) — the real-API integration test was NOT run"
    exit 0
fi
API_SRC="$API_REPO/packages/api"
TSX="$API_REPO/node_modules/.bin/tsx"
for need in "$API_SRC/src/index.ts" "$TSX"; do
    [[ -e "$need" ]] || { echo "SKIP: $need not found (is OSS_API_REPO an API checkout with npm install done?) — NOT run"; exit 0; }
done
for cmd in node jq curl git; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "SKIP: $cmd not found — the real-API integration test was NOT run"; exit 0; }
done

T="$(mktemp -d)"; API_PID=""
cleanup() { [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
# Every curl here, the test's own and the hooks', must ignore a default .curlrc (TR8: -q first; the user's ~/.curlrc
# could otherwise change what is compared). A hostile one is planted where curl looks first, so a missing -q fails.
mkdir -p "$T/curlhome"; printf 'write-out = "HOSTILE-CURLRC"\n' > "$T/curlhome/.curlrc"; export CURL_HOME="$T/curlhome"

# --- the real API, on loopback, never reading the checkout's .env (cwd is an empty dir, HOME a temp dir) -------------
mkdir -p "$T/api" "$T/apicwd" "$T/apihome"
(cd "$T/apicwd" && exec env -i PATH="$PATH" HOME="$T/apihome" NODE_ENV=test NODE_PATH="$API_REPO/node_modules" \
    API_SRC="$API_SRC" OUT="$T/api" "$TSX" "$HERE/api-harness.ts" >"$T/api.log" 2>&1) &
API_PID=$!
for _ in $(seq 1 120); do [[ -f "$T/api/ready" ]] && break; kill -0 "$API_PID" 2>/dev/null || break; sleep 0.5; done
if [[ ! -f "$T/api/ready" ]]; then
    fail "the real API boots on 127.0.0.1" "$(tail -n 15 "$T/api.log")"
    echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi
API=$(jq -r .url "$T/api/api.json"); TEAM_KEY=$(jq -r .team "$T/api/api.json"); NONE_KEY=$(jq -r .none "$T/api/api.json")
PUB=$(cat "$T/api/pub.b64")
case "$API" in http://127.0.0.1:[0-9]*) ;; *) fail "the API listens on loopback" "url: $API"; exit 1 ;; esac
log_has() { grep -qE "^[0-9]+ $1( |$)" "$T/api/requests.log"; }

# --- a channel home: ~/.oss is a symlink to ~/.oss-beta (0700), config 0600 naming the loopback API -----------------
H="$T/home"; mkdir -p "$H/proj"; mkdir -m 700 "$H/.oss-beta"; ln -s .oss-beta "$H/.oss"
(umask 077
 printf '{"apiKey":"%s","apiUrl":"%s"}' "$TEAM_KEY" "$API" > "$H/.oss-beta/config.json"
 printf '%s\n' "$ROOT" > "$H/.oss-beta/plugin-root"
 mkdir "$H/.oss-beta/bin"
 # The installed CLI, as the hooks run it: the real decryptCommand with the throwaway key as its staging key.
 printf '#!/bin/bash\n[[ "$*" == "--type shared --name iron-laws" ]] || exit 9\nCLI_SRC="%s" PUB="%s" exec "%s" "%s"\n' \
     "$ROOT/packages/cli-decrypt/src" "$PUB" "$TSX" "$HERE/decrypt-with-key.ts" > "$H/.oss-beta/bin/oss-decrypt")
chmod 700 "$H/.oss-beta/bin/oss-decrypt"
inhome() { (cd "$H/proj" && env -u OSS_CONFIG_DIR -u CLAUDE_PLUGIN_ROOT HOME="$H" CLAUDE_PROJECT_DIR="$H/proj" \
    perl -e 'alarm 60; exec @ARGV' "$@"); }
BUNDLE="$ROOT/packages/cli-decrypt/dist/oss-decrypt.cjs"

# 1. the symlinked channel home with the real status line, oss_api_url, oss-value root and CLI setup
line=$(printf '{"model":{"display_name":"M"},"workspace":{"current_dir":"%s"}}' "$H/proj" | inhome bash "$ROOT/hooks/oss-statusline.sh")
[[ "$line" == "⚠ STAGING"* ]]; check "the status line opens with STAGING for a loopback API in a symlinked ~/.oss" $? "line: $line"
url=$(inhome bash -c 'source "$1" && oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh")
[[ "$url" == "$API" ]]; check "oss_api_url returns the loopback origin through the ~/.oss symlink" $? "got: $url"
root=$(inhome bash "$ROOT/hooks/oss-value.sh" root)
[[ "$root" == "$ROOT" ]]; check "oss-value.sh root reads plugin-root through the ~/.oss symlink" $? "got: $root"
inhome node "$BUNDLE" --setup >"$T/setup.out" 2>&1
rc=$?; [[ $rc == 0 && -f "$H/.oss-beta/credentials.enc" && -L "$H/.oss" ]] && log_has "GET /api/v1/auth/credentials\?hardwareId=[0-9a-f]+ 200"
check "the real CLI bundle's --setup gets credentials from the real API and stores them in ~/.oss-beta" $? \
    "rc=$rc out: $(cat "$T/setup.out") files: $(ls -A "$H/.oss-beta" | tr '\n' ' ')"

# 2. CLI ?base=1 vs the real route: URL, bytes, manifest hash; the bundle refuses the throwaway-signed manifest
inhome node "$BUNDLE" --type shared --name iron-laws >"$T/bundle.out" 2>"$T/bundle.err"; rc=$?
base_line=$(grep -E '^[0-9]+ GET /api/v1/prompts/shared/iron-laws\?base=1 200 ' "$T/api/requests.log" | tail -n 1)
[[ -n "$base_line" ]]; check "the real CLI bundle asks the real API for shared/iron-laws?base=1 (answered 200)" $? \
    "log: $(grep iron-laws "$T/api/requests.log" | tr '\n' ' ')"
[[ $rc != 0 && ! -s "$T/bundle.out" ]] && grep -q 'Manifest signature verification FAILED' "$T/bundle.err"
check "the bundle (staging key pinned for loopback) refuses a manifest the real staging key did not sign, printing nothing" $? \
    "rc=$rc err: $(tail -n 1 "$T/bundle.err")"
curl -q -s "$API/api/v1/prompts/manifest" > "$T/manifest.json"
signed_hash=$(jq -r '.prompts["shared/iron-laws"].hash' "$T/manifest.json")
served_hash=$(printf '%s' "$base_line" | cut -d' ' -f5)
[[ -n "$served_hash" && "$served_hash" == "$signed_hash" ]]
check "the API's answer to exactly that request hashes to the manifest's shared/iron-laws entry" $? \
    "served $served_hash, manifest $signed_hash"
inhome "$H/.oss/bin/oss-decrypt" --type shared --name iron-laws >"$T/verified.out" 2>"$T/verified.err"; rc=$?
curl -q -s -H "Authorization: Bearer $TEAM_KEY" "$API/api/v1/prompts/shared/iron-laws?base=1" > "$T/base.body"
{ cat "$T/base.body"; echo; } | cmp -s - "$T/verified.out" && [[ $rc == 0 ]] && grep -q 'Prompt hash: verified' "$T/verified.err"
check "the CLI's decryptCommand verifies signature and hash against the real API and prints the signed file" $? \
    "rc=$rc err: $(tr '\n' ' ' < "$T/verified.err")"

# 3. ?part=custom: the hook's section is the team section the API appends for the stable plugin
curl -q -s -H "Authorization: Bearer $TEAM_KEY" "$API/api/v1/prompts/shared/iron-laws?part=custom" > "$T/part.body"
curl -q -s -H "Authorization: Bearer $TEAM_KEY" "$API/api/v1/prompts/shared/iron-laws" > "$T/legacy.body"
{ cat "$T/base.body"; printf '\n\n'; cat "$T/part.body"; } | cmp -s - "$T/legacy.body"
check "the API's legacy body is exactly the signed file, a blank line, then the ?part=custom section" $? \
    "legacy $(wc -c < "$T/legacy.body") bytes, base $(wc -c < "$T/base.body"), part $(wc -c < "$T/part.body")"
inhome bash -c 'source "$1" && oss_custom_iron_laws' _ "$ROOT/hooks/oss-api-curl.sh" > "$T/hook.out"; rc=$?
printf '%s\n' "$(cat "$T/part.body")" | cmp -s - "$T/hook.out" && [[ $rc == 0 ]] \
    && head -n 1 "$T/hook.out" | grep -qx '## Custom Team Laws' && grep -qx '### Use Tailwind' "$T/hook.out" \
    && ! grep -q 'DISABLED-LAW-TEXT' "$T/hook.out" && ! grep -q '^---' "$T/hook.out"
check "oss_custom_iron_laws prints the API's team section (heading, sanitised, enabled laws only)" $? \
    "rc=$rc hook: $(head -c 300 "$T/hook.out")"
mkdir -m 700 "$T/none"; (umask 077; printf '{"apiKey":"%s","apiUrl":"%s"}' "$NONE_KEY" "$API" > "$T/none/config.json")
out=$(env OSS_CONFIG_DIR="$T/none" HOME="$H" bash -c 'source "$1" && oss_custom_iron_laws' _ "$ROOT/hooks/oss-api-curl.sh"); rc=$?
[[ $rc == 1 && -z "$out" ]] && log_has "GET /api/v1/prompts/shared/iron-laws\?part=custom 200 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 0"
check "a user with no laws gets an empty 200 from the API and nothing from oss_custom_iron_laws" $? "rc=$rc out: $out"

# end to end: the real hooks (with a stub installer) write the verified laws, then the unverified team section
mkdir "$T/hooks"; cp "$ROOT/hooks/fetch-iron-laws.sh" "$ROOT/hooks/oss-iron-laws-sync.sh" "$ROOT/hooks/oss-api-curl.sh" "$T/hooks/"
printf '#!/bin/bash\nexit 0\n' > "$T/hooks/ensure-decrypt-cli.sh"; chmod +x "$T/hooks/"*.sh
inhome bash "$T/hooks/fetch-iron-laws.sh" --raw >"$T/fetch.out" 2>"$T/fetch.err"; rc=$?
{ printf '%s\n' "$(cat "$T/base.body")"; printf '\n%s\n\n' '> Team/personal laws below are not covered by the signed prompt manifest (unverified).'
  cat "$T/hook.out"; printf '\n%s\n' '> End of unverified team/personal laws.'; } | cmp -s - "$T/fetch.out" && [[ $rc == 0 ]]
check "fetch-iron-laws.sh prints the verified laws, the unverified note, the API's team section, then the closing line" $? \
    "rc=$rc err: $(tail -n 2 "$T/fetch.err")"
inhome bash "$T/hooks/oss-iron-laws-sync.sh" --install >/dev/null 2>"$T/sync.err"; rc=$?
[[ $rc == 0 ]] && grep -qx '## Custom Team Laws' "$H/proj/CLAUDE.md" && grep -qF 'not covered by the signed prompt manifest' "$H/proj/CLAUDE.md" \
    && grep -q 'IRON LAW' "$H/proj/CLAUDE.md" && ! grep -q 'DISABLED-LAW-TEXT' "$H/proj/CLAUDE.md"
check "oss-iron-laws-sync.sh --install writes the verified laws and the team section into CLAUDE.md" $? \
    "rc=$rc err: $(tail -n 2 "$T/sync.err")"

# 4. every workflow name the plugin fetches has a signed workflows/<name> entry; the API's fixture is current
(cd "$ROOT" && git grep -ohE -- '--type workflows --name [a-z0-9-]+') | sed 's/.*--name //' | sort -u > "$T/names"
missing=""
while IFS= read -r n; do
    jq -e --arg k "workflows/$n" '.prompts[$k].hash' "$T/manifest.json" >/dev/null || missing="$missing $n"
done < "$T/names"
count=$(wc -l < "$T/names" | tr -d ' ')   # before the test: a $(...) in check's arguments would reset $?
[[ -s "$T/names" && -z "$missing" ]]; check "each of the plugin's $count workflow names has a signed manifest entry" $? "missing:$missing"
FIX="$API_SRC/test/fixtures/plugin-workflow-names.txt"
if [[ -f "$FIX" ]]; then
    grep -vE '^(#|$)' "$FIX" | sort -u | cmp -s - "$T/names"
    check "the API's plugin-workflow-names.txt fixture lists exactly the plugin's current names" $? \
        "drift: $(grep -vE '^(#|$)' "$FIX" | sort -u | diff - "$T/names" | grep '^[<>]' | tr '\n' ' ')"
else
    fail "the API's plugin-workflow-names.txt fixture exists" "$FIX not found"
fi

grep -q 'onrender' "$T/api/requests.log" && fail "nothing left loopback" "log names onrender"
echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
