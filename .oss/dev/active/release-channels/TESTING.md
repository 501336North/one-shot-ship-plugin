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
_None yet: plan phase._

## Last Updated: 2026-10-26 by /oss:plan
