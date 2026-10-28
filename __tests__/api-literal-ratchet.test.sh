#!/bin/bash
# Ratchet: the production OSS API host is written in exactly the places allowed to name it (release channels
# AC-002.3, PLAN T3).
#
# @behavior Every API call takes its address from one rule (oss_api_url / getApiUrl / readApiCredentials, all
#           tested against packages/cli-decrypt/test/fixtures/api-url-cases.json). So the host appears only as
#           those three defaults, in the /oss:trust exfiltration allowlist, and in documentation and tests. A
#           new file, or an edit, that types the host anywhere else turns this test red, before a STAGING session
#           can send a key to production through it. The same scan refuses private-key material in the repo
#           (the staging signing key must never be committed, PLAN T11).
# @business-rule One answer to "which API does this call go to" (IRON LAW #1b); production keys stay off staging.
#
# Usage: ./__tests__/api-literal-ratchet.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = offending lines (empty = pass)
    RUN=$((RUN + 1))
    if [[ -z "$2" ]]; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; printf '%s\n' "$2" | sed 's/^/    /'; FAILED=$((FAILED + 1)); fi
}

# Where the host may be written, and why.
ALLOWED=(
    'hooks/oss-api-curl.sh'                     # the shell default (oss_api_url)
    'packages/cli-decrypt/src/config.ts'        # the CLI default (getApiUrl)
    'watcher/src/api/api-credentials.ts'        # the watcher default (readApiCredentials)
    'commands/trust.md'                         # /oss:trust exfiltration allowlist (trust-allowlist-host.test.sh)
    'ARCHITECTURE.md'                           # documentation
    'docs/*'                                    # design docs, ADRs, requirements
    'dev/*'                                     # historical dev docs
    '.oss/*'                                    # dev docs, follow-ups
    'LEARNINGS.md'
    '*/__tests__/*' '__tests__/*' '*/test/*'    # tests
    '*/dist/*'                                  # bundles built from src (watcher-dist-fresh, cli-decrypt build)
)
allowed() { local p; for p in "${ALLOWED[@]}"; do [[ "$1" == $p ]] && return 0; done; return 1; }

# offenders <dir>: tracked AND untracked (not ignored) files in <dir> that name the host but are not allowed.
offenders() {
    (cd "$1" && { git ls-files; git ls-files --others --exclude-standard; } | sort -u | while IFS= read -r f; do
        [[ -f "$f" ]] || continue
        allowed "$f" && continue
        grep -lE 'one-shot-ship-api\.onrender\.com|api\.oneshotship\.com' -- "$f" 2>/dev/null
    done)
}

check "the production API host appears only where it is allowed" "$(offenders "$ROOT")"
check "no private key material in the repository" \
    "$(cd "$ROOT" && git grep -lE -- '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----' -- . ':!**/__tests__/**' ':!**/test/**' 2>/dev/null)"

# Anti-vacuity: in a throwaway copy, a new file and an edited converted file that name the host must both be caught.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
git -C "$ROOT" worktree add -q --detach "$T/w" HEAD 2>/dev/null || cp -R "$ROOT" "$T/w"
printf 'curl https://one-shot-ship-api.onrender.com/api/v1/x\n' > "$T/w/hooks/new-hook.sh"
printf '\nURL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/x\n' >> "$T/w/agents/code-reviewer.md"
got="$(offenders "$T/w")"
grep -qxF hooks/new-hook.sh <<<"$got" && grep -qxF agents/code-reviewer.md <<<"$got"
check "the ratchet catches a new file and an edited file that type the host (not vacuous)" \
    "$( [[ $? == 0 ]] || echo "caught: [$(tr '\n' ' ' <<<"$got")]")"
git -C "$ROOT" worktree remove --force "$T/w" >/dev/null 2>&1 || true

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
