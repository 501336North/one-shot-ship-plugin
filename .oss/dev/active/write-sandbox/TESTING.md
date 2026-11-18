# Testing: OS write-sandbox

## Strategy
- **Unit**, under `watcher/test/tool-gate/write-sandbox-*.test.ts`: profile, containment (runner mocked at its interface), router, host-sandbox detection, notice, loosening.
- **Integration**, `write-sandbox.integration.test.ts`: real `/usr/bin/sandbox-exec` on macOS, scratch HOME and repo. Platform guard copied from the existing `sandbox*.integration.test.ts` files.
- **Acceptance:** `served-commands.acceptance.test.ts` BEFORE/AFTER for the main agent and a builder, with `OSS_API_REPO` set when the fixture changes.
- **Speed:** `write-sandbox.speed.test.ts`, p95 added time under 50 ms with a documented margin.

## Commands
- From `watcher/`, targeted only: `npx vitest run test/tool-gate/write-sandbox*.ts test/cli/served-commands.acceptance.test.ts`.
- Regression set at verify: test/tool-gate, test/cli, test/gate-run, test/hooks, test/utils, test/helpers.
- Shell suites under bash 3.2 (`/bin/bash`) for any `hooks/__tests__` touched, plus a full sweep before ship.
- **NEVER** run the full watcher suite.

## Results
_None yet (plan phase)._

## Last Updated: 2026-11-18 by /oss:plan
