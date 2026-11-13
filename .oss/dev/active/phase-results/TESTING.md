# Testing: phase-results (R-257)

## Strategy
- Outside-in: acceptance tests at the hook/CLI boundary (`oss-notify.sh complete`, `oss-phase-result.sh`, the Stop dispatcher), then unit tests for the validator, assemblers and store.
- Hermetic: fixture repos in temp dirs, with fixture events.ndjson, cycle.json and decisions.ndjson. No network, no real API.
- Run only targeted files (`cd watcher && npx vitest run <files>`, `bash hooks/__tests__/<file>.sh`). Never the full watcher suite: its setup kills every OSS process on the machine.
- The test cases are listed in DESIGN.md under "TDD Test Plan".

## Results
### Acceptance (RED), 2026-11-13
`hooks/__tests__/phase-results.acceptance.test.sh`: 7 rows, **7 failing as expected** (bash 3.2):
1. complete with no result is refused: fails (today rc 0 and the chain fires).
2. assemble then complete passes: fails (`oss-phase-result.sh` missing, rc 127).
3. hand-written result gives unbound_result: fails (today accepted).
4. pre-R-257 feature start gives the D17 notice: fails (no notice).
5. start ship without a build result is refused: fails (today it starts).
6. ship empty diff gives empty_diff: fails (CLI missing).
7. Stop dispatcher blocks: fails (dispatcher missing).

Not committed while red (IRON LAW #1: no commit with failing tests). The test lands with the build commits that turn it green.

## Last Updated: 2026-11-13 15:55 CST by /oss:acceptance
