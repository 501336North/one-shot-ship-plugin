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
