# Testing: decrypt-version-source

## Strategy
- cli-decrypt (vitest, targeted files): `test/version.test.ts` (new), `test/build-targets.test.ts`,
  `test/api-client.test.ts` (+ real-fetch redirect integration with two local servers).
- Workflow guard: run the extracted bash step against matching / mismatching tag / mismatching VERSION.
- Hook (bash): `hooks/__tests__/ensure-decrypt-cli.test.sh`, `__tests__/new-user-install.acceptance.test.sh`.
- Release gate (manual, recorded here): 4 assets + `.sha256`; Darwin-arm64 `--version`; Linux-arm64 via `strings`.

## Results
### /oss:build 2026-10-22 (PR 1)
Every task RED first, then GREEN; each guard checked by mutation.
- T1 `test/version.test.ts` 2 tests. RED `expected '1.2.1' to be '1.2.3'` (source and built bundle). GREEN 2/2.
- T2 `test/build-targets.test.ts` +6 (step exists before Build bundle; script runs: match 0; wrong tag, stale VERSION,
  stale package.json non-zero). RED "no Check tag matches version step". GREEN 10/10. Mutations: drop VERSION compare,
  drop package.json compare, drop `exit 1`: each killed.
- T3 `test/api-client.test.ts` +4 (commands, workflows, typed, custom). RED unencoded URL. GREEN. Each branch mutation killed.
- T3b +1 (unknown type rejects, fetch never called). RED "promise resolved instead of rejecting". Mutation killed.
- T4 +3 (`redirect: 'error'` per site). RED x3. Each site mutation kills its unit test AND its AC-KEY-1 test.
- Acceptance `test/version-and-keyed-fetch.acceptance.test.ts`: 6/6 (was 6 RED).
- Full cli-decrypt suite: 22 files, 204/204. `tsc --noEmit` clean (after `npm ci`). Bundle `--version` = v1.2.4.
- /oss:integration 2026-10-22: mocked fetch checked against real fetch. Added 3 SAME-origin cases to AC-KEY-1
  (302 to /stolen on the same server). Without the fix the key DOES reach /stolen (`Bearer ...` recorded) on all
  three functions; each site mutation reddens exactly its own 3 tests. Acceptance 9/9, api-client 16/16.
