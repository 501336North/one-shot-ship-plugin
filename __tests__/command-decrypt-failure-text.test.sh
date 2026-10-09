#!/bin/bash
# Every /oss:* command runs ensure-decrypt-cli.sh at Step 4. Its failure text must not send the user to
# /oss:login "for manual setup": since decrypt-download-pin, /oss:login runs this same hook, so that advice
# loops (IRON LAW #1b: the hook's own wording was fixed; every caller must agree).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hits=$(grep -rl "for manual setup" "$ROOT/commands" 2>/dev/null | wc -l | tr -d ' ')
if [[ "$hits" == "0" ]]; then echo "✓ PASS: no command sends decrypt-install failures to /oss:login for manual setup"; exit 0
else echo "✗ FAIL: $hits command files still say 'Run /oss:login for manual setup'"; exit 1; fi
