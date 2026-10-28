# Notes: staging-swimlane (restart of release-channels)

Last Updated: 2026-10-28 19:35 CST by /oss:ideate (pre-work, before Q1)

## End target (maintainer, 2026-10-28)
"Throughout all my career, a staging swimlane has been basically a copy of prod... it just holds newer
work, that we can test without impacting live customers... once we are happy with the work on staging it's
put in prod. That's it."
- Prod and staging OSS sessions run IN PARALLEL on one Mac and behave the same: same Claude login, same MCP
  servers (Obsidian vault is a must), same memory and CLAUDE.md. Only the OSS version and its backend differ.
- Development of `next` happens in staging sessions (dogfooding), not only testing.
- External testers later. Customers are never impacted.

## Why the first attempt failed (rejected 2026-10-28)
- The machine-wide `~/.oss` symlink switch (`oss-channel.sh`) flips every session at once.
- A HOME-per-profile launcher loses MCP servers and memory and needs a second Claude login.
- `$OSS_HOME` in command text is permission-blocked, and the user's allow rules name literal `~/.oss/...`.
- Root cause: the plugin does not use its own files. Commands, skills and agents call a machine-global copy
  at `~/.oss/...`: 504 lines in commands, 168 in skills, 147 in agents, 192 in hooks, about 36 in watcher/src,
  4 in cli-decrypt. Session start copies 15 hooks into `~/.oss/hooks` and writes `~/.oss/plugin-root`, so the
  last session to start wins (the ADR-004 F1 problem, which also affects customers).

## Platform facts, documented AND verified in a real session (Claude Code 2.1.312, 2026-10-28)
| Fact | Verified how |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` is substituted in command bodies before the model sees it | probe: the model ran the absolute path |
| `${CLAUDE_PLUGIN_DATA}` is substituted too, to `~/.claude/plugins/data/<name@origin, sanitised>/` | probe: `.../data/oss-inline`; the stable install already has `data/oss-one-shot-ship-plugin` |
| `allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/x.sh:*)` in command frontmatter pre-approves it | probe: 0 permission denials, no prompt |
| A plugin's `bin/` is on the Bash tool PATH (bare command), after the user's own PATH | probe: `oss-probe-bin` ran |
| `--plugin-dir` with the same plugin name replaces the installed one for that session only | probe (earlier) |
| Env vars set at launch reach hooks and the Bash tool; MCP and claude.ai connectors stay available | probe (earlier) |
| `CLAUDE_PLUGIN_*` variables are NOT in the Bash tool environment (only in hooks) | probe: `data=unset-in-bash` |
| Two same-named plugins from different marketplaces can both be installed; `--settings '{"enabledPlugins":{...}}'` picks one per session (flag scope beats user and project). If both are enabled, only one registers hooks. | docs only (loading.md, cli-reference.md); NOT yet probed: probing needs an install |
| `userConfig` with `"sensitive": true` stores a value (e.g. an API key) in the OS keychain per plugin | docs only (manifest-reference.md) |
Sources: code.claude.com/docs/en/plugins/{components,manifest-reference,loading,cli-reference}.md, skills.md,
permissions.md, settings.md; CHANGELOG 2.1.0, 2.1.74, 2.1.78, 2.1.91, 2.1.296.
Probe leftovers: `~/.claude/plugins/data/oss-inline` (empty) and scratchpad/probe-b.

## Inventory of the frozen work on `next` (read-only agent report, 2026-10-28)
- A) Tied to the rejected switch (about 250 lines of code and 700 of tests): beta detection by a pre-release
  version, `OSS_DECRYPT_BETA_TAG` and the beta checksum file, `oss-semver.sh`, the STAGING banner in
  `oss-statusline.sh`, the pre-release CLI workflow, plugin.json `2.1.0-beta.1`, the symlink exception in
  `safe-write.ts`, API `scripts/oss-channel.sh` plus its tests, ADR-004, the release-channels dev docs.
- B) Server-side or address-based, design-neutral (about 1,100 lines of code and 2,000 of tests): staging key
  chosen by address (`manifest-keys.ts`), the `oss_api_url` trust rule (`oss-api-curl.sh`), single config read,
  key-via-helper, WebFetch moved to `oss-decrypt` (101 files), ADR-005, `render.yaml` staging block, manifest
  signing at startup, `RELEASING.md` and the checklist.
- C) Unrelated hardening that came along (about 600 lines of code and 1,700 of tests): IRON LAWS verification
  and fence, team laws, invisible-character table, `withDeadline`, no-follow writes, custom-command executor.
- `OSS_CONFIG_DIR` already exists on main (CLI, api-curl, check-updates, changelog, watcher credentials).
