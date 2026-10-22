# Notes: decrypt-version-source

- Root cause: #176 (1.2.1→1.2.2) and #177 (→1.2.3) bumped `package.json` only; `src/index.ts` VERSION stayed 1.2.1.
  #190 then documented the consequence in the hook ("cli-decrypt-v1.2.3 reports 1.2.1") instead of fixing it.
- Box binary on DeepBlue = v1.2.3 Linux-arm64 release sha (dee584f4…); the Mac has the real v1.2.1 release (37699b7d…).
- `packages/cli-decrypt/dist/oss-decrypt.cjs` is tracked: rebuild it in PR 1.
- Plugin repo has no CI; the cli-decrypt release workflow runs only on `cli-decrypt-v*` tags.
- DeepBlue is running the eval ladder: check `systemctl --user is-active gb10-eval@ladder` / ask the
  `oss-model-eval-04` session before running anything there.
