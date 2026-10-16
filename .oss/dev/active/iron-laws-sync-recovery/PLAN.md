# Plan: Recover hooks/oss-iron-laws-sync.sh (never committed since PR #150)

Boss, 2026-10-16: "yeah recover it ASAP then".

## Problem
Plugin PR #150 (2026-03-10) made session start call `$PLUGIN_ROOT/hooks/oss-iron-laws-sync.sh` and copy it to `~/.oss/hooks/`. It deleted `oss-iron-laws-inject.sh`, but it never committed the new script or its tests.
- PR #161 (`/oss:ideate`), `login.md` Step 4.1 and `auto.md` all call it.
- Released plugins (≤ 2.0.83) do not contain it.
- Result: customers get no IRON LAWS sync at session start, and `/oss:login` cannot fetch the IRON LAWS through it.
- The script and its tests survive only in the untracked-files stash commit `1241889` (2026-07-21). That copy is byte-identical to `~/.oss/hooks/oss-iron-laws-sync.sh` on Boss's Mac.

## Tasks (TDD)
### T1: Recurrence guard
RED: a test that every hook named in `hooks/oss-session-start.sh` (HOOKS_TO_COPY plus every `$PLUGIN_ROOT/hooks/*.sh` it executes), and every `~/.oss/hooks/*.sh` referenced by `commands/*.md`, exists and is tracked in git (`git ls-files`). It must fail today on `oss-iron-laws-sync.sh`.

### T2: Restore the script and its tests from 1241889
- Files:
  - `hooks/oss-iron-laws-sync.sh`
  - `hooks/__tests__/iron-laws-sync.test.sh`
  - `hooks/__tests__/session-start-iron-laws.test.sh`
  - `commands/__tests__/no-iron-laws-fetch.test.sh`
- Check them against TODAY's code and API before trusting them:
  - endpoint `/api/v1/prompts/shared/iron-laws`, its auth, and its response shape;
  - the IRON LAWS markers in CLAUDE.md that login.md uses;
  - `~/.oss/config.json` key extraction;
  - error-contract conventions (2.0.81+);
  - no secrets in output.
- The restored tests must FAIL without the script (move it aside) and PASS with it.

### T3: Clean-machine check
- With a temp HOME (empty `~/.oss` plus a config holding the real apiKey copied, never printed) and a temp project, run session start or the script, then verify CLAUDE.md gets the IRON LAWS block.
- Run it again and verify idempotence (a fresh block is not duplicated).
- Use read-only API calls only.

### T4: Version bump and changelog
- Bump `plugin.json` from 2.0.83 to 2.0.84, plus the CHANGELOG entry if the repo keeps one.
