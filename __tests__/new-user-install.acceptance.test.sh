#!/bin/bash
# Acceptance: a brand-new user can install the oss-decrypt CLI.
#
# Story: as a new One Shot Ship user on a fresh machine, /oss:login and the first /oss:* command install
# oss-decrypt from a release that actually contains it, so my commands work.
# Regression this guards (2026-06-28 → 2026-10-09): the installers downloaded from GitHub's "latest"
# release; an oss-launch release took "Latest" without oss-decrypt assets → 404 for every new machine.
#
# Usage: ./__tests__/new-user-install.acceptance.test.sh

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PINNED="/releases/download/cli-decrypt-v1.2.3/"
TESTS_RUN=0; TESTS_PASSED=0; TESTS_FAILED=0
pass() { echo "✓ PASS: $1"; ((TESTS_PASSED++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((TESTS_FAILED++)); }

# A1 — Given a fresh machine (empty HOME, no oss-decrypt), When the install hook runs,
#      Then it fetches the binary and its checksum from the pinned cli-decrypt release, never from latest.
a1_fresh_machine_fetches_pinned_release() {
  ((TESTS_RUN++))
  local sb; sb="$(mktemp -d)"; mkdir -p "$sb/home" "$sb/mock"
  cat > "$sb/mock/curl" <<CURL
#!/bin/sh
out=""; prev=""
for a in "\$@"; do
  case "\$a" in https://*) echo "\$a" >> "$sb/urls.log";; esac
  [ "\$prev" = "-o" ] && out="\$a"; prev="\$a"
done
[ -n "\$out" ] && echo "not-a-real-binary" > "\$out"
exit 0
CURL
  chmod +x "$sb/mock/curl"
  HOME="$sb/home" PATH="$sb/mock:$PATH" bash "$ROOT/hooks/ensure-decrypt-cli.sh" >/dev/null 2>&1 || true
  local urls; urls="$(cat "$sb/urls.log" 2>/dev/null)"
  if [[ -z "$urls" ]]; then fail "A1 fresh machine fetches pinned release" "hook requested no URL"
  elif grep -q "/latest/" <<<"$urls"; then fail "A1 fresh machine fetches pinned release" "requested latest: $(grep /latest/ <<<"$urls" | head -1)"
  elif [[ "$(grep -c "$PINNED.*oss-decrypt-" <<<"$urls")" -lt 2 ]]; then fail "A1 fresh machine fetches pinned release" "binary+checksum not both from $PINNED: $urls"
  else pass "A1 fresh machine fetches binary + checksum from the pinned cli-decrypt release"; fi
  rm -rf "$sb"
}

# A2 — Given a new user running /oss:login, Then the CLI install step goes through ensure-decrypt-cli.sh
#      (one downloader, SHA-256 verified) and login.md carries no download URL of its own.
a2_login_installs_through_hook() {
  ((TESTS_RUN++))
  local f="$ROOT/commands/login.md"
  if ! grep -q "ensure-decrypt-cli.sh" "$f"; then fail "A2 login installs through the hook" "login.md never calls ensure-decrypt-cli.sh"
  elif grep -qE "https://[^ ]*oss-decrypt-" "$f"; then fail "A2 login installs through the hook" "login.md has its own oss-decrypt URL"
  elif ! grep -qE '^ *~/\.oss/hooks/ensure-decrypt-cli\.sh *$' "$f"; then fail "A2 login installs through the hook" "hook not invoked in the allowlisted form ~/.oss/hooks/ensure-decrypt-cli.sh (permission prompt)"
  elif grep -qE 'cat ~/\.oss/plugin-root[^)]*\)/hooks/ensure-decrypt-cli' "$f"; then fail "A2 login installs through the hook" "unguarded plugin-root fallback can resolve to /hooks/…"
  else pass "A2 /oss:login installs oss-decrypt through the verified hook"; fi
}

# A3 — Then no shipped file downloads from a "latest" release (the class of bug, not just this instance).
a3_no_latest_download_in_shipped_files() {
  ((TESTS_RUN++))
  local hits; hits="$(grep -rn "releases/latest/download" "$ROOT"/hooks "$ROOT"/commands "$ROOT"/bin "$ROOT"/scripts "$ROOT"/skills "$ROOT"/agents 2>/dev/null | grep -v "/__tests__/")"
  if [[ -n "$hits" ]]; then fail "A3 no latest/download in shipped files" "$(echo "$hits" | sed "s#$ROOT/##" | cut -c1-120 | tr '\n' ';')"
  else pass "A3 no shipped file downloads from a 'latest' release"; fi
}

a1_fresh_machine_fetches_pinned_release
a2_login_installs_through_hook
a3_no_latest_download_in_shipped_files
echo "Tests: $TESTS_RUN run, $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
