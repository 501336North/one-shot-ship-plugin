# Progress: decrypt-version-source

## Current Phase: shipping PR 2 (gate passed 2026-10-23; awaiting user go to merge)

## Tasks
### Phase 1 — CLI version (PR 1)
- [x] Task 1: `--version` reports the package version (1.2.4), bundle rebuilt (completed 2026-10-22, dd157b1)
- [x] Task 2: release workflow refuses a tag that does not match package.json / VERSION (completed 2026-10-22, 6a5f0a0)
### Phase 2 — keyed fetch hardening (PR 1, FOLLOWUPS line 46)
- [x] Task 3: prompt / team-command names URL-encoded (completed 2026-10-22, ba9440d)
- [x] Task 3b: `--type` checked against ALLOWED_TYPES before any request (found in build; completed 2026-10-22, 23ea356)
- [x] Task 4: keyed requests refuse redirects (3 sites + real-fetch integration) (completed 2026-10-22, 699e734)
- [x] Task 5: rebuild, full cli-decrypt suite, tsc (completed 2026-10-22, 3eb43b0: 204/204, tsc clean)
### Ship round 1 fixes (2026-10-23, /oss:build, uncommitted until the ship commit)
- [x] R1-1: `.`/`..`/empty names refused before any request (validateName shared)
- [x] R1-2: refused redirect says so (fetchNoRedirect helper)
- [x] R1-3: key never in an error (CR/LF/NUL pre-check)
- [x] R1-4: server error text stripped of control characters (5 sites)
- [x] R1-5: one apiUrl/config-dir source (src/config.ts), https or loopback http, no ?/#
- [x] R1-5b: oss-notify.sh applies the same apiUrl rule
- [x] R1-5c: settings.md / telegram.md use oss_api_url + oss_api_curl (key off argv, real default host)
- [x] R1-5d: /oss:trust allowlist names the real API host
- [x] R1-6: @yao-pkg/pkg + node22 targets + CI node 22, vitest 5, esbuild 0.28; npm audit 0
- [x] R1-7: actions pinned to SHAs, build job contents:read, tag check before npm ci
### Ship round 2 fixes (2026-10-23, /oss:build; scope frozen by the user after this round)
- [x] R2-1: one literal apiUrl rule in TS + bash, shared 44-case table (bash 3.2, bash 5, zsh)
- [x] R2-2: bash reads key + URL from ${OSS_CONFIG_DIR:-~/.oss} (oss_config_file, oss_api_key); no jq -> default URL only
- [x] R2-3: oss_api_curl uses curl -q --globoff (no .curlrc, no URL globbing)
- [x] R2-4: every CLI error and every telegram.md server field stripped (C0/DEL/C1 + bidi/zero-width)
- [x] R2-5: analytics body already safe (WORKFLOW_CMD guarded by oss_valid_workflow_name); test added, no code change
- [x] R2-6: release checkout persist-credentials: false; no shared npm cache
### Gate (user go each)
- [x] Merge PR 1 (#207, 94b3a25, 2026-10-23)
- [x] Push tag cli-decrypt-v1.2.4; 4 assets + shas verified; all 4 binaries print v1.2.4 (2026-10-23, run 39894135200)
### Phase 3 — hook pin (PR 2)
- [x] Task 6: hook tag v1.2.4 + committed checksums + test fakes + comment (2026-10-23)
- [x] PR2-R1: MINIMUM_VERSION 1.2.4 so existing installs get v1.2.4 (D5, 2026-10-23)
- [x] PR2-R2: soft upgrade (D6): failed download keeps a runnable older binary; tamper stays hard; below-floor asset never installed; --max-time 90 on upgrades (2026-10-23)
- [x] PR2-R3: one 100 s upgrade deadline (.sha256 first), 6 h stamp after a failed upgrade, unparseable .sha256 = failed download, runnable = --version exit 0 and >= 1.2.1 (2026-10-23)
- [x] Task 7: plugin.json 2.0.93 + plugin-version-bump guard test (2026-10-23)

## Blockers
- Phase 3 needs the v1.2.4 release (real checksums). Merges and the tag push need the user's go.

## Last Updated: 2026-10-23 by /oss:ship (PR 2)
