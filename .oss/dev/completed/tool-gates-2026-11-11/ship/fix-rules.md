# Rules for each /oss:ship fix-round agent (tool-gates). Read all of this before you start.

**Repo and branch:** `/Users/ysl/dev/oss-plugin-tool-gates`, branch `feat/tool-gates/build`. Never switch branches, and never use `git -C`.

**DO NOT COMMIT, STAGE OR PUSH ANYTHING.** The ship workflow makes one commit after every fix round. Leave all your changes uncommitted in the working tree. Don't run `git add`, `git stash`, `git reset` or `git checkout` on files you didn't change, and never touch CLAUDE.md or any ndjson file.

**TDD still applies, for each fix:**
1. Write the test first.
2. Run it and watch it fail for the right reason. Note why it failed for your report.
3. Write the minimal code that makes it pass.
4. Run it again and watch it pass.

Test names describe user-visible behaviour in plain words. Mock only collaborators (GitReader, StateStore, WorkflowState, the fs reader). Use real temp dirs (`mkdtempSync`, cleaned up in `afterEach`) and real symlinks or links where the test needs them.

**Code rules:**
- TypeScript strict, ESM, with a `.js` suffix on relative imports.
- No `any`, no new dependencies, and no `.skip`/`.only`/`.todo` (keep marker strings inside string literals).
- Rule values (paths, patterns, branch names) live ONLY in `config/tool-gates.json`.
- Shell, git and filesystem syntax tables are code constants. Give each one a comment saying why.
- A provenance test pins the config values. If you add to `config/tool-gates.json`, update that test's pinned values. Don't change other existing tests unless your fix makes one wrong; if so, say which one and why.

**Read first:**
- In `.oss/dev/active/tool-gates/`: NOTES.md, DESIGN.md "Known Limits", and DECISIONS.md.
- The code in `watcher/src/tool-gate/**`, `watcher/src/cli/tool-gate.ts`, `hooks/oss-tool-gate.sh` and `config/tool-gates.json`, plus the tests in `watcher/test/tool-gate/**`.

**When you're done:**
1. Run `cd watcher && npx vitest run test/tool-gate test/cli test/hooks`, then `./node_modules/.bin/tsc --noEmit -p .`.
2. Rebuild the bundle with `npm run build:cli-bundle`, so `test/hooks/tool-gate-dist.test.ts` passes.
3. If the build changes `watcher/dist/cli/oss-launch.cjs`, restore that one file with `git checkout -- watcher/dist/cli/oss-launch.cjs`. Delete any untracked build leftovers you created.
4. Run the whole suite: `cd watcher && npx vitest run`. Only these 3 failures are allowed: model-frontmatter, offload-step-safety and chain-step-contract.
5. Leave no processes running.

**Report:**
- For each fix: the RED failure reason, the test names, and the files changed.
- The suite and tsc results.
- Any choice you made that the brief didn't cover.
