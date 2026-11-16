#!/bin/sh
# OSS heads-up hook: relays Claude Code's built-in heads-up for this session to the agent, once, so it can check it
# and tell the user. Runs the pinned copy of https://github.com/501336North/heads-up (hooks/heads-up/, see
# VENDORED.json; never edit it here, re-vendor with scripts/vendor-heads-up.sh).
# Triggered on: UserPromptSubmit, PostToolUse (every tool).
#
# Starts node only when there is a store to read: HEADS_UP_STORE, or the built-in's store file under
# ~/.claude/plugins/store. Without Claude Code's built-in heads-ups this exits at once, so it costs ~nothing.
for f in "${HEADS_UP_STORE:-}" "$HOME"/.claude/plugins/store/cc-plugin-you-should-know_builtin-*.json; do
    [ -n "$f" ] && [ -e "$f" ] && exec node "$(dirname "$0")/heads-up/heads-up.mjs"
done

# No store: the built-in heads-ups may be off (they are by default). Tell the user once per machine how to turn them
# on, as a systemMessage (shown to the user; session start output only reaches the agent). Never with HEADS_UP=off.
[ "$(printf '%s' "${HEADS_UP:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')" = off ] && exit 0
# heads-up-hint-seen, not 2.2.0's heads-up-hint-shown: 2.2.0 set that at session start, where the user never saw it.
marker="$HOME/.oss/heads-up-hint-seen"
[ -e "$marker" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0   # the relay needs node; without it there is nothing to turn on
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
# On when the settings file that names the built-in and wins (local > project > user) sets it to true.
key='"cc-plugin-you-should-know@builtin"'
for f in "$proj/.claude/settings.local.json" "$proj/.claude/settings.json" "$HOME/.claude/settings.json"; do
    [ -f "$f" ] && grep -qF "$key" "$f" 2>/dev/null || continue
    grep -qE "$key[[:space:]]*:[[:space:]]*true" "$f" 2>/dev/null && exit 0
    break
done
mkdir -p "$HOME/.oss" 2>/dev/null && : > "$marker" || exit 0
printf '%s\n' '{"systemMessage":"OSS: the heads-up relay is idle because Claude Code'"'"'s \"You should know\" heads-ups are off. Turn them on with: /plugin enable cc-plugin-you-should-know@builtin"}'
exit 0
