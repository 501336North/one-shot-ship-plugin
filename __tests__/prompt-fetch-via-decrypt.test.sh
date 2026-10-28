#!/bin/bash
# Agents, skills and commands fetch their prompt only through oss-decrypt (release channels US-003, ADR-005).
#
# @behavior Each file that fetched a prompt with a WebFetch of the OSS API now runs
#           `~/.oss/bin/oss-decrypt --type <type> --name <name>` for the SAME prompt it fetched before. The
#           mapping is frozen in __tests__/fixtures/prompt-fetch-map.tsv, generated from the old URLs before
#           any file was converted, so the conversion cannot quietly point a file at a different prompt.
#           oss-decrypt follows apiUrl, checks the manifest signature and the prompt hash, and keeps the key out
#           of the model's context. No file prints the API key into the transcript (follow-up #44), and no
#           fetch line carries model-written text (follow-up #69).
# @business-rule On STAGING every prompt comes from staging, and every prompt a customer runs is verified.
#
# Rows marked blocked-by:T9 (performance-auditor, visionos-developer) wait until their production prompts
# pass the integrity check (the API hotfix); until then they may keep their old fetch step.
#
# Usage: ./__tests__/prompt-fetch-via-decrypt.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAP="$ROOT/__tests__/fixtures/prompt-fetch-map.tsv"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = offending lines (empty = pass)
    RUN=$((RUN + 1))
    if [[ -z "$2" ]]; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; printf '%s\n' "$2" | head -12 | sed 's/^/    /'
        [[ $(printf '%s\n' "$2" | wc -l) -gt 12 ]] && echo "    … $(( $(printf '%s\n' "$2" | wc -l) - 12 )) more"; FAILED=$((FAILED + 1)); fi
}
cd "$ROOT" || exit 1

BLOCKED=$(awk -F'\t' '$4 == "blocked-by:T9" { print $1 }' "$MAP")
is_blocked() { grep -qxF "$1" <<<"$BLOCKED"; }

rows=$(awk -F'\t' 'END { print NR }' "$MAP")
[[ "$rows" == 99 ]]; check "the frozen map holds the 99 prompt fetches found on 2026-10-26" "$([[ "$rows" == 99 ]] || echo "rows=$rows")"

# 1. No WebFetch of a prompt, outside the blocked rows.
left=""
while IFS= read -r f; do is_blocked "$f" || left="$left$f"$'\n'; done \
    < <(git grep -l -F 'URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/' -- agents skills commands)
check "no agent, skill or command WebFetches a prompt from the OSS API" "${left%$'\n'}"

# 2. Each converted file fetches the same prompt as before, through oss-decrypt.
wrong=""
while IFS=$'\t' read -r f t n st; do
    [[ "$st" == convert ]] || continue
    grep -qxF "~/.oss/bin/oss-decrypt --type $t --name $n" "$f" || wrong="$wrong$f (expected: --type $t --name $n)"$'\n'
done < "$MAP"
check "each converted file runs oss-decrypt for the prompt it used to fetch" "${wrong%$'\n'}"

# 2b. FR2 (ship round 1): each converted file installs the CLI first, because on a fresh install
#     ~/.oss/bin/oss-decrypt does not exist yet (the old WebFetch steps needed no local binary).
noinst=""
while IFS=$'\t' read -r f t n st; do
    [[ "$st" == convert ]] || continue
    e=$(grep -n '^~/\.oss/hooks/ensure-decrypt-cli\.sh ' "$f" | head -1 | cut -d: -f1)
    d=$(grep -nxF "~/.oss/bin/oss-decrypt --type $t --name $n" "$f" | head -1 | cut -d: -f1)
    [[ -n "$e" && -n "$d" && "$e" -lt "$d" ]] || noinst="$noinst$f"$'\n'
done < "$MAP"
check "each converted file runs ensure-decrypt-cli.sh before oss-decrypt" "${noinst%$'\n'}"

# 3. No converted file still tells the model to WebFetch.
wf=$(awk -F'\t' '$4 == "convert" { print $1 }' "$MAP" | while IFS= read -r f; do grep -n 'WebFetch' "$f" | sed "s#^#$f:#"; done)
check "no converted file mentions WebFetch" "$wf"

# 4. #44: no file prints the API key into the transcript.
check "no agent, skill or command prints the API key (cat config.json | grep apiKey)" \
    "$(git grep -n -E 'cat ~/\.oss/config\.json[^|]*\| *grep apiKey' -- agents skills commands)"

# 5. #69: no prompt-fetch line carries model-written text.
ctx=""
while IFS= read -r l; do f=${l%%:*}; is_blocked "$f" || ctx="$ctx$l"$'\n'; done \
    < <(git grep -n -E '\?context=|\{user_context\}' -- agents skills commands)
check "no prompt fetch carries model-written text (?context= / {user_context})" "${ctx%$'\n'}"

# 6. skills/ideate.md's template fetch goes through the helpers (no undefined API_BASE, no key in a header).
check "skills/ideate.md fetches the CLAUDE.md template through oss_api_curl" \
    "$(grep -nE 'API_BASE|Bearer \$\{API_KEY\}' skills/ideate.md)"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
