# Progress: decrypt-version-source

## Current Phase: build (PR 1 tasks done; awaiting /oss:ship)

## Tasks
### Phase 1 — CLI version (PR 1)
- [x] Task 1: `--version` reports the package version (1.2.4), bundle rebuilt (completed 2026-10-22, dd157b1)
- [x] Task 2: release workflow refuses a tag that does not match package.json / VERSION (completed 2026-10-22, 6a5f0a0)
### Phase 2 — keyed fetch hardening (PR 1, FOLLOWUPS line 46)
- [x] Task 3: prompt / team-command names URL-encoded (completed 2026-10-22, ba9440d)
- [x] Task 3b: `--type` checked against ALLOWED_TYPES before any request (found in build; completed 2026-10-22, 23ea356)
- [x] Task 4: keyed requests refuse redirects (3 sites + real-fetch integration) (completed 2026-10-22, 699e734)
- [x] Task 5: rebuild, full cli-decrypt suite, tsc (completed 2026-10-22, 3eb43b0: 204/204, tsc clean)
### Gate (user go each)
- [ ] Merge PR 1
- [ ] Push tag cli-decrypt-v1.2.4; verify 4 assets + shas; Darwin-arm64 `--version` = v1.2.4
### Phase 3 — hook pin (PR 2)
- [ ] Task 6: hook tag v1.2.4 + committed checksums + test fakes + comment
- [ ] Task 7: plugin.json patch bump

## Blockers
- Phase 3 needs the v1.2.4 release (real checksums). Merges and the tag push need the user's go.

## Last Updated: 2026-10-22 18:05 by /oss:build
