# Notes: decrypt-version-source

- Root cause: #176 (1.2.1→1.2.2) and #177 (→1.2.3) bumped `package.json` only; `src/index.ts` VERSION stayed 1.2.1.
  #190 then documented the consequence in the hook ("cli-decrypt-v1.2.3 reports 1.2.1") instead of fixing it.
- Box binary on DeepBlue = v1.2.3 Linux-arm64 release sha (dee584f4…); the Mac has the real v1.2.1 release (37699b7d…).
- `packages/cli-decrypt/dist/oss-decrypt.cjs` is tracked: rebuild it in PR 1.
- Plugin repo has no CI; the cli-decrypt release workflow runs only on `cli-decrypt-v*` tags.
- DeepBlue is running the eval ladder: check `systemctl --user is-active gb10-eval@ladder` / ask the
  `oss-model-eval-04` session before running anything there.
- Acceptance (2026-10-22): `test/version-and-keyed-fetch.acceptance.test.ts`, 6 tests, all RED on their assertions
  (v1.2.1 vs 1.2.3; redirect target received a request x3; unencoded name reached `/prompts/b?x=1` x2).
- Node's fetch already drops `Authorization` on a CROSS-origin redirect (the test's second server got the request
  without the header). The real leak is a SAME-origin redirect (another path on the API host) and the extra request
  itself; the tests assert zero requests to the target, which covers both. Severity stays LOW.
- Build (2026-10-22): `packages/cli-decrypt/node_modules` was empty; vitest ran via npx, tsc reported 86 missing-global
  errors until `npm ci`. `npx tsc --noEmit` / `build.test.ts` leave untracked `dist/*.js|.d.ts|.map`: `git clean dist/`.
- The tracked `dist/oss-decrypt.cjs` goes stale after any src change; the release rebuilds from source, so it is not
  what ships, but rebuild it before committing.
- On a refused redirect the CLI prints `Error: fetch failed` (cause not printed), exit 1; key and URL not printed.
- Round 1 (2026-10-23): `oss-log.sh init build` rewrites current-session/build.log, so the banner count is 1 per
  invocation file; the previous round's log is archived.
- Release risk: the pinned actions (checkout/setup-node/upload/download v4, softprops v2.6.2) run on the Node 20
  runtime GitHub is phasing out. If the v1.2.4 tag run fails at "Set up job", move to the Node 24 majors; a failed
  run publishes nothing. Last successful release runs: June 2026.
- vitest 5 declares node `^22.12 || ^24 || >=26`; this Mac runs 25.4 (EBADENGINE warning only).
- Not in this PR: `.github/workflows/build-oss-launch.yml` (oss-launch binary) still installs `pkg@5.8.1` on node18
  (same HIGH GHSA-22r3-9w55-cj54) and softprops v1 → logged as security FOLLOWUP for its own fix.
