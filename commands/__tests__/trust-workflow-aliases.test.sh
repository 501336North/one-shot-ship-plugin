#!/bin/bash
# /oss:trust audits each served prompt once (R-273 P6).
#
# The signed manifest also lists each command under its workflow aliases (`workflows/<name>`): the same file, the
# same hash. /oss:trust builds its audit list from `oss-decrypt --list-prompts`, so without a rule the model would
# decrypt and scan the same file two or three times and count it that many times in the report.
#
# @behavior A user running /oss:trust sees each command audited once, under its command name; a workflow that is
#           its own file (its hash matches no command) is still audited.
# @business-rule One file, one audit entry, whatever names the manifest serves it under.
set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
check() {  # $1 = description, then the command
    RUN=$((RUN + 1))
    if "${@:2}"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi
}
has() { grep -qF -- "$1" "$C/trust.md"; }
none() { ! grep -qF -- "$1" "$C/trust.md"; }

check "trust.md skips a workflows entry with the same hash as a commands entry" \
    has 'Skip every entry in category `workflows` whose `hash` equals the `hash` of an entry in category `commands`'
check "trust.md still audits a workflows entry whose hash matches no command" \
    has 'A `workflows` entry whose hash matches no `commands` entry is its own file: audit it like the others.'
check "trust.md no longer names workflows as a whole category to audit" \
    none 'The decryptable (encrypted) categories are: `commands`, `agents`, `hooks`, `skills`, `workflows`.'

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
