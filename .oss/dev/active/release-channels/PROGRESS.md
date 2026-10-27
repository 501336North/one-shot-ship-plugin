# Progress: Release channels (DEV / STAGING / PROD)

## Current Phase: ship (round 1 fixes done; round 2 gates next)

## Tasks
- [x] Ideate, requirements, ADR-004/005, plan, acceptance (2026-10-26)
- [x] T1 `next` in both repos; T2 repo notes; T2b API CI on next (API PR #391, open for review)
- [x] T3 literal ratchet, 7651a0e
- [x] T4/T5 hooks follow apiUrl, b7103b1 / 14dc24b
- [x] T6 watcher reader + key senders (#45, #47), merged e7d807d
- [x] T7 command API calls via allowlisted `oss-value.sh api` / `keycheck` (5f56c16)
- [x] T8 99/99 prompt fetches via oss-decrypt, key never printed (#44), 5f56c16 + b1158f7. visionOS RAG carded (FOLLOWUPS)
- [x] T9 API prompt-integrity hotfix: #389 merged to main (0917b32), synced to next #390, verified live
- [x] T10 signing key by address in oss-decrypt (T10 branch merged; staging key is a fail-closed placeholder)
- [x] T12 /oss:trust allowlist names the staging host, 2bd8edd
- [x] T13 beta CLI = pre-release, never Latest, 62624f3
- [x] T14 status line `⚠ STAGING` + mismatch warnings, 910d38d (acceptance 5/5)
- [x] T15 render.yaml staging service, T16 per-environment manifest signing, T18 oss-channel.sh (API branch feat/release-channels/build-t15-t18)
- [x] T19 SemVer version gate, 01dfe1e
- [x] T20 release template + RELEASING.md (plugin 292b999, API 9fe787b)
- [x] T11 staging key pinned (bfaf04a); private half in the password manager
- [ ] T17 beta marketplace repo 501336North/one-shot-ship-plugin-beta: needs go-ahead to create
- [ ] H1 Render staging service + DB + Stripe test keys: needs go-ahead + cost
- [ ] H2 switch to beta and run the workflow on STAGING; H3 acceptance sign-off

- [x] Ship round 1: 4 gates FAILED, 15 fix tasks FR1-FR15 (PLAN.md) all done 2026-10-27, through /oss:build (one banner for the round)
  - plugin: 305303e, 2794dbf, 6e49f34, f69ddf1, d5e03f2, 06e5f77, 020d9ba, 3bb0417, ad34907; merged CLI (FR3/FR4/FR7/FR15/FR1-CLI), watcher (FR4/FR7/FR9/FR10/FR14), FR15 hooks
  - API (build-t15-t18): FR15 35d2b63, FR3 7b48e02, FR8 94bb6a6, FR12 7672068, template c4a07e0
- [ ] Ship round 2: re-run the 4 gates
- [ ] Maintainer steps before the feature is usable on STAGING: publish tag cli-decrypt-v1.3.0-beta.1 and commit its checksums; T17 beta repo; H1 Render
- [ ] Maintainer steps before the first RELEASE: re-sign the production manifest (22 workflows/* entries); publish and pin a stable cli-decrypt >= 1.3.0

## Blockers
- None. Gated steps: T11 (staging key), T17 (beta repo), H1 (Render/DB).

## Last Updated: 2026-10-27 by /oss:build (ship round 1 fixes)
