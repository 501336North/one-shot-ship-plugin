# Progress: decrypt-version-source

## Current Phase: plan

## Tasks
### Phase 1 — CLI version (PR 1)
- [ ] Task 1: `--version` reports the package version (1.2.4), bundle rebuilt
- [ ] Task 2: release workflow refuses a tag that does not match package.json / VERSION
### Phase 2 — keyed fetch hardening (PR 1, FOLLOWUPS line 46)
- [ ] Task 3: prompt / team-command names URL-encoded
- [ ] Task 4: keyed requests refuse redirects (3 sites + real-fetch integration)
- [ ] Task 5: rebuild, full cli-decrypt suite, tsc
### Gate (user go each)
- [ ] Merge PR 1
- [ ] Push tag cli-decrypt-v1.2.4; verify 4 assets + shas; Darwin-arm64 `--version` = v1.2.4
### Phase 3 — hook pin (PR 2)
- [ ] Task 6: hook tag v1.2.4 + committed checksums + test fakes + comment
- [ ] Task 7: plugin.json patch bump

## Blockers
- Phase 3 needs the v1.2.4 release (real checksums). Merges and the tag push need the user's go.

## Last Updated: 2026-10-22 by /oss:plan
