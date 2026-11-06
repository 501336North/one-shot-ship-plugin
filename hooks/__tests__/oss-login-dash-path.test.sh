#!/bin/bash
# /oss:login saves the key into a config whose path starts with "-" (T44, same class as T39).
#
# @behavior With a relative OSS_CONFIG_DIR such as "-cfg", /oss:login saves the key in -cfg/config.json:
#           an existing config keeps its other settings, a missing one (and its folder) is created, and the
#           file is owner-only (600) with no temp file left behind.
# @business-rule The config path is data: whatever OSS_CONFIG_DIR holds, it names a file and is never read
#           as an option by jq, mkdir, mktemp, chmod or mv.
# @boundary Sandbox HOME and cwd outside any repo. curl is a stub that prints a canned "<body>\n200";
#           the real jq writes the config. No network, never the real ~/.oss.
#           The cases run twice: with the native tools, then with GNU coreutils chmod, mkdir, mktemp and mv
#           first on PATH (Linux behaviour: GNU getopt permutes, so `chmod 600 -cfg/x` reads -cfg as options,
#           where BSD chmod stops at the mode). On macOS that pass needs coreutils (gchmod, gmkdir, gmktemp,
#           gmv); without them it is reported SKIPPED, never counted as passed.
#
# Usage: /bin/bash hooks/__tests__/oss-login-dash-path.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/oss-login-dash-path.test.sh  (mutants)
set -uo pipefail
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/run-capped.sh"   # the one time cap a test may use (T49)
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-login-dash-path tests..."

REAL_JQ=$(command -v jq) || { echo "✗ FAIL: jq is required"; exit 1; }
# A developer's exported overrides must not lead the hook to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT
H="$T/home"; W="$T/w/cwd"; mkdir -p "$H/.oss/hooks" "$T/bin" "$W"
for f in oss-login.sh oss-value.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$f" "$H/.oss/hooks/"; done
printf '#!/bin/sh\ncat "%s/curl.out"\n' "$T" > "$T/bin/curl"; chmod +x "$T/bin/curl"
printf '{"plan":"pro"}\n200\n' > "$T/curl.out"

RND=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
KEY="ossk_Dash-Key_$RND"
C="$W/-cfg/config.json"

GNU=""   # a dir of GNU coreutils shims, put after the stubs on PATH for the second pass
# in_sandbox cmd... ; with SANDBOX_CAP=N set, the run goes through run_capped N (its own process group, killed whole).
in_sandbox() { (cd "$W" && ${SANDBOX_CAP:+run_capped "$SANDBOX_CAP"} env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w" HOME="$H" PATH="$T/bin${GNU:+:$GNU}:$PATH" "$@"); }
# login: key.txt holds $KEY, the API accepts it, OSS_CONFIG_DIR=-cfg (relative to the cwd); sets OUT, RC.
login() {
    local d; d=$(in_sandbox /bin/bash "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null)
    [[ -n "$d" ]] || { OUT="(oss-value.sh dir printed nothing)"; RC=99; return; }
    printf '%s\n' "$KEY" > "$d/key.txt"
    OUT=$(SANDBOX_CAP=20 in_sandbox env OSS_CONFIG_DIR=-cfg /bin/bash "$H/.oss/hooks/oss-login.sh" \
        2>"$T/login.err" </dev/null); RC=$?
}
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
err_shown() { sed "s/$KEY/<KEY>/g" "$T/login.err" | tr '\n' ' '; }
no_temp() { [[ -z "$(ls -A "$W/-cfg" 2>/dev/null | grep '^config\.json\.')" ]]; }

run_cases() {   # $1: label of the pass
# --- 1. An existing config in a dir named -cfg ---
rm -rf "$W/-cfg"; mkdir -p "$W/-cfg"
printf '{"apiUrl":"https://x.invalid","other":1}\n' > "$C"
login
name="[$1] existing config in -cfg: login succeeds and saves the key, other settings kept, 600, no temp file"
if [[ $RC == 0 && "$OUT" == "Plan: pro" \
      && "$("$REAL_JQ" -c . "$C" 2>/dev/null)" == "{\"apiUrl\":\"https://x.invalid\",\"other\":1,\"apiKey\":\"$KEY\"}" \
      && "$(mode_of "$C")" == 600 ]] && no_temp; then pass "$name"
else fail "$name" "rc=$RC out='$OUT' err=$(err_shown) cfg=$(sed "s/$KEY/<KEY>/g" "$C" 2>&1) mode=$(mode_of "$C" 2>&1)"; fi

# --- 2. No config and no -cfg dir yet: login creates both ---
rm -rf "$W/-cfg"
login
name="[$1] new config in -cfg: login creates the dir and a config with the key and the API URL, 600, no temp file"
if [[ $RC == 0 && "$OUT" == "Plan: pro" && "$("$REAL_JQ" -r .apiKey "$C" 2>/dev/null)" == "$KEY" \
      && "$("$REAL_JQ" -r .apiUrl "$C" 2>/dev/null)" == https://* && "$(mode_of "$C")" == 600 ]] && no_temp; then pass "$name"
else fail "$name" "rc=$RC out='$OUT' err=$(err_shown) cfg=$(sed "s/$KEY/<KEY>/g" "$C" 2>&1)"; fi
}

run_cases native
# --- 3. The same cases with GNU coreutils first on PATH ---
if chmod --version 2>/dev/null | grep -q coreutils; then
    echo "GNU pass: the native tools are already GNU coreutils — covered by the cases above"
elif command -v gchmod gmkdir gmktemp gmv >/dev/null 2>&1 && [[ $(command -v gchmod gmkdir gmktemp gmv | wc -l) -eq 4 ]]; then
    GNU="$T/gnu"; mkdir -p "$GNU"
    for b in chmod mkdir mktemp mv; do ln -s "$(command -v "g$b")" "$GNU/$b"; done
    if [[ "$(in_sandbox chmod --version 2>/dev/null | head -1)" == *coreutils* ]]; then pass "[gnu] chmod on the sandbox PATH is GNU coreutils (anchor)"
    else fail "[gnu] chmod on the sandbox PATH is GNU coreutils (anchor)" "$(in_sandbox command -v chmod)"; fi
    run_cases gnu
else
    echo "SKIPPED: GNU pass — no GNU coreutils (install coreutils for gchmod, gmkdir, gmktemp, gmv); NOT counted as passed"
fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
