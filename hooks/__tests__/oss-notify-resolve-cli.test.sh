#!/bin/bash
# oss-notify.sh finds the watcher CLIs under `claude --plugin-dir` through ~/.oss/plugin-root (R-257 T10c).
#
# @behavior When the hook runs from the ~/.oss/hooks copy (so its own plugin root, ~/.oss, holds no watcher) and
#           there is no plugin cache, `notify build start` still records the build's start time in the project's
#           workflow state, because ~/.oss/plugin-root names the plugin. A plugin-root file that is a link, a
#           relative path, or a plugin dir that is a link is ignored. The plugin cache still works without it.
# @business-rule R-267 finding (c), user pick 2026-11-13: CLI order is the hook's plugin root, then ~/.oss/plugin-root
#           (a regular file, not a link, owned, absolute, one line, naming an owned dir that is not a link), then the
#           plugin cache, then the direct path. Without it the start time stays empty and every later gate fails.
#
# Usage: /bin/bash hooks/__tests__/oss-notify-resolve-cli.test.sh   (bash 3.2)   or   BASH_UNDER_TEST=bash ... (bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-notify-resolve-cli tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

# Sandbox: temp HOME whose ~/.oss/hooks holds a copy of the plugin's hook scripts (what session start installs),
# no ~/.claude/plugins/cache, a plugin dir linking the real watcher CLIs (chain-trigger only records), and a
# product repo with a .oss folder.
link_cli() { # <dir>: the real watcher CLIs, chain-trigger a recorder (no network)
    mkdir -p "$1"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$1/"; done
    rm -f "$1/chain-trigger.cjs" "$1/chain-trigger.js"
    printf 'console.log("---CHAIN_COMMANDS---")\n' > "$1/chain-trigger.cjs"
}
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/hooks" "$T/repo/.oss"
    cp "$ROOT"/hooks/*.sh "$T/home/.oss/hooks/"
    link_cli "$T/plugin/watcher/dist/cli"
    ( cd "$T/repo" && git init -q -b main && git -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m base )
}
notify_start() { # build start from the ~/.oss/hooks copy, no CLAUDE_PLUGIN_ROOT
    (cd "$T/repo" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/repo" CLAUDE_CODE_SESSION_ID="rc-session-1" \
        "$SH" "$T/home/.oss/hooks/oss-notify.sh" --workflow build start '{}' </dev/null >"$T/out" 2>"$T/err")
}
# root_file <text>: ~/.oss/plugin-root holding <text>, mode 600 as session-start writes it, so each case below tests
# only what it names (D25 c: a plugin-root not mode 600 is never used).
# ⚠ changes existing test: D25 (c) — the plugin-root fixtures are written mode 600
root_file() { printf '%s' "$1" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"; }
started_at() { jq -r '.currentCommandStartedAt // empty' "$T/repo/.oss/workflow-state.json" 2>/dev/null; }

# 1. --plugin-dir layout: ~/.oss/plugin-root names the plugin -> the state CLI runs and the start time is set.
sandbox
root_file "$T/plugin"$'\n'
notify_start
if [[ -n "$(started_at)" ]]; then pass "a --plugin-dir layout resolves the state CLI through ~/.oss/plugin-root"
else fail "a --plugin-dir layout resolves the state CLI through ~/.oss/plugin-root" "state=$(cat "$T/repo/.oss/workflow-state.json" 2>/dev/null) err=$(cat "$T/err")"; fi
rm -rf "$T"

# 2. a plugin-root file that is a link is ignored.
sandbox
printf '%s\n' "$T/plugin" > "$T/elsewhere"; chmod 600 "$T/elsewhere"
ln -s "$T/elsewhere" "$T/home/.oss/plugin-root"
notify_start
if [[ -z "$(started_at)" ]]; then pass "a symlinked ~/.oss/plugin-root is ignored"
else fail "a symlinked ~/.oss/plugin-root is ignored" "startedAt=$(started_at)"; fi
rm -rf "$T"

# 3. a relative path is ignored, even one that resolves from the cwd.
sandbox
root_file "../plugin"$'\n'
notify_start
if [[ -z "$(started_at)" ]]; then pass "a relative ~/.oss/plugin-root is ignored"
else fail "a relative ~/.oss/plugin-root is ignored" "startedAt=$(started_at)"; fi
rm -rf "$T"

# 4. a plugin dir that is a link is ignored.
sandbox
ln -s "$T/plugin" "$T/plugin-link"
root_file "$T/plugin-link"$'\n'
notify_start
if [[ -z "$(started_at)" ]]; then pass "a plugin-root naming a linked dir is ignored"
else fail "a plugin-root naming a linked dir is ignored" "startedAt=$(started_at)"; fi
rm -rf "$T"

# 5. a plugin-root of two lines is ignored.
sandbox
root_file "$T/plugin"$'\n'"$T/plugin"$'\n'
notify_start
if [[ -z "$(started_at)" ]]; then pass "a two-line ~/.oss/plugin-root is ignored"
else fail "a two-line ~/.oss/plugin-root is ignored" "startedAt=$(started_at)"; fi
rm -rf "$T"

# 6. control: with no plugin-root, the plugin cache layout still resolves.
sandbox
# the cache holds regular files (its search skips links): the state CLI here is a one-line module running the real one
C="$T/home/.claude/plugins/cache/one-shot-ship-plugin/oss/9.9.9/watcher"; mkdir -p "$C/dist/cli"
printf '{"type":"module"}\n' > "$C/package.json"
printf 'import %s;\n' "\"$ROOT/watcher/dist/cli/update-workflow-state.js\"" > "$C/dist/cli/update-workflow-state.js"
notify_start
if [[ -n "$(started_at)" ]]; then pass "the plugin cache layout still resolves without ~/.oss/plugin-root"
else fail "the plugin cache layout still resolves without ~/.oss/plugin-root" "err=$(cat "$T/err")"; fi
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
