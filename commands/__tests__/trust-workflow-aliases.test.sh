#!/bin/bash
# /oss:trust audits every served workflows/* entry (R-273 P6, ship-gate finding B).
#
# The signed manifest also lists each command under its workflow aliases (`workflows/<name>`). An earlier rule skipped
# a workflows entry whose `hash` equalled a commands entry's `hash`. But delivery is checked against the signed
# `servedHash`, which `oss-decrypt --list-prompts` does not show, so an alias could share a command's `hash`, deliver
# different content and never be audited. trust.md therefore audits every workflows entry, with no hash-based skip.
#
# @behavior A user running /oss:trust has every workflows/* prompt decrypted and scanned, even one whose listed hash
#           equals a command's hash.
# @business-rule Nothing the server delivers is left out of the audit on the strength of an unsigned-for-delivery hash.
set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
check() {  # $1 = description, then the command
    RUN=$((RUN + 1))
    if "${@:2}"; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi
}
has() { grep -qF -- "$1" "$C/trust.md"; }
none() { ! grep -qF -- "$1" "$C/trust.md"; }

# no_workflow_skip: no line of trust.md that names the `workflows` category also tells the agent to skip, drop or
# audit-once any of its entries.
no_workflow_skip() { ! grep -F -- '`workflows`' "$C/trust.md" | grep -qiE 'skip|left after|audited once|filter[^.]* out'; }

check "trust.md has no rule that skips a workflows entry (by hash or otherwise)" \
    no_workflow_skip
check "trust.md audits every workflows entry, even one whose hash equals a commands entry's hash" \
    has 'Audit every entry in category `workflows`, even one whose `hash` equals the `hash` of an entry in category `commands`'
check "trust.md names workflows as a whole category to audit" \
    has 'The decryptable (encrypted) categories are: `commands`, `agents`, `hooks`, `skills`, `workflows`.'

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
