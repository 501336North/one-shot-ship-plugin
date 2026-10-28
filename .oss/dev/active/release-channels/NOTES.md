# Notes: Release channels

## 2026-10-26: plan-time probes (production, maintainer's credentials, read-only)
- `oss-decrypt --type agents|workflows --name <x>` for the 55 distinct names in agents/skills/commands: 53 OK. `agents/performance-auditor` and `agents/visionos-developer` failed with "[SECURITY] Prompt integrity check FAILED". Both files exist in `packages/api/src/prompts/agents/` on API `main`. Cause not investigated yet (Task 9).
- `oss-decrypt --type skills --name <x>` for the 6 `prompts/skills/` names: 6 OK.
- `skills/build.md` and the other workflow-wrapping skills fetch `prompts/workflows/<name>`, not `prompts/skills/<name>`. The fixture table must take type/name from each file's own URL, not from the file's name.
- The API's `/agents/:name`, `/skills/:name` and `/commands/:name` routes return **encrypted** JSON (`{encrypted, iv, authTag}`). The WebFetch steps in the 99 files therefore hand the model ciphertext. They probably don't work as written today; worth confirming during T8 (it would mean the conversion fixes a silent breakage for stable customers too, once released).

## 2026-10-26: plan prompt Step 0 not run
`/oss:plan` Step 0 ("World-Class Repository Setup") would overwrite `.gitignore` (`cat > .gitignore`), install PM2 globally, add `ecosystem.config.js` and change branch protection. For this existing repo that would be destructive, so only its read-only checks were run (remote, gh auth, workflows present). Worth raising against the served plan prompt: Step 0 should skip on existing repos or never clobber.

## 2026-10-26: ideate Step 1 side effect
`oss-iron-laws-sync.sh` rewrote this repo's `CLAUDE.md` IRON LAWS block to the newer compressed version (−260 lines). It was restored with `git checkout -- CLAUDE.md` to keep this feature's diff focused. The refresh should be its own change.

## 2026-10-26: archive false positive
The plan's Phase 0 archive pattern `Current Phase:.*(ship|complete)` matched this feature's own line "ideate (complete) → next: plan" and would have archived the active feature. The line was reworded to `## Current Phase: plan`. Phrase phase lines without "complete" until the feature is actually done.
