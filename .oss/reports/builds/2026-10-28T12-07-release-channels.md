# Build Report: release-channels
**Generated:** 2026-10-28T12:07 CST | **Status:** DRAFT
**Branch:** feat/release-channels/ship (plugin) + feat/release-channels/build-t15-t18 (API)

Diff bases: plugin `origin/next...HEAD` (HEAD 3d4b3a3, base 2c36f9f); API `origin/next...HEAD` (HEAD 84b52fd, base 820054b). Both repos were read-only. Ship round 4 fixes are in; ship round 5 gates have not run yet (PROGRESS.md).

## What Changed?
### Files Modified

**Plugin (`/Users/ysl/dev/one-shot-ship-plugin-channels`): 326 files (73 added, 253 modified)**

| Area | Files | Notes |
|------|-------|-------|
| agent/skill/command markdown | 160 M | Prompt fetches moved from WebFetch to `oss-decrypt` / `oss-value.sh`. See the note below. |
| tests and fixtures | 84 (46 A, 38 M) | `hooks/__tests__`, `__tests__`, `commands/__tests__`, `packages/cli-decrypt/test`, `watcher/test` |
| hooks/ (scripts) | 17 (15 M, 2 A) | Source list below |
| packages/cli-decrypt/src | 15 (11 M, 4 A) | Source list below |
| watcher/src | 9 (8 M, 1 A) | Source list below |
| watcher/dist (built) | 21 (13 M, 8 A) | Generated from `watcher/src`. Committed. |
| packages/cli-decrypt (dist, package.json, lock) | 3 M | `dist/oss-decrypt.cjs` is a committed build |
| docs and dev docs | 15 (12 A, 3 M) | ADR-004, ADR-005, `docs/RELEASING.md`, `docs/requirements/release-channels.md`, `.oss/dev/active/release-channels/*`, `.oss/dev/FOLLOWUPS.md` |
| root, config, .github | 2 M | `.claude-plugin/plugin.json`, `.github/workflows/release-cli-decrypt.yml`; `CLAUDE.md` and `LEARNINGS.md` also changed under .oss/root |

Changed plugin source files (non-test, non-dist):
- hooks (16): `check-updates.sh`, `ensure-decrypt-cli.sh`, `fetch-iron-laws.sh`, `oss-api-curl.sh`, `oss-changelog.sh`, `oss-fetch-team-iron-laws.sh`, `oss-iron-laws-sync.sh`, `oss-login.sh`, `oss-notify.sh`, `oss-push-metrics.sh`, `oss-semver.sh` (A), `oss-session-start-new.sh`, `oss-session-start-test.sh`, `oss-session-start.sh`, `oss-statusline.sh`, `oss-value.sh`. Also added: `hooks/oss-decrypt-checksums.beta.txt`.
- packages/cli-decrypt/src (15): `api-client.ts`, `cache.ts`, `cli-entry.ts`, `commands/decrypt.ts`, `commands/setup.ts`, `config.ts`, `index.ts`, `integrity-pipeline.ts`, `manifest-keys.ts` (A), `safe-write.ts` (A), `storage.ts`, `strip-control.ts`, `update-state.ts`, `verified-manifest.ts` (A), `with-deadline.ts` (A)
- watcher/src (9): `api/api-credentials.ts`, `api/with-deadline.ts` (A), `api/workflow-config.ts`, `detectors/llm-analyzer.ts`, `engine/custom-command-executor.ts`, `engine/index.ts`, `engine/workflow-chain-executor.ts`, `index.ts`, `monitors/iron-law-log-parser.ts`

**Note on the markdown count.** The brief expected 99 conversions. The diff has 160 modified agent, skill and command markdown files. The "99" figure matches the decrypt-CLI install block that was added to 100 of them (`ensure-decrypt-cli.sh ||`). 155 of them gained the `oss-value.sh keycheck` line. The docs disagree on the number: PROGRESS says 99/99, ADR-005 says 101, and the diff shows 160 touched files and 100 with the install block. The count should be settled before the release note is written.

