#!/bin/bash
# Tests for oss_json_field in hooks/oss-api-curl.sh - how commands read a field of a server response.
#
# @behavior A field the server sends back is printed to the user's terminal without bytes that can drive
#           or spoof it: control characters (ESC, BEL, CR, C1) and bidi/zero-width characters are removed
#           inside jq, so the raw bytes never reach the shell. A missing or null field prints nothing.
# @business-rule Server text is untrusted; the same stripping rule as stripControl in packages/cli-decrypt.
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
HELPER="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/oss-api-curl.sh"
# shellcheck source=/dev/null
source "$HELPER"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = expected, $3 = got
    RUN=$((RUN + 1))
    if [[ "$2" == "$3" ]]; then echo "✓ PASS: $1"
    else echo "✗ FAIL: $1"; printf '    expected: %q\n    got:      %q\n' "$2" "$3"; FAILED=$((FAILED + 1)); fi
}

HOSTILE='{"chatId":"12\u001b[31m34\u0007\r56\u009b\u202e78\u200b9\u2066","linked":true,"n":42,"gone":null}'
check "strips ESC, BEL, CR, C1, U+202E, U+200B, U+2066 from a field (printable [31m stays)" "12[31m3456789" \
    "$(printf '%s' "$HOSTILE" | oss_json_field chatId)"
check "prints a boolean as true/false text" "true" "$(printf '%s' "$HOSTILE" | oss_json_field linked)"
check "prints a number as text" "42" "$(printf '%s' "$HOSTILE" | oss_json_field n)"
check "prints nothing for a null field" "" "$(printf '%s' "$HOSTILE" | oss_json_field gone)"
check "prints nothing for a missing field" "" "$(printf '%s' "$HOSTILE" | oss_json_field magicLink)"

# T38: line and paragraph separators, BOM, Arabic letter mark, soft hyphen, word joiner and an invisible tag
# character are removed too: every Unicode format character (Cf) plus U+2028/U+2029.
check "strips U+2028, U+2029, U+FEFF, U+061C, U+00AD, U+2060 and a tag character (U+E0041)" "abcdefgh" \
    "$(printf '%s' '{"p":"a\u2028b\u2029c\ufeffd\u061ce\u00adf\u2060g\udb40\udc41h"}' | oss_json_field p)"
# T38: at most one line, from one JSON object: several documents, or a value that is not an object, give nothing.
check "two concatenated objects print nothing (not one line per object)" "" \
    "$(printf '%s' '{"p":"pro"}{"p":"trial"}' | oss_json_field p)"
check "two objects on two lines print nothing" "" \
    "$(printf '%s\n%s\n' '{"p":"pro"}' '{"p":"trial"}' | oss_json_field p)"
check "an array of objects prints nothing" "" "$(printf '%s' '[{"p":"pro"}]' | oss_json_field p)"
check "a field holding an object prints one line of compact JSON (its newline stays escaped)" '{"a":"b\nc"}' \
    "$(printf '%s' '{"p":{"a":"b\nc"}}' | oss_json_field p)"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
