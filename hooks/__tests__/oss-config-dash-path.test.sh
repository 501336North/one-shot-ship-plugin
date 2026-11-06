#!/bin/bash
# The config path is never an option to jq or node (T39).
#
# @behavior oss_config_strings (hooks/oss-api-curl.sh) reads a config whose path starts with "-" (a relative
#           OSS_CONFIG_DIR such as "-cfg") as a path, with jq and without it (node): oss_api_key gives its key and
#           oss_api_url its URL. A config dir named like a node option (--eval=CODE//) runs no code.
# @business-rule The config path is data: whatever OSS_CONFIG_DIR holds, it names a file and never changes what
#           jq or node do.
# @boundary oss-api-curl.sh helpers (system boundary); no network.
#
# Usage:   /bin/bash hooks/__tests__/oss-config-dash-path.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
HOOKS="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-config-dash-path tests..."
command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is needed for the jq branch"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ FAIL: node is needed for the no-jq branch"; exit 1; }

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
PATH="$KS/nojq" command -v node >/dev/null 2>&1 || { echo "✗ FAIL: node missing from the no-jq PATH"; exit 1; }
mode_path() { case "$1" in (jq) printf '%s' "$PATH" ;; (*) printf '%s' "$KS/nojq" ;; esac; }

VALID='{"apiKey":"fake-key-D","apiUrl":"https://dev.example.com"}'

# helper <mode> <config dir name> <function> : writes a valid config at ./<dir>/config.json in a fresh work dir,
# runs the function there with OSS_CONFIG_DIR=<dir>; sets OUT, RC and W (the work dir).
helper() {
    W=$(mktemp -d "$KS/w.XXXXXX"); mkdir -p "$W/home" "$W/$2"
    printf '%s' "$VALID" > "$W/$2/config.json"
    RC=0
    OUT=$(cd "$W" && HOME="$W/home" OSS_CONFIG_DIR="$2" PATH="$(mode_path "$1")" \
        run_capped 20 /bin/bash -c 'source "$1"; '"$3" _ "$HOOKS/oss-api-curl.sh" </dev/null 2>/dev/null) || RC=$?
}

for MODE in jq nojq; do
    helper "$MODE" -cfg oss_api_key
    name="[$MODE] oss_api_key: a config dir named -cfg is a path, not options"
    if [[ $RC == 0 && "$OUT" == fake-key-D ]]; then pass "$name"; else fail "$name" "rc=$RC out=$(printf '%q' "$OUT")"; fi

    helper "$MODE" -cfg oss_api_url
    name="[$MODE] oss_api_url: a config dir named -cfg is a path, not options"
    if [[ $RC == 0 && "$OUT" == https://dev.example.com ]]; then pass "$name"; else fail "$name" "rc=$RC out=$(printf '%q' "$OUT")"; fi

    # The probe's effect is a file node itself writes in the work dir, so nothing the helper prints can hide it.
    helper "$MODE" '--eval=require("fs").writeFileSync("pwned","")//' oss_api_key
    name="[$MODE] oss_api_key: a config dir named --eval=CODE runs no code and is read as a path"
    if [[ ! -e "$W/pwned" && $RC == 0 && "$OUT" == fake-key-D ]]; then pass "$name"
    else fail "$name" "pwned=$([[ -e "$W/pwned" ]] && echo y || echo n) rc=$RC out=$(printf '%q' "$OUT")"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