**API (`/Users/ysl/dev/AgenticDevWorkflow-staging`): 23 files changed**
- `packages/api/src/index.ts`, `routes/prompts.ts`, `utils/manifest-generator.ts`, `utils/manifest-signing.ts`, `utils/workflow-names.ts` (A, `workflowCommandName` shared by generator and route), `scripts/verify-manifest.ts`
- `render.yaml` (adds the `one-shot-ship-api-staging` service; not created yet, H1)
- `scripts/oss-channel.sh` (A, unpublished channel switch; `dev` copies hooks with `cp -R`)
- `.github/PULL_REQUEST_TEMPLATE/release.md` (A), `docs/RELEASING.md` (A)
- 13 test files (`packages/api/test/...`, `scripts/__tests__/oss-channel.test.sh`)
- No migrations in either repo.

### Tests Added/Updated
- **Plugin, new suites:** `__tests__/release-channels.acceptance.test.sh`, `__tests__/api-literal-ratchet.test.sh`, `__tests__/prompt-fetch-via-decrypt.test.sh` (+ `fixtures/prompt-fetch-map.tsv`), `__tests__/command-api-calls.test.sh`, `__tests__/trust-allowlist-host.test.sh`, `__tests__/release-checklist.test.sh`, `__tests__/release-cli-decrypt-prerelease.test.sh`, `__tests__/plugin-version-bump-semver.test.sh`, `hooks/__tests__/hooks-follow-api-url.test.sh`, `hooks/__tests__/release-channels.{api,real}.integration.test.sh`, `hooks/__tests__/statusline-channel*.test.sh`, `hooks/__tests__/oss-api-trust.test.sh`, `hooks/__tests__/session-start-untrusted-config.test.sh`, and `packages/cli-decrypt/test/{fail-closed.acceptance,trusted-api-origin,untrusted-address-refused,manifest-key-by-address,staging-key,safe-write-writers,config-read-once,manifest-cache-no-symlink,manifest-timeout,with-deadline-timer,api-timeout,loopback-config-privacy}.test.ts`, and `watcher/test/api/{api-credentials,with-deadline,stalled-response-timeout}.test.ts`.
- **Plugin, updated:** about 38 existing suites were edited to follow `apiUrl` or the new fetch path (for example `oss-api-curl.test.sh`, `iron-laws-sync*.test.sh`, `watcher/test/llm-analyzer.test.ts`, `watcher/test/monitors/iron-law-log-parser.test.ts`).
- **API, new:** `packages/api/test/prompts/{manifest-signing-env,workflow-manifest-agreement}.test.ts`, `test/deploy/render-staging.test.ts`, `test/repo/release-checklist.test.ts`, `test/fixtures/plugin-workflow-names.txt`, and `scripts/__tests__/oss-channel.test.sh` (317 lines).
- **API, updated:** `manifest-integrity`, `manifest-generator`, `manifest-signing`, `verify-manifest`, `generate-manifest`, `render-secrets`, `iron-laws-custom`.

