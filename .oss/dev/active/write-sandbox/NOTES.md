# Notes: OS write-sandbox

- **The review wrap already exists** (`sandbox.ts` `reviewContainment`, `wrapCommand`; `gate.ts` around line 699). The builder wrap reuses the same `updatedInput` path and process-group wrapper.
- **Where the UNKNOWN write-target refusals are:** `rules/protected-path.ts`, the `unreadableFolder` early returns (around lines 473 and 481), plus the `into` folder path (around line 344).
- **R-257 paths:** results at `<repo>/.oss/dev/active/<feature>/results/<phase>.json`, written by `oss-phase-result.sh assemble` (run through Bash). The ledger is `~/.oss/ledger/<key>/`, and R-257 adds `~/.oss/ledger/**` to `protectedPaths`.
- **Served fixture counts (2026-11-18, R-257 branch):**
  - 702 blocks; 16 mix git writes with other programs.
  - 323 call OSS scripts; about 306 are OSS-only and about 17 are mixed.
- **Claude Code facts (docs, 2026-11-18):**
  - Hooks run unsandboxed.
  - `updatedInput` replaces the tool input.
  - Claude Code's sandbox covers Bash only, applies to subagents, and has `allowUnsandboxedCommands: false` to block opting out.
  - A plugin can't ship sandbox settings.
