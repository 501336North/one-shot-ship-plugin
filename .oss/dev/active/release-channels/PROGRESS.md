# Progress: Release channels (DEV / STAGING / PROD)

## Current Phase: build

## Tasks
- [x] Ideate, requirements, ADR-004/005, plan, acceptance (2026-10-26)
- [x] T1: `next` pushed in plugin + API repos (2026-10-26)
- [x] T2: repo notes, plugin b6ee7f6 / API c9e3e5e (2026-10-26)
- [x] T2b: API CI runs on next, c9e3e5e (2026-10-26)
- [x] T4: 5 hooks follow apiUrl, b7103b1 (2026-10-26)
- [x] T5: changelog, check-updates, login, retired session-start variants; OSS_MANIFEST_URL removed, 14dc24b (2026-10-26)
- [x] T6: watcher reader + key senders (#45, #47), da04064/f2c7c7c/8b7e8fb, merged e7d807d (2026-10-26)
- [x] T7: command API calls, ddbce5b; corrected in 5f56c16 (allowlisted `oss-value.sh api` verbs, R5-1)
- [x] T8: 95/99 prompt fetches via oss-decrypt, keycheck in 151 files (#44), ideate template fix, 5f56c16 (2026-10-26)
- [ ] T8 remainder: performance-auditor + visionos-developer (and skill twins). Waits for API PR #389 to reach next
- [ ] T9: API prompt integrity hotfix. PR #389 into API main (CI green; re-running after main moved). Maintainer authorised the merge.
- [ ] T3 ratchet (prod literal allowlist), T10–T20 (pending)
- [ ] H1–H3 bring-up (pending; H1 needs go-ahead + cost)

## Blockers
- None. Gated steps: T11 (staging key), T17 (beta repo), H1 (Render/DB).

## Last Updated: 2026-10-26 by /oss:build