### Database Changes
None. There are no `prisma/migrations` entries and no `*.sql` files in either diff. `render.yaml` declares a staging database, but nothing has been provisioned (H1 is gated on the maintainer's go-ahead and cost approval).

## Why Was It Built This Way?
### Design Rationale
- **Problem:** merging is releasing. Customers install from `main` with no `ref`, and prompts are served live from the API `main` branch. Any merge changes every customer's next command. The maintainer needs to test end to end before customers see new work.
- **Governing rule (maintainer, 2026-10-26):** a stable-channel customer's behaviour must stay unchanged until the first release PR.
- **Three levels:** DEV (local `--plugin-dir`, localhost API), STAGING (`next`, a separate Render service, DB and Stripe test mode, beta marketplace pinned to `next`), PROD (`main`, unchanged). See ADR-004.
- **Trust:** the stable plugin fetched prompts with a raw WebFetch that ignored `apiUrl`, skipped signature checks and put the API key into model context. ADR-005 moves every prompt fetch through `oss-decrypt`, which verifies the signed manifest.

### Key Decisions
From ADR-004 and ADR-005 (Accepted 2026-10-26; Amendment 1 on 2026-10-27):
1. **Separate staging service, DB and signing key.** The production private key never leaves production. Crossed key and address combinations are refused.
2. **One address-to-key rule, fail closed.** The production, staging and loopback origins are trusted (loopback only with no group- or world-write bits). Any other address is refused. The same rule applies to the shell `oss_api_url`, the CLI `trustedApiOrigin` and the watcher `readApiCredentials`, tested against one shared case table. Verification is mandatory: a missing, slow, unparseable, badly signed or unlisted manifest refuses the prompt. Amendment 1 corrected the original fail-open design.
3. **Documented unverified exceptions** (maintainer decision): team custom commands, team and personal custom IRON LAWS, and the per-team workflow config (`/api/v1/workflows`). They are fetched only from a trusted address and marked unverified. Signing them per team is a follow-up.
4. **Team section fenced, new plugin only** (maintainer decision, 2026-10-28, ship round 4 UR1'). The new plugin wraps the team section in a backtick fence that its text cannot leave.
5. **Legacy `/shared/iron-laws` body left as on main.** The stable plugin still writes the team section raw into `CLAUDE.md`. Whether the API fences that body is a release-time decision (FOLLOWUPS, MEDIUM).
6. **Staging signing is explicit.** `MANIFEST_SIGN_AT_STARTUP=1` is set only on the staging service. Otherwise the committed, reviewed manifest is served.
7. **Beta CLI is a GitHub pre-release,** never "Latest", and each plugin version pins its own tag. Separate OSS homes (`~/.oss-stable`, `~/.oss-beta`, `~/.oss-dev`) with `~/.oss` as a symlink.
8. **Release gate is the maintainer's call plus a checklist.** Staging infrastructure requires explicit go-ahead with cost confirmed. IRON LAW #4 is unchanged for customers.

## What Else Does It Affect?
### Downstream Consumers (Import Graph)

Method: a grep for importers of each changed file. TS importers use relative-import patterns (`./x`, `./x.js`, `../x`). Shell importers are files that name the hook by basename, which covers `source` and direct calls. Counts are raw matches and include tests and markdown, so they overstate runtime callers.

**Shell hooks (raw importer count):**
- `hooks/oss-value.sh`: 180 matches. Called from most command and agent markdown (`~/.oss/hooks/oss-value.sh keycheck`, `api`) and by `oss-login.sh` and `oss-session-start.sh`.
- `hooks/ensure-decrypt-cli.sh`: 175 matches. Called from the markdown install block in about 100 agent, skill and command files, and by `oss-semver.sh`.
- `hooks/oss-notify.sh`: 87 matches. Called from most `/oss:*` command markdown and from `check-updates.sh` and `oss-session-start.sh`.
- `hooks/oss-api-curl.sh`: 33 matches. Sourced by 14 hooks, `commands/login.md`, and `watcher/src/api/api-credentials.ts`. This is the single address and key source in shell.
- `hooks/oss-session-start.sh`: 22 matches. Sourced by `oss-notify.sh`, `oss-settings-cleanup.sh`, `oss-simple-mode-check.sh`, `oss-version-check.sh`, `test-hooks.sh`, `commands/resume.md`.
- `hooks/oss-iron-laws-sync.sh`: 13 matches. Called by `oss-session-start.sh`, `oss-setup-permissions.sh`, and `commands/{auto,ideate,login}.md`.
- `hooks/oss-statusline.sh`: 10 matches. Called by the three session-start hooks, `oss-setup-permissions.sh`, `commands/login.md`, and `watcher/src/healthchecks/notifications.ts`.
- `hooks/fetch-iron-laws.sh`: 9 matches. Called by `oss-session-start-new.sh`, `oss-session-start-test.sh`, `oss-setup-permissions.sh`.
- `hooks/oss-login.sh`: 7. `hooks/oss-fetch-team-iron-laws.sh`: 5 (by `oss-iron-law-check.sh`). `oss-push-metrics.sh`, `oss-changelog.sh`, `check-updates.sh`: 4 each. `oss-semver.sh`: 2 (by `ensure-decrypt-cli.sh`). `oss-session-start-new.sh` and `oss-session-start-test.sh`: 3 each, referenced by tests only.

**TypeScript (cli-decrypt and watcher):**
- `packages/cli-decrypt/src/config.ts`: 7 importers (`watcher/src/agents/cli.ts`, `watcher/src/integration/watcher-agents.ts`, `daemon/vitest.config.ts`, `watcher/vitest.config.ts`, plus the CLI `commands/`, `manifest-keys.ts`, `storage.ts`, and so on).
- `packages/cli-decrypt/src/index.ts`: 3 importers in watcher tests. `watcher/src/engine/index.ts`: 3 (watcher tests). `watcher/src/index.ts`: 3 (watcher tests and `spec-metrics.ts`).
- `packages/cli-decrypt/src/api-client.ts`, `cache.ts`, `cli-entry.ts`, `commands/decrypt.ts`, `commands/setup.ts`, `integrity-pipeline.ts`, `manifest-keys.ts`, `safe-write.ts`, `storage.ts`, `strip-control.ts`, `update-state.ts`, `verified-manifest.ts`, `with-deadline.ts`: all imported within `packages/cli-decrypt/src` (for example `storage.ts` by `commands/decrypt.ts` and `commands/setup.ts`). No outside importers.
- `watcher/src/api/api-credentials.ts`: imported by `workflow-config.ts`, `cli/chain-trigger.ts`, `detectors/llm-analyzer.ts`, `engine/custom-command-executor.ts`, `monitors/iron-law-log-parser.ts`.
- `watcher/src/api/with-deadline.ts`: imported by `workflow-config.ts`, `llm-analyzer.ts`, `custom-command-executor.ts`, and the CLI `api-client.ts` and `verified-manifest.ts`.
- `watcher/src/engine/custom-command-executor.ts`: imported by `engine/index.ts` and `engine/workflow-chain-executor.ts`.
- `watcher/src/detectors/llm-analyzer.ts`: imported by `watcher/src/index.ts`.

**API (changed files):**
- `packages/api/src/utils/manifest-generator.ts`: imported by `scripts/generate-manifest.ts`, `scripts/verify-manifest.ts`, `routes/prompts.ts`.
- `packages/api/src/utils/manifest-signing.ts`: imported by the same scripts and `manifest-generator.ts`.
- `packages/api/src/utils/workflow-names.ts`: imported by `routes/prompts.ts` and `manifest-generator.ts`. It is the shared rule that makes the manifest and the route agree on workflow names.
- `packages/api/src/routes/prompts.ts`: imported by `src/index.ts`.
- `packages/api/src/index.ts`: the app entry point. Changed files in `managed-agents/` import from it.
- `scripts/oss-channel.sh`: only `docs/RELEASING.md` and its own test.
- `render.yaml`: read by `packages/api/test/deploy/render-staging.test.ts` and other config tests.

### Test Coverage Map

Method: a basename grep across `*.test.ts` and `*.test.sh`. "Direct" means a test file is named after the source file. "Indirect" means the basename appears only in other suites. This is reference coverage, not line coverage. Every changed source file has at least one reference, so none is uncovered by this measure.

| File Changed | Tests Covering It | Coverage |
|--------------|-------------------|----------|
| hooks/check-updates.sh | `hooks/__tests__/check-updates.test.sh`, `hooks-follow-api-url.test.sh`, `oss-notify-updates.test.sh`, `__tests__/release-channels.acceptance.test.sh` | Direct |
| hooks/ensure-decrypt-cli.sh | `hooks/__tests__/ensure-decrypt-cli.test.sh`, `ensure-decrypt-channel.test.sh`, `iron-laws-sync*.test.sh`, `__tests__/new-user-install.acceptance.test.sh`, `prompt-fetch-via-decrypt.test.sh`, `release-channels.{api,real}.integration.test.sh`, and about 100 command/agent/skill tests | Direct |
| hooks/fetch-iron-laws.sh | `hooks/__tests__/fetch-iron-laws.test.sh`, `oss-api-curl.test.sh`, `hooks-follow-api-url.test.sh`, `release-channels.api.integration.test.sh`, `watcher/test/hooks/hook-error-adoption.test.ts` | Direct |
| hooks/oss-api-curl.sh | `hooks/__tests__/oss-api-curl.test.sh`, `oss-api-curl.real.integration.test.sh`, `oss-api-config-dir.test.sh`, `oss-api-url*.test.sh`, `hooks-read-key-via-helper.test.sh`, `oss-api-trust.test.sh`, `__tests__/api-literal-ratchet.test.sh`, `__tests__/command-api-key-argv.test.sh` | Direct |
| hooks/oss-changelog.sh | `hooks/__tests__/changelog.test.sh`, `hooks-follow-api-url.test.sh` | Direct |
| hooks/oss-fetch-team-iron-laws.sh | `hooks/__tests__/fetch-team-iron-laws.test.sh`, `oss-api-curl.test.sh`, `hooks-read-key-via-helper.test.sh` | Direct |
| hooks/oss-iron-laws-sync.sh | `hooks/__tests__/iron-laws-sync.test.sh`, `iron-laws-sync-safety.test.sh`, `session-start-iron-laws.test.sh`, `release-channels.api.integration.test.sh`, `commands/__tests__/iron-laws-single-writer.test.sh` | Direct |
| hooks/oss-login.sh | `hooks/__tests__/oss-value.test.sh`, `auto-permissions.test.sh`, `commands/__tests__/value-file-wrappers{,-run}.test.sh`, `watcher/test/hooks/session-start-hooks-copy.test.ts` | Indirect |
| hooks/oss-notify.sh | `hooks/__tests__/oss-notify-api-url.test.sh`, `oss-notify-complete-bounds.test.sh`, `oss-notify-dead-vars.test.sh`, `oss-notify-updates.test.sh`, `commands/__tests__/wrapper-complete.test.sh`, `no-model-text-in-failed.test.sh`, and others | Direct |
| hooks/oss-push-metrics.sh | `hooks/__tests__/oss-api-curl.test.sh`, `hooks-follow-api-url.test.sh`, `hooks-read-key-via-helper.test.sh`, `release-channels.real.integration.test.sh` | Indirect (no dedicated suite) |
| hooks/oss-semver.sh | `hooks/__tests__/oss-semver.test.sh` (new), `__tests__/plugin-version-bump-semver.test.sh`, `plugin-version-bump.test.sh` | Direct |
| hooks/oss-session-start-new.sh | `hooks/__tests__/hooks-follow-api-url.test.sh`, `hooks-read-key-via-helper.test.sh`, `session-start-untrusted-config.test.sh` | Indirect (no dedicated suite) |
| hooks/oss-session-start-test.sh | `hooks/__tests__/hooks-follow-api-url.test.sh`, `hooks-read-key-via-helper.test.sh`, `session-start-untrusted-config.test.sh` | Indirect (no dedicated suite) |
| hooks/oss-session-start.sh | `hooks/__tests__/hooks-follow-api-url.test.sh`, `ensure-decrypt-channel.test.sh`, `no-stray-oss.test.sh`, `optional-helper-source.test.sh`, `oss-writer-nofollow.test.sh`, `release-channels.real.integration.test.sh`, `session-routing.test.sh` | Direct (by name, shared suites) |
| hooks/oss-statusline.sh | `hooks/__tests__/statusline-channel.test.sh`, `statusline-channel-cost.test.sh`, `release-channels.api.integration.test.sh`, `watcher/test/hooks/oss-statusline*.test.ts` | Direct |
| hooks/oss-value.sh | `hooks/__tests__/oss-value.test.sh`, `ensure-decrypt-channel.test.sh`, `auto-permissions.test.sh`, `commands/__tests__/no-compound-commands.test.sh`, `value-file-wrappers*.test.sh` | Direct |
| packages/cli-decrypt/src/api-client.ts | `test/api-client.test.ts`, `api-timeout.test.ts`, `commands/decrypt.test.ts`, `commands/setup.test.ts`, `version-and-keyed-fetch.acceptance.test.ts` | Direct |
| packages/cli-decrypt/src/cache.ts | `test/api-client.test.ts` and about 10 hook suites | Indirect |
| packages/cli-decrypt/src/cli-entry.ts | `test/cli.test.ts`, `api-url-source.test.ts`, `trust-acceptance.test.ts`, `untrusted-address-refused.test.ts` | Indirect |
| packages/cli-decrypt/src/commands/decrypt.ts | `test/commands/decrypt.test.ts`, `decrypt-integrity.test.ts`, `__tests__/prompt-fetch-via-decrypt.test.sh`, and others | Direct |
| packages/cli-decrypt/src/commands/setup.ts | `test/commands/setup.test.ts`, `setup.test.ts` | Direct |
| packages/cli-decrypt/src/config.ts | `test/config-read-once.test.ts`, `config-file-trust.test.ts`, `channel-config-dir.test.ts`, `loopback-config-privacy.test.ts`, and `watcher/test/agents/config.test.ts` | Indirect |
| packages/cli-decrypt/src/index.ts | `test/build.test.ts`, `build-targets.test.ts`, `setup.test.ts`, `version.test.ts`, `watcher/test/watcher.test.ts` | Indirect |
| packages/cli-decrypt/src/integrity-pipeline.ts | `test/decrypt-integrity.test.ts`, `test/commands/decrypt.test.ts` | Indirect |
| packages/cli-decrypt/src/manifest-keys.ts | `test/manifest-key-by-address.test.ts`, `staging-key.test.ts`, `fail-closed.acceptance.test.ts`, `trusted-api-origin.test.ts`, `untrusted-address-refused.test.ts`, `__tests__/trust-allowlist-host.test.sh` | Indirect (behaviour-level) |
| packages/cli-decrypt/src/safe-write.ts | `test/safe-write-writers.test.ts` | Indirect |
| packages/cli-decrypt/src/storage.ts | `test/storage.test.ts`, `commands/decrypt.test.ts`, `commands/setup.test.ts`, `fail-closed.acceptance.test.ts` | Direct |
| packages/cli-decrypt/src/strip-control.ts | `test/strip-control.test.ts` | Direct |
| packages/cli-decrypt/src/update-state.ts | `test/update-state.test.ts`, `signature-change.test.ts`, `safe-write-writers.test.ts` | Direct |
| packages/cli-decrypt/src/verified-manifest.ts | `test/manifest-cache-no-symlink.test.ts`, `manifest-timeout.test.ts`, `channel-config-dir.test.ts` | Indirect |
| packages/cli-decrypt/src/with-deadline.ts | `test/with-deadline-timer.test.ts`, `watcher/test/api/with-deadline.test.ts`, `with-deadline-timer.test.ts` | Indirect (no dedicated `with-deadline` suite in the CLI) |
| watcher/src/api/api-credentials.ts | `watcher/test/api/api-credentials.test.ts`, `__tests__/api-literal-ratchet.test.sh` | Direct |
| watcher/src/api/with-deadline.ts | `watcher/test/api/with-deadline.test.ts`, `with-deadline-timer.test.ts`, `stalled-response-timeout.test.ts` | Direct |
| watcher/src/api/workflow-config.ts | `watcher/test/api/workflow-config.test.ts`, `stalled-response-timeout.test.ts`, `cli/chain-trigger.test.ts` | Direct |
| watcher/src/detectors/llm-analyzer.ts | `watcher/test/llm-analyzer.test.ts`, `stalled-response-timeout.test.ts` | Direct |
| watcher/src/engine/custom-command-executor.ts | `watcher/test/engine/custom-command-executor.test.ts`, `custom-command-executor-shell.test.ts`, `workflow-chain-executor.test.ts` | Direct |
| watcher/src/engine/index.ts | `watcher/test/watcher.test.ts`, `e2e/webhook-flow.test.ts`, `watcher-webhook-integration.test.ts` | Indirect |
| watcher/src/engine/workflow-chain-executor.ts | `watcher/test/engine/workflow-chain-executor.test.ts` | Direct |
| watcher/src/index.ts | `watcher/test/watcher.test.ts`, `e2e/webhook-flow.test.ts`, `watcher-webhook-integration.test.ts`, `packages/cli-decrypt/test/build.test.ts` | Indirect |
| watcher/src/monitors/iron-law-log-parser.ts | `watcher/test/monitors/iron-law-log-parser.test.ts` | Direct |
| packages/api/scripts/verify-manifest.ts | `packages/api/test/scripts/verify-manifest.test.ts`, `packages/cli-decrypt/test/cli.test.ts` | Direct |
| packages/api/src/index.ts | many acceptance suites under `packages/api/test/acceptance*` | Indirect |
| packages/api/src/routes/prompts.ts | `packages/api/test/routes/prompts-manifest-route.test.ts`, `packages/api/test/prompts.test.ts`, `prompts/manifest-integrity.test.ts`, and acceptance suites | Direct |
| packages/api/src/utils/manifest-generator.ts | `packages/api/test/utils/manifest-generator.test.ts`, `prompts/manifest-integrity.test.ts`, `prompts/workflow-manifest-agreement.test.ts` | Direct |
| packages/api/src/utils/manifest-signing.ts | `packages/api/test/utils/manifest-signing.test.ts`, `prompts/manifest-signing-env.test.ts` | Direct |
| packages/api/src/utils/workflow-names.ts | `packages/api/test/prompts/workflow-manifest-agreement.test.ts`, `prompts/manifest-integrity.test.ts` (new `workflow-names` helper) | Indirect |
| render.yaml | `packages/api/test/deploy/render-staging.test.ts`, `database/*.test.ts`, `acceptance/mcp-integration.acceptance.test.ts` | Indirect (validates config shape only) |
| scripts/oss-channel.sh | `scripts/__tests__/oss-channel.test.sh` (new, 317 lines) | Direct |

### Uncovered Risk Areas

1. **Staging path has not run.** The beta marketplace (T17), the staging Render service and DB (H1), and the switch-and-run sign-off (H2/H3) are all not done. Staging behaviour is covered only by loopback fixtures, so the first real staging run is the first test of the production-like path.
2. **Test isolation can leak to production.** A HIGH follow-up from the round 4 loaded run: three keyed requests (`subscription/status`, two `analytics/track`) reached curl from background hook calls after their test was killed. A shim refused them. Without the shim they would have reached production with a fake key. The fix (a refusing curl after each stub, on every hook test) is not yet in. Several hook and watcher suites are also flaky under load (vitest 5 s default).
3. **Documented unverified paths and known security gaps.** Team custom commands, team and personal IRON LAWS, and the per-team workflow config are unsigned by design. The legacy `/shared/iron-laws` body is still raw on main for stable customers (MEDIUM, release decision). A validly signed older manifest can be replayed because `generatedAt` is not covered and there is no monotonic check (LOW). macOS ACLs are ignored by the config trust rule (INFO). `oss-channel.sh dev` copies symlinks into the channel home (INFO, maintainer-only).
4. **Customer-visible regressions.** Without jq, a nested `config.json` (old `telegram` or `models` block) now yields no key and `apiUrl invalid`, where the old grep read worked (MEDIUM, release note). Personal (solo-user) IRON LAWS have never been appended, on main or here (LOW). `hooks/oss-fetch-team-iron-laws.sh` does not fetch the personal endpoint. The 403 branch in `fetch-iron-laws.sh` was lost, so an expired subscription reads as "Request failed" (LOW).
5. **Gates and counts are not settled.** Ship round 5 gates have not been re-run on the round 4 fixes. The number of converted prompt files is inconsistent across docs (99, 100, 101, 155, 160). The maintainer steps before a release are still open: re-sign the production manifest for every `workflows/*` entry (SR1), publish and pin a stable `cli-decrypt >= 1.3.0`, and publish the beta tag `cli-decrypt-v1.3.0-beta.1` with committed checksums.
