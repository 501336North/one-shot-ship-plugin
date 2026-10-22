# Testing: decrypt-version-source

## Strategy
- cli-decrypt (vitest, targeted files): `test/version.test.ts` (new), `test/build-targets.test.ts`,
  `test/api-client.test.ts` (+ real-fetch redirect integration with two local servers).
- Workflow guard: run the extracted bash step against matching / mismatching tag / mismatching VERSION.
- Hook (bash): `hooks/__tests__/ensure-decrypt-cli.test.sh`, `__tests__/new-user-install.acceptance.test.sh`.
- Release gate (manual, recorded here): 4 assets + `.sha256`; Darwin-arm64 `--version`; Linux-arm64 via `strings`.

## Results
(filled by /oss:build)
