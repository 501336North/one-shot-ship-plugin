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

### /oss:build 2026-10-23 (ship round 1 fixes)
Each task RED first, then GREEN, then mutation (all killed): R1-1 (12+1 RED; 3 mutants), R1-2 (3 RED; 5 mutants),
R1-3 (5 RED; guard mutant), R1-4 (5 RED; 6 mutants), R1-5 (8 RED; 4 mutants), R1-5b (9 RED; 5 mutants),
R1-5c (9+4 RED; 2 mutants), R1-5d (2 RED; 1 mutant), R1-6 (10 RED; 3 mutants), R1-7 (3 RED; 4 mutants).
Totals after the round: cli-decrypt 24 files 258/258 (vitest 5.0.5), tsc clean, `npm audit` 0 (was 15);
plugin bash tests 45/45 files; watcher 265 files 3704/3704; bundle `--version` = v1.2.4;
local @yao-pkg/pkg node22-macos-arm64 binary `--version` = v1.2.4 (60 MB).
- /oss:integration 2026-10-23: real fetch confirms R1-4 (3 real-server cases, acceptance 18/18); real curl
  (`hooks/__tests__/oss-api-curl.real.integration.test.sh`, 7/7): key arrives as the Bearer header, never in
  `ps -axo args` during an in-flight request, refused apiUrl makes no request. No mock/reality mismatch.

### /oss:build 2026-10-23 (ship round 2 fixes)
RED first, mutation-checked: R2-1 (TS 15 + bash 12 + zsh 14 wrong accepts; 6 mutants), R2-2 (13+2+1 RED; 2 mutants),
R2-3 (5 RED; 3 mutants), R2-4 (4 RED groups; 4 mutants), R2-5 (guard proven by 2 mutants), R2-6 (2 RED; 4 mutants).
Totals: cli-decrypt 26 files 312/312, tsc clean, npm audit 0, bundle v1.2.4; bash test files 49/49; watcher 3704/3704.
Note: watcher test/hooks/oss-log-error-recovery + oss-log-health-check fail (9/10) when CLAUDE_PROJECT_DIR is exported
in the caller's shell — pre-existing isolation gap, logged.

### Release gate + /oss:build --phase 3 (2026-10-23)
- Release cli-decrypt-v1.2.4 (run 39894135200): 4 assets match their .sha256; Darwin-arm64 native, Darwin-x64 (Rosetta),
  Linux-arm64 and Linux-x64 (local docker) all print `oss-decrypt v1.2.4`.
- T6 RED 27/29 (pin v1.2.3 vs package 1.2.4); GREEN ensure-decrypt-cli 29/29, verify-decrypt-setup 4/4, new-user-install 3/3.
  Live hook run (temp HOME): v1.2.4 Darwin-arm64 downloaded, in-release + committed hash verified. Mutations: tag back,
  MINIMUM raised -> red. A wrong committed hash is caught only by a live download (fails closed).
- T7 RED 0/1 (shipped paths changed, version unchanged); GREEN 2.0.93; downgrade and unchanged both red.
- All plugin bash test files 50/50.
- PR2-R1 (2026-10-23): RED 29/32 (1.2.1 and 1.2.3 installs kept); GREEN 32/32; mutations 1.2.1 and 1.2.5 red.
  Live (temp HOME, real GitHub): a fake installed v1.2.1 was replaced by the verified v1.2.4 (431fe3fa…), second run
  downloaded nothing.
- PR2-R2 (2026-10-23): RED 37/41 then 41/42; GREEN 42/42; mutations: download failure hard, hash mismatch soft, no post-install floor check, no cap, cap on first install -> all red.
- PR2-R3 (2026-10-23): 4 cycles, each RED first: runnable 43/46->47/47; captive portal 47/50->50/50; deadline 49/50->50/50; backoff 53/59->60/60. 18 mutations, all red.
