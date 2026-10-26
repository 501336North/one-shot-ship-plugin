# Testing: Release channels

## Strategy
Behaviour first, at the boundary each user sees:
- **customer:** prod by default, nothing changes
- **maintainer:** every call follows the channel, a visible STAGING marker, a safe switch

Repo-wide ratchets guard against a new site reintroducing a hard-coded host or a WebFetch.

## Planned suites
| Suite | Tasks | Covers |
|-------|-------|--------|
| `__tests__/integration-branch-note.test.sh` | T2 | AC-008.2 |
| `__tests__/api-literal-ratchet.test.sh` | T3, T11 | AC-002.3, no private key material |
| `hooks/__tests__/hooks-follow-api-url.test.sh` | T4, T5 | AC-001.1, AC-002.1, AC-002.4 |
| `watcher/test/api/api-credentials.test.ts` | T6 | AC-002.2, #47 |
| `watcher/test/engine/custom-command-executor.test.ts` | T6 | #45 |
| `__tests__/command-api-calls.test.sh` | T7 | #14 |
| `__tests__/prompt-fetch-via-decrypt.test.sh` + `test/fixtures/prompt-fetch-map.tsv` | T8 | AC-003.1/2, #44, #69 |
| `packages/api/test/prompts/manifest-integrity.test.ts` (API) | T9 | AC-003.3 |
| `packages/cli-decrypt/test/manifest-key-by-address.test.ts` | T10 | AC-004.x, AC-001.3 |
| `packages/cli-decrypt/test/staging-key.test.ts` | T11 | staging key slot |
| `__tests__/trust-allowlist-host.test.sh` (extended) | T12 | trust allowlist provenance |
| `__tests__/release-workflows.test.sh`, `hooks/__tests__/ensure-decrypt-cli.test.sh` (extended) | T13 | beta CLI pre-release |
| `hooks/__tests__/statusline-channel.test.sh` | T14 | AC-005.x |
| `packages/api/test/deploy/render-staging.test.ts` (API) | T15 | AC-007.1/2 |
| `packages/api/test/prompts/manifest-signing-key.test.ts` (API) | T16 | key from env |
| `scripts/__tests__/oss-channel.test.sh` (API) | T18 | AC-006.x |
| `__tests__/plugin-version-bump.test.sh` (extended) | T19 | AC-008.4 |
| `__tests__/release-checklist.test.sh` | T20 | AC-008.3 |

## Results
### 2026-10-26: acceptance written (`__tests__/release-channels.acceptance.test.sh`), 2/5 pass as expected
- A1 PASS (guard, US-001): with no apiUrl, every hook calls production only
- A2 FAIL (US-002): with apiUrl = http://127.0.0.1:9, fetch-iron-laws, oss-fetch-team-iron-laws, oss-changelog and oss-session-start still call production. Turns green with PLAN T4/T5.
- A3 FAIL (US-003): 99 files still WebFetch a prompt (matches the plan count). Turns green with PLAN T8 + T9.
- A4 FAIL (US-005): no STAGING marker off production. Turns green with PLAN T14.
- A5 PASS (guard, US-001/US-005): no marker on production
- Kept uncommitted until it is green (IRON LAW: no failing tests committed). /oss:build lands it with the task that turns its last row green.

## Last Updated: 2026-10-26 by /oss:acceptance
