# Progress: Release channels (DEV / STAGING / PROD)

## Current Phase: ship (round 4 fixes done; round 5 gates next)

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
- [x] Ship round 2 gates (2026-10-27): code review FAIL (1 HIGH: 29 wrappers unsigned), perf FAIL (status line +20 ms, stalled-body timeout), security PASS (1 MED), pentest PASS (2 LOW)
- [x] Ship round 2 fixes SR1-SR18 (PLAN.md) through /oss:build, done 2026-10-27 (SR17 from the SR4 provenance check, SR18 from the merge): API SR1/SR15/SR16; CLI SR2/SR3/SR4/SR7/SR10/SR16; shell SR2/SR3/SR5/SR6/SR8/SR9/SR11/SR14/SR16; watcher SR2/SR10/SR12/SR13; docs: ADR-005 rules 1-3 and the FOLLOWUPS premise corrected
- [x] Ship round 3 gates (2026-10-27): quality PASS, perf PASS (1 MED: CLI deadline on Node 25), security FAIL (2 LOW: CLI deadline, team-law heading forgery), pentest PASS (1 LOW: unverified section unbounded)
- [x] Ship round 3 fixes TR1-TR10 (PLAN.md) through /oss:build, done 2026-10-27 (TR9 from the TR5/TR6 provenance check, TR10 a regression found by widening the regression to every tracked test)
- [x] Ship round 4 gates (2026-10-28): quality PASS (6 LOW), perf PASS (2 LOW), security FAIL (LOW), pentest FAIL (LOW; it also sent 3 throwaway-key requests to production by running a stable-plugin script: answered 401, no real key)
- [x] Ship round 4 fixes UR1-UR16 (PLAN.md) through /oss:build, done 2026-10-28; maintainer decision: fence the team section, new plugin only. API branch merged with next (#398: main #392-#396)
- [ ] Ship round 5: re-run the gates on the round-4 fixes
- [ ] Maintainer steps before the feature is usable on STAGING: publish tag cli-decrypt-v1.3.0-beta.1 and commit its checksums; T17 beta repo; H1 Render
- [ ] Maintainer steps before the first RELEASE: re-sign the production manifest (every workflows/* entry, SR1); publish and pin a stable cli-decrypt >= 1.3.0

## Blockers
- None. Gated steps: T11 (staging key), T17 (beta repo), H1 (Render/DB).

## Last Updated: 2026-10-28 by /oss:build (ship round 4 fixes)
