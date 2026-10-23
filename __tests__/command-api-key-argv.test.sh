#!/bin/bash
# Bash snippets in commands/*.md that call the OSS API must follow the hooks' rules for the key and the URL.
#
# @behavior No snippet puts the API key on a curl command line (-H "Authorization: Bearer $KEY" is visible
#           to every local user via ps); they call oss_api_curl, which hands it to curl on stdin. No snippet
#           reads .apiUrl itself (that read had no https check and defaulted to api.oneshotship.com, which does
#           not resolve); they call oss_api_url. Every bash block using either helper sources it first.
# @business-rule One source for "which URL may the key go to" (IRON LAW #1b): hooks/oss-api-curl.sh.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = offending lines (empty = pass)
    RUN=$((RUN + 1))
    if [[ -z "$2" ]]; then echo "✓ PASS: $1"
    else echo "✗ FAIL: $1"; printf '    %s\n' "$2"; FAILED=$((FAILED + 1)); fi
}

check "no command puts the API key on a curl command line (Authorization: Bearer \$...)" \
    "$(grep -n 'Authorization: Bearer \$' "$ROOT"/commands/*.md)"
check "no command reads .apiUrl itself (use oss_api_url)" \
    "$(grep -n '\.apiUrl' "$ROOT"/commands/*.md)"
check "no command reads .apiKey itself (use oss_api_key: same config dir as oss_api_url and the CLI)" \
    "$(grep -n '\.apiKey' "$ROOT"/commands/*.md)"
check "every apiUrl error in a command uses the current rule wording" \
    "$(grep -n 'apiUrl in ' "$ROOT"/commands/*.md | grep -vF 'apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment')"
check "every API_URL= in a command comes from oss_api_url" \
    "$(grep -n 'API_URL=' "$ROOT"/commands/*.md | grep -v 'API_URL=\$(oss_api_url)')"
check "no command names the unresolvable api.oneshotship.com (not in a curl, not in an allowlist)" \
    "$(grep -nE 'api\.oneshotship\.com' "$ROOT"/commands/*.md)"
check "telegram.md reads every server field through oss_json_field (control/bidi stripped in jq), never raw jq -r" \
    "$(grep -n 'jq -r' "$ROOT"/commands/telegram.md)"
# Each ```bash block runs as its own shell, so each one that calls a helper must source it.
check "every bash block calling oss_api_url/oss_api_key/oss_api_curl sources ~/.oss/hooks/oss-api-curl.sh" \
    "$(awk '/^```bash/{inb=1; src=0; use=0; start=FNR; next}
            inb && /^```/{ if (use && !src) print FILENAME ":" start; inb=0; next}
            inb && /source ~\/\.oss\/hooks\/oss-api-curl\.sh/{src=1}
            inb && /oss_api_(url|curl|key)/ && !/source /{use=1}' "$ROOT"/commands/*.md)"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
