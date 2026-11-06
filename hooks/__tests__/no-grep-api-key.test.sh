#!/bin/bash
# Guard: no shipped hook reads the config's apiKey with grep/sed/awk/cut (T56).
#
# @behavior Every hook that needs the customer's API key gets it through hooks/oss-api-curl.sh
#           (oss_config_strings / oss_api_creds), never by text-parsing config.json.
# @business-rule A grep-parsed key ignores the one-JSON-object rule, the regular-file check and the
#           apiUrl the key belongs to, so it can send a dev key to production or a key to the wrong
#           URL. The unwired copies oss-session-start-new.sh and oss-session-start-test.sh did exactly
#           that and were deleted; re-adding such a reader fails here.
#
# Usage: ./hooks/__tests__/no-grep-api-key.test.sh
set -uo pipefail
# This guard runs no hook (it only reads hooks/*.sh); the unset keeps tests-hermetic-env's rule (T29).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

# Prints "file:line: text" for each non-comment line of the given files that names apiKey and runs a
# text tool on it.
grep_key_reads() {
  awk '/^[[:space:]]*#/ { next }
       /apiKey/ && /(^|[^A-Za-z0-9_-])(grep|sed|awk|cut)([^A-Za-z0-9_-]|$)/ { print FILENAME ":" FNR ": " $0 }' "$@"
}

T=$(mktemp -d "${TMPDIR:-/tmp}/no-grep-api-key.XXXXXX")
trap 'rm -rf "$T"' EXIT

# Anti-vacuity: a synthetic grep-parse line is flagged; an oss_api_creds line is clean.
printf '%s\n' "API_KEY=\$(grep -o '\"apiKey\"[[:space:]]*:[[:space:]]*\"[^\"]*\"' \"\$CONFIG_FILE\" | cut -d'\"' -f4)" > "$T/bad.sh"
printf '%s\n' 'oss_api_creds || true' 'CFG=$(oss_config_strings apiKey,apiUrl) || exit 0' '# grep apiKey in a comment' > "$T/good.sh"
if [[ -n "$(grep_key_reads "$T/bad.sh")" ]]; then pass "control: a grep-parsed apiKey line is flagged"
else fail "control: a grep-parsed apiKey line is flagged" "the detector missed it"; fi
if [[ -z "$(grep_key_reads "$T/good.sh")" ]]; then pass "control: oss_api_creds / oss_config_strings lines are clean"
else fail "control: oss_api_creds / oss_config_strings lines are clean" "$(grep_key_reads "$T/good.sh")"; fi

# Anti-vacuity: the scan sees the shipped hooks (more than 30 files, including the helper itself).
HOOKS=()
for f in "$ROOT"/hooks/*.sh; do [[ -f "$f" ]] && HOOKS+=("$f"); done
if (( ${#HOOKS[@]} > 30 )); then pass "control: the scan sees ${#HOOKS[@]} hook files"
else fail "control: the scan sees more than 30 hook files" "saw ${#HOOKS[@]}"; fi
if grep -q 'oss_config_strings apiKey' "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null; then
  pass "control: the helper that hooks must use reads apiKey"
else
  fail "control: the helper that hooks must use reads apiKey" "hooks/oss-api-curl.sh has no oss_config_strings apiKey"
fi

found=$(grep_key_reads "${HOOKS[@]}" | sed "s|^$ROOT/||")
if [[ -z "$found" ]]; then pass "no hook reads apiKey with grep/sed/awk/cut"
else fail "no hook reads apiKey with grep/sed/awk/cut (use oss_api_creds / oss_config_strings)" $'\n'"$found"; fi

echo "Results: $((RUN-FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
