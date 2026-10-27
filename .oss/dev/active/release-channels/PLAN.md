# Implementation Plan: Release channels (DEV / STAGING / PROD)

## Summary
Build a STAGING swimlane next to production for OSS (plugin + API/prompts) so the maintainer can run new work end to end before customers get it. **Governing rule: a stable-channel customer's behaviour stays unchanged until the maintainer's first release PR.** Every task lands on `next`, never on `main`.

## Design Reference
- `.oss/dev/active/release-channels/DESIGN.md` (COMMITTED 2026-10-26)
- `docs/requirements/release-channels.md` (US-001 … US-008)
- `docs/architecture/decisions/ADR-004-release-channels.md`, `ADR-005-channel-trust.md`

## Plan-time findings (task 0, done 2026-10-26)
- **The API serves the converted types through `oss-decrypt`.** On production, 53 of 55 distinct `agents/` + `workflows/` prompts and 6 of 6 `skills/` prompts decrypted and verified.
- **Two prompts fail integrity on production:** `agents/performance-auditor` and `agents/visionos-developer` ("[SECURITY] Prompt integrity check FAILED"). Customers don't see it today, because those agents use the unchecked WebFetch path. Converting them before Task 9 would break them.
- **The 101 `URL:` sites are 99 prompt fetches** (80 `prompts/agents`, 13 `prompts/workflows`, 6 `prompts/skills`) **plus 8 non-prompt calls**: `commands/login.md` (subscription/status ×3, prompts/claude-md), `commands/status.md` (auth/verify) and `commands/workflows.md` (workflows ×2).
- Follow-ups pulled in from `.oss/dev/FOLLOWUPS.md`: **#14, #44, #45, #47, #69** (same files and call sites).

## Where work lands
- Phase A creates `next` in both repos. This branch (`feat/release-channels/plan`) is then rebased onto `origin/next`, and build branches start from `origin/next`.
- Plugin repo: Phases B–E, G (version). API repo (`AgenticDevWorkflow`): Phase C Task 9, Phase F, Phase G (script).
- ⛔ **External actions need the maintainer's explicit go-ahead at the moment they happen:**
  - pushing the new `next` branches (A1)
  - creating the beta marketplace repo (T17)
  - creating the Render service and DB (H1)
  - generating and storing the staging signing key (T11)

---

## Phase A: Branches and repo notes (no code)

### Task 1: Create `next` in the plugin and API repos (DONE 2026-10-26)
Pushed after the go-ahead: plugin `next` = 2c36f9f, API `next` = e50fe47 (both equal to `main` at creation). This branch was rebased onto `origin/next`.
- `git fetch origin main && git push origin origin/main:refs/heads/next` in each repo. ⛔ Confirm first.
- Rebase `feat/release-channels/plan` onto `origin/next` (same commit today).
- **Acceptance:** `git ls-remote --heads origin next` returns a sha equal to `origin/main` at creation, in both repos.

### Task 2: Repo note "integration branch is `next`" (AC-008.2)
**RED:** `__tests__/integration-branch-note.test.sh`
- `should name next as the integration branch in CLAUDE.md, outside the IRON LAWS block`: the note's line number < the IRON LAWS start marker, or the note sits after the END marker
- `should not change the IRON LAWS block`: the block's bytes are unchanged vs `origin/main`
**GREEN:** add a `## Branching in this repo` section to `CLAUDE.md` above the IRON LAWS block. The same note goes into the API repo (its own test in `packages/api/test/repo/integration-branch-note.test.ts`).

### Task 2b (API repo): CI runs on `next` too
Found 2026-10-26, when `next` was pushed: `.github/workflows/test.yml` triggers only on `push: [main]` and `pull_request: [main]`, so a PR into `next` gets no CI. The plugin repo has no test workflow at all (release workflows only; out of scope here).
**RED:** `packages/api/test/repo/ci-triggers.test.ts`: `should run test.yml on push and pull_request for main and next`.
**GREEN:** add `next` to both trigger lists. Nothing that deploys (`sync-mcp-time.yml`, render.yaml) is changed.

---

## Phase B: One source for the API address

### Task 3: Ratchet: the production API literal appears only in the allowlist (AC-002.3)
**RED:** `__tests__/api-literal-ratchet.test.sh`
- `should find the production API literal only in allowlisted files`: `git grep -l` of `one-shot-ship-api.onrender.com` and `api.oneshotship.com` minus the allowlist = empty. Expected to fail now, listing ~15 code sites plus 101 markdown sites.
- **Allowlist (exact paths; each entry carries a reason comment in the test):**
  - `hooks/oss-api-curl.sh` (shell default)
  - `packages/cli-decrypt/src/config.ts` (CLI default)
  - `watcher/src/api/api-credentials.ts` (TS default)
  - `commands/trust.md` (exfiltration allowlist line, guarded by `trust-allowlist-host.test.sh`)
  - `ARCHITECTURE.md`
  - `**/__tests__/**`, `**/test/**`
  - generated `**/dist/**` (rebuilt from src, checked by the dist-fresh test)
  - `.oss/dev/**`, `LEARNINGS.md`
- `should fail when a new file adds the literal` (anti-vacuity): copy a temp file with the literal into a temp clone → the ratchet goes red.
**GREEN:** none in this task. It stays RED and the following tasks turn it green. Mark it `expected-red` in TESTING.md until Task 8, and **do not skip it**: Phase B and C commits each shrink its offending list, and the list printed in the failure message is the progress measure.
> If the suite must be green at every commit (IRON LAW: never commit failing tests), land T3 **last in Phase C** instead, after T4–T8 each carry their own per-site rows. **Decide at build start; default = land T3 after T8.**

### Task 4: Hooks follow `apiUrl`: session start, push-metrics, iron-laws sync (AC-002.1, AC-001.1)
**RED:** `hooks/__tests__/hooks-follow-api-url.test.sh` (loopback test server: `python3 -m http.server` or a `nc` stub that records request lines; temp `OSS_CONFIG_DIR`)
- per hook: `should send its request to apiUrl when apiUrl is a loopback server`
- per hook: `should send its request to the production default when apiUrl is absent` (asserted on the URL handed to a `curl` shim, so the default is checked without network)
- per hook: `should send nothing and report the config error when apiUrl is invalid` (AC-002.4)
- Hooks: `oss-session-start.sh` (subscription/status), `oss-push-metrics.sh`, `oss-iron-laws-sync.sh`, `oss-fetch-team-iron-laws.sh`, `fetch-iron-laws.sh`
**GREEN:** replace each literal with `API_URL=$(oss_api_url) || { …config error…; exit 0; }` using the existing helper. Hooks never fail the session: keep each hook's current exit behaviour.
**REFACTOR:** none beyond removing the literals.

### Task 5: Hooks follow `apiUrl`: changelog, check-updates, login, the two retired session-start variants
**RED:** extend `hooks-follow-api-url.test.sh` with rows for `oss-changelog.sh`, `check-updates.sh` (manifest URL), `oss-login.sh` (the `apiUrl` it writes = the current helper value or the default), `oss-session-start-new.sh`, `oss-session-start-test.sh`.
- `should derive the manifest URL from apiUrl`: `$(oss_api_url)/api/v1/prompts/manifest`
- **Provenance:** `OSS_MANIFEST_URL` today is a second source of the same value. Check existing tests (`changelog.test.sh`, `check-updates.test.sh`) for use. If only tests use it, those tests switch to `OSS_CONFIG_DIR` + `apiUrl` and the variable is removed. If anything else uses it, record it in NOTES.md and keep it as a test-only override that must equal the derived value.
**GREEN:** route through `oss_api_url`.

### Task 6: Watcher address and key senders follow the same rule (AC-002.2, #45, #47)
Delegate: `typescript-pro`.
**RED:** `watcher/test/api/api-credentials.test.ts`
- `should agree with oss_api_url on every row of api-url-cases.json` (reads `packages/cli-decrypt/test/fixtures/api-url-cases.json`)
- `should refuse a config.json that is a symlink, not owned by the user, or group/world-writable` (#47)
- `should refuse an apiKey that is not a string or contains CR/LF` (#47)
`watcher/test/engine/custom-command-executor.test.ts` (#45):
- `should take the URL and key from readApiCredentials`
- `should refuse a non-https apiUrl (loopback http allowed, as the rule says)`
- `should refuse a command name that fails isSafeTeamCommandName and encode the name`
- `should time out` and `should refuse a redirect`
**GREEN:** `api-credentials.ts` applies the shared rule; `llm-analyzer.ts`, `monitors/iron-law-log-parser.ts`, `cli/chain-trigger.ts` and `engine/custom-command-executor.ts` use `readApiCredentials()`. Rebuild `watcher/dist` and run `watcher-dist-fresh.test.sh` (extend it to `.cjs` only if the chain-trigger bundle changes; follow-up #43 stays open otherwise).
**No `any`.**

### Task 7: Non-prompt calls in commands follow `apiUrl` and keep the key out of argv (#14)
**RED:** `__tests__/command-api-calls.test.sh`
- `should route every API call in commands/login.md, status.md, workflows.md, settings.md, telegram.md through oss_api_curl with $(oss_api_url)`: no `curl … -H "Authorization` and no literal host in those files
- the existing `__tests__/command-api-key-argv.test.sh` stays green
**GREEN:** edit the steps in those five files to source `~/.oss/hooks/oss-api-curl.sh` and call `oss_api_curl "$(oss_api_key)" … "$(oss_api_url)/api/v1/…"`.

---

## Phase C: Prompt fetches only through `oss-decrypt`

### Task 8: Ratchet + conversion of the 99 prompt-fetch steps (AC-003.1, AC-003.2, #44, #69)
**RED:** `__tests__/prompt-fetch-via-decrypt.test.sh`
- `should contain no WebFetch of the OSS API in agents/, skills/, commands/`
- `should name oss-decrypt --type <t> --name <n> where <t>/<n> is the prompt the file used to fetch`: a fixture table generated **now** from the current URLs (`test/fixtures/prompt-fetch-map.tsv`, 99 rows) so the mapping can't drift during conversion
- `should not print the API key into the transcript` (#44): no `grep apiKey` / `cat ~/.oss/config.json` in those files; the auth check is the quiet form used in `commands/visual-test.md`
- `should not put model-filled text in any prompt-fetch line` (#69): no `{user_context}` or `?context=`
**GREEN:** a one-off transformation script (`scripts/dev/convert-prompt-fetch.sh`, deleted after the run, kept in the PR description) rewrites each file's fetch step to `~/.oss/bin/oss-decrypt --type <t> --name <n>`. The quiet auth check replaces the `grep apiKey` step. Review: spot-check 10 files by hand plus the full diff stat.
- **Exclude `agents/performance-auditor.md` and `agents/visionos-developer.md`** (and their `skills/` twins) until Task 9 lands. The fixture marks them `blocked-by:T9`, and the ratchet allows exactly those two until then.
**REFACTOR:** if the step text is duplicated 99 times, keep it duplicated (one line); don't introduce an include mechanism (YAGNI).

### Task 9 (API repo): every served prompt matches its manifest hash. Maintainer wants performance-auditor and visionos-developer fixed (2026-10-26)
Delegate: `typescript-pro`. Branch from `origin/next` in AgenticDevWorkflow.
**RED:** `packages/api/test/prompts/manifest-integrity.test.ts`
- `should hash every prompt file to the value in the generated manifest`, over **all** prompts. It must fail today for `agents/performance-auditor` and `agents/visionos-developer`.
**GREEN:** find the cause (stale manifest, normalisation difference, or content post-processing; investigate before fixing, and record the cause in NOTES.md) and fix it at the source, so the class can't recur.
**Then:** remove the `blocked-by:T9` exemption from Task 8's ratchet and convert the two files (and their twins).

---

## Phase D: Trust

### Task 10: `oss-decrypt` picks the signing key by address (AC-004.x, AC-001.3)
Delegate: `typescript-pro`.
**RED:** `packages/cli-decrypt/test/manifest-key-by-address.test.ts` (test keypairs generated in the test; the real public keys are injected through the same lookup the CLI uses)
- prod address + prod signature → accepted
- staging address + staging signature → accepted
- loopback (`http://localhost:*`, `127.0.0.1`, `[::1]`) + staging signature → accepted
- prod address + staging signature → refused
- staging address + prod signature → refused
- unknown https address → refused, with a message containing `apiUrl`
- `should keep the production public key byte-identical to today` (guards AC-001.3)
**GREEN:** replace the single `MANIFEST_PUBLIC_KEY` with a lookup `publicKeyFor(apiUrl)`. The staging address constant is a placeholder until H1 fixes the hostname, and the test reads it from the same constant.
**Provenance:** grep for every other use of `MANIFEST_PUBLIC_KEY` and of the manifest verification (`verifyManifestSignature` callers, `/oss:trust` docs) and record them in the commit body.

### Task 11: The staging signing key exists (public half committed, private half never in a repo)
⛔ Maintainer step, guided:
- generate an Ed25519 pair locally (`openssl genpkey -algorithm ed25519`)
- the private key goes to the maintainer's password manager and later to the Render staging env
- the base64 SPKI public key goes into `config.ts` (staging slot)
**RED:** `packages/cli-decrypt/test/staging-key.test.ts`: `should hold a valid Ed25519 SPKI public key in the staging slot that differs from the production key`.
**GREEN:** commit the public key only. Check `git log -p` for any PEM private-key header (a ratchet row in Task 3's test: no `BEGIN PRIVATE KEY` anywhere).

### Task 12: `/oss:trust` allowlist names the staging host
**RED:** extend `__tests__/trust-allowlist-host.test.sh`: `allowlist names the staging host` (from the same constant source as Task 10; fail if the two differ).
**GREEN:** edit the `commands/trust.md` allowlist line.

### Task 13: Beta decrypt CLI ships as a GitHub pre-release
**RED:** extend `__tests__/release-workflows.test.sh`
- `should mark a cli-decrypt-v*-beta.* tag as prerelease and never latest` (assert `prerelease: true` and `make_latest: false` for beta tags in `.github/workflows/release-cli-decrypt.yml`)
- `should keep stable tags as today`
`hooks/__tests__/ensure-decrypt-cli.test.sh`: `should pin the beta tag on a beta-versioned plugin and the stable tag otherwise`. The pin is read from one place, the plugin version.
**GREEN:** workflow conditional; the pin source in `ensure-decrypt-cli.sh`.

---

## Phase E: Visibility

### Task 14: Status line shows `⚠ STAGING` and a mismatch warning (AC-005.x)
**RED:** `hooks/__tests__/statusline-channel.test.sh` (temp `OSS_CONFIG_DIR`, temp plugin root with a `plugin.json` version)
- prod address + stable version → no channel marker
- staging address + beta version → `⚠ STAGING`
- loopback + any version → `⚠ STAGING`
- prod address + beta version → mismatch warning
- staging address + stable version → mismatch warning
- invalid apiUrl → the existing config error marker, never `STAGING` or blank
**GREEN:** in `hooks/oss-statusline.sh`, classify via `oss_api_url` (one source) and read the version from the plugin root.
**Provenance:** `oss-session-start*.sh` also print status; grep for any other place that renders channel or version and route it through the same classifier, or record why not.

---

## Phase F: Staging server (API repo)

### Task 15: `render.yaml` defines an isolated staging service (AC-007.1, AC-007.2)
Delegate: `deployment-engineer`.
**RED:** `packages/api/test/deploy/render-staging.test.ts` (parse `render.yaml`)
- `should define one-shot-ship-api-staging on branch next`
- `should share no env group, DB or secret reference with the production service`
- `should reference Stripe test keys by name (sk_test placeholder name), never a live-key variable`
- `should keep the production service definition byte-identical`
- `should use an always-on plan` (not free; U1)
**GREEN:** add the service block. Values are not committed (Render dashboard env).

### Task 16: The API signs the manifest with the key from its own environment
**RED:** `packages/api/test/prompts/manifest-signing-key.test.ts`
- `should sign with the key from MANIFEST_SIGNING_KEY` (or the existing variable name; check first)
- `should fail to start without it` (never an unsigned manifest)
**GREEN:** only if signing is not already env-driven. If it already is, record that in NOTES.md and keep the test as a guard.

---

## Phase G: Switching and versions

### Task 17: Beta marketplace repo
⛔ Confirm before creating the private repo `501336North/one-shot-ship-plugin-beta`.
- Contents: `.claude-plugin/marketplace.json` with `oss` → `{"source":"github","repo":"501336North/one-shot-ship-plugin","ref":"next"}`, `strict: true`, same plugin name `oss`.
- **Acceptance:** `claude plugin validate .` passes; `claude plugin marketplace add` + `install oss@one-shot-ship-plugin-beta` on the maintainer's machine (from Task 18's script) installs the `next` version.

### Task 18 (API repo): `scripts/oss-channel.sh stable|beta|dev` (AC-006.x)
Delegate: `deployment-engineer` (shell).
**RED:** `scripts/__tests__/oss-channel.test.sh` (throwaway `HOME`; a `claude` shim that records `plugin marketplace add/remove` and `plugin install` calls)
- `should migrate a plain ~/.oss to ~/.oss-stable behind a symlink, contents byte-identical, after a backup` (AC-006.1)
- `should do no migration when ~/.oss is already a symlink`
- `should switch stable → beta → stable and leave ~/.oss-stable byte-identical` (AC-006.2)
- `should install oss from the matching marketplace on each switch`
- `should restore the previous target and exit non-zero when a step fails mid-switch` (AC-006.3)
- `should refuse beta/dev without jq` (edge case)
- `should create a missing ~/.oss-<channel> and tell the user to /oss:login there`
- `should print channel, plugin version and API address` (AC-006.4)
- `should, for dev, copy hooks from the given working copy into ~/.oss-dev/hooks and print the claude --plugin-dir command` (AC-006.5)
- `should refuse a working copy path that is not a plugin checkout` (dev)
**GREEN:** the script, bash 3.2 compatible.

### Task 19: Beta versions on `next` (AC-008.4)
**RED:** extend `__tests__/plugin-version-bump.test.sh`: `should accept X.Y.Z-beta.N on next and reject a prerelease version in a release PR`. Also `hooks/check-updates.sh`/`oss-version-check.sh` compare versions with prereleases correctly (a `2.1.0-beta.3` vs `2.0.91` row).
**Measured defect (2026-10-26, T4):** `__tests__/plugin-version-bump.test.sh` compares with `sort -V`, which ranks `2.1.0-beta.1` ABOVE `2.1.0`, so the first release PR (beta → stable) would fail the bump check. The prerelease-aware comparison must cover this test too.
**GREEN:** `.claude-plugin/plugin.json` on `next` is already `2.1.0-beta.1` (set in T4, which first changed shipped paths); adjust the version comparison helper(s). Provenance: grep for every version comparison (`version_gte`, sort -V) and route them through one helper.

### Task 20: Release PR template and RELEASING.md (AC-008.3)
**RED:** `__tests__/release-checklist.test.sh`: `should list the four checklist items in .github/PULL_REQUEST_TEMPLATE/release.md` (STAGING run, version bump, API + migrations first, merge-back) and `docs/RELEASING.md` should describe hotfix → merge-back.
**GREEN:** add both files (the plugin repo, and the same in the API repo).

---

## Phase H: Bring-up and acceptance (maintainer, manual)

### H1: Create the staging infra ⛔
After an explicit go-ahead with cost: create the Render service from `render.yaml`, the staging DB and Stripe test keys; set the staging signing key; fix the hostname and update the T10/T12 constant (one source).

### H2: Switch and run
`scripts/oss-channel.sh beta` → `/oss:login` on staging → run ideate → plan → build → ship on a real repo with `⚠ STAGING` visible. Then `oss-channel.sh stable` and confirm the stable home is unchanged.

### H3: Acceptance sign-off
Tick the DESIGN.md success criteria. Sprint D can then start on `next`.

---

## Implementation Sequence
1. **Phase A** (T1–T2): unblocks everything. T1 needs the go-ahead.
2. **Phase B** (T4 → T5 → T6 → T7): independent of each other once A is done. T6 can run in parallel with T4/T5.
3. **Phase C** (T9 API, in parallel with T8). The T8 exemption is removed after T9. **T3 ratchet lands here**, after T4–T8 (default).
4. **Phase D** (T10 → T11 → T12, T13): T11 needs the maintainer.
5. **Phase E** (T14): needs T10's address classification constant.
6. **Phase F** (T15, T16): can run in parallel with D/E.
7. **Phase G** (T19 → T17 → T18 → T20): T18 needs T17's marketplace name and T19's version scheme.
8. **Phase H**: manual, gated.

## Testing Strategy
### Unit / behaviour
- shell: one row per hook and per command call site; status line rows; switch-script rows in a throwaway HOME
- TS: watcher credentials vs the shared case table; custom-command executor; cli-decrypt key table; API manifest integrity, signing key, render.yaml shape
### Ratchets (repo-wide guards)
- the production literal only in the allowlist (T3)
- no WebFetch of the API, no key printing, no model text in fetch lines (T8)
- no private key material in the repo (T11)
### Integration
- `hooks/__tests__/oss-api-curl.real.integration.test.sh` stays green
- H2 end-to-end run on staging
### Edge cases
- invalid apiUrl → nothing sent (T4/T5)
- no jq → switch refused (T18)
- mid-switch failure → restored (T18)
- unknown address → refused (T10)
- prerelease version comparison (T19)

## Security Checklist
- [ ] The prod private key is never in staging or any repo (T11 ratchet, T15)
- [ ] Unknown `apiUrl` → refused by the verifier (T10); invalid `apiUrl` → nothing sent (T4/T5)
- [ ] The API key never in argv (T7, existing argv test) and never printed into the transcript (T8 / #44)
- [ ] The watcher config read refuses symlinks / foreign owner / loose perms (T6 / #47)
- [ ] The second key sender is hardened (T6 / #45)
- [ ] Beta CLI never "Latest" (T13)

## Performance Considerations
- None material. Status line classification is one `jq` call already made by `oss_api_url`; keep it to one call per render.

## Rollout Strategy
- **No customer exposure until the first release PR** (`next` → `main`).
- Rollback on `next`: revert the commit; the stable channel is unaffected by construction.
- Rollback of a switch: `oss-channel.sh stable` (byte-identical stable home), plus the backup made at first migration.

## Estimated Tasks: 20 build tasks + 3 manual bring-up steps
## Estimated Test Cases: ~95

---

## Ship round 1 fix tasks (2026-10-27, from the 4 quality gates)
All four gates FAILED. Round 1 fixes every finding that matters. Plugin work lands on `feat/release-channels/ship`, API work on `feat/release-channels/build-t15-t18`. Each fix is RED-first with a test that fails without it.

Maintainer decisions (2026-10-27):
- **Team custom commands:** stay the ONE documented unverified exception (DB-served, per team). They are fetched only from a trusted address (FR4), and the output marks them unverified. Recorded in ADR-005, with a follow-up to sign them per team.
- **IRON LAWS + CLAUDE.md template:** signed in this round (FR15). The per-team workflow config (`/api/v1/workflows`) stays unsigned but host-restricted (FR4). Recorded in ADR-005, with a follow-up.

### FR1 (HIGH): beta plugin gets a beta oss-decrypt
`ensure-decrypt-cli.sh` pins `cli-decrypt-v1.2.4` (production key only). Requirements:
- Bump `packages/cli-decrypt` (package.json + `VERSION`) to `1.3.0-beta.1`.
- The tag comes from the plugin version: a beta plugin uses the beta CLI tag, a stable plugin keeps `cli-decrypt-v1.2.4`.
- The tag check accepts the pre-release form.
- An installed binary must equal the pinned version exactly when either one is a pre-release.

Tests: the pin follows the plugin version; a pre-release tag is accepted; a beta binary does not satisfy a stable pin.

### FR2 (HIGH): converted fetches install the CLI first
The 99 converted agents/skills run `~/.oss/bin/oss-decrypt` without `ensure-decrypt-cli.sh`, so a fresh install fails. Add the same guarded step the commands use. Extend `prompt-fetch-via-decrypt.test.sh` to require it before the decrypt line.

### FR3 (HIGH, security): oss-decrypt fails closed
A missing, slow or unparseable manifest, or a prompt missing from it, currently delivers the prompt unverified. Requirements:
- Fail closed for every manifest-covered type.
- Fetch the manifest in parallel with the prompt, with a 10 s timeout.
- Cache the verified manifest under `~/.oss/run` (TTL 300 s, per API origin).
- The custom type stays the documented exception.

API side (`build-t15-t18`): the manifest gains signed `workflows/<name>` entries for every WORKFLOW_NAME_MAPPINGS entry, hashed as served. Otherwise every workflow prompt would be refused.
**Production note:** the production manifest must be re-signed with these entries before the plugin release ships.

Tests:
- manifest missing / timeout / prompt absent → refused
- custom → delivered, marked unverified
- parallel fetch
- cache hit, and cache refused when the signature fails
- the API integrity test covers `workflows/*`

### FR4 (MED, security): one trusted-address rule for every key sender
Accept only:
- production
- staging (`https://one-shot-ship-api-staging.onrender.com`)
- loopback http

Apply this in:
- the shell `oss_api_url` (and therefore every hook and verb)
- the watcher `readApiCredentials`
- the CLI (already)

`oss-login` refuses anything else. Extend the shared `api-url-cases.json` with allowlist rows (a custom https host is refused), and run all three readers against it.

### FR5 (MED, security): no silent production fallback without jq
When `config.json` names an `apiUrl` and jq is missing, `oss_api_url` refuses (rc 1) instead of returning production. The status line shows a clear marker.

### FR6 (MED): origin normalisation in one place
- A trailing `/` and `https…:443` normalise to the origin before classification.
- The status line compares origins (no false STAGING for `…com/` or `…com:443`).
- Status line uses ≤1 jq call per render (perf gate: +19 ms).

### FR7 (MED): one config-file trust rule
In the shell, the CLI and the watcher, refuse:
- a symlinked `config.json`
- a `config.json` owned by someone else
- a world-writable `config.json`

Allow group-writable (umask 002). Add a test row for mode 0664.

### FR8 (MED, security, API): startup signing only on explicit opt-in
`MANIFEST_SIGN_AT_STARTUP=1`, set in `render.yaml` on the staging service only, enables signing at startup. With a key present but no flag (local dev, production), the committed manifest is served.

### FR9 (MED, security, watcher): no shell interpolation in custom-command-executor
Validate the name at the top of `invokeCommand`, and use `execFile` with an argv array (not `exec` with a string).

### FR10 (LOW–MED, watcher): the iron-law-log-parser hint never shows a curl with the key
Point the hint at the allowlisted path (`~/.oss/hooks/oss-iron-laws-sync.sh` / `oss-value.sh`).

### FR11 (LOW): the workflow name cannot be dots only
`oss-value.sh`: `.`/`..` are refused for `workflow` (and `category`/`name` if they can be).

### FR12 (MED/LOW, API script): oss-channel.sh hardening
- Backup created under `umask 077` (0600).
- Channel homes `mkdir -m 700`.
- A symlinked `~/.oss-<channel>` is refused.
- `dev`: `cd -- "$2" || die`, and print the path with `printf %q`.
- A newly created beta home is seeded with `config.json` `{"apiUrl": "<staging>"}` (no key).

### FR13 (LOW): release workflow classifies by the version part
Every tag contains `-` (`cli-decrypt-v…`). Classify with the part after `cli-decrypt-v`, in a step whose logic the test actually runs (sample tags: stable → not pre-release; beta → pre-release, never Latest).

### FR14 (LOW, perf, watcher): llm-analyzer request timeout
`AbortSignal.timeout(10_000)`, the same as custom-command-executor.

### FR15 (MED, security, maintainer decision): IRON LAWS + CLAUDE.md template verified
- `fetch-iron-laws.sh` / `oss-iron-laws-sync.sh` fetch `shared/iron-laws` through `oss-decrypt` (signature + hash), and the template (`templates/claude-md`) is verified the same way.
- `oss-decrypt` gains the `shared`/`templates` types if needed (API routes exist: check that they serve encrypted payloads).
- `/oss:login` and `skills/ideate.md` use the verified path.

## Ship round 2 fix tasks (2026-10-27, from the 4 round-2 quality gates)

Round-2 rule: CRITICAL/HIGH and every security finding block; other findings that matter are fixed here when a
round-1 fix did not land, otherwise they go to `.oss/dev/FOLLOWUPS.md`. Every task is RED first.

### SR1 (HIGH, API, IRON LAW #1b): one rule for which workflow names are signed
- The route serves `workflows/<n>` from `workflowCommandName(n)` (mapped alias, else `commands/<n>`); the generator
  signs only the 22 mapped names, so 29 shipped wrappers (`quick`, `xray`, `verify`, `deploy`, `test`, ...) are refused
  by the fail-closed CLI. The generator emits `workflows/<n>` for every name the route can serve, through the same helper.
- Guard: a committed list of every `--type workflows --name X` the plugin ships; each has a manifest entry.

### SR2 (MED, security): a group-writable config cannot point the key at loopback
- Shell, CLI, watcher: a loopback `apiUrl` is trusted only when `config.json` and its directory are not group- or
  world-writable. Production/staging with a group-writable config stay accepted (customers unchanged).

### SR3 (LOW, security): read the config once, after the check
- CLI: `O_NOFOLLOW` open + `fstat` on the same fd (as the watcher). Shell: the trust check and the reads use one copy.

### SR4 (LOW, security): the manifest cache never writes through a symlink
- Refuse a symlinked or foreign-owned `run/`; write the cache via temp file + rename (or `O_NOFOLLOW|O_CREAT`).

### SR5 (LOW, security): `~/.oss/plugin-root` is validated in ensure-decrypt-cli.sh
- Same checks as `_ov_root` (not a link, owned by the user, absolute path, one line) for the pin and checksum reads.

### SR6 (LOW, security): the laws sync always runs ensure-decrypt-cli.sh first
- `oss-iron-laws-sync.sh` and `fetch-iron-laws.sh` call it every time (no-op when the pin is met), so an outdated CLI is upgraded.

### SR7 (LOW, security): custom-command text is stripped of control characters
- `decrypt.ts` prints the `--type custom` body through `stripControl()`.

### SR8 (LOW, security): no jq never hides STAGING
- The status line renders the channel section (or a channel-unknown marker) before the `[jq required]` early exit.

### SR9 (MED, perf, round-1 fix did not land): status-line channel cost
- `compute_channel` / `oss_api_url` without `id`, `find`, `tr`, `head` forks (`$EUID`, `[[ -O ]]`, bash case folding,
  one `sed`), and/or a channel cache newer than config.json and plugin.json. Guard: a timed assertion vs a baseline.

### SR10 (LOW, perf, FR14 did not land): timeouts that survive a stalled body
- `llm-analyzer.ts` and `custom-command-executor.ts`: `AbortController` + `setTimeout` cleared after the body is read.
  Guard: a server that sends headers then stalls.
- CLI keyed prompt fetch: a 60 s limit with a clear message.

### SR11 (LOW): the iron-laws watchdog leaves no stray `sleep`

### SR12 (LOW, watcher): the refresh-laws hint actually refreshes (or tells the model to read the existing block)

### SR13 (LOW, test this feature broke): `watcher/test/hooks/oss-statusline-next-command.test.ts:163`
- Pin the plugin version / apiUrl so the channel mismatch warning does not leak into the next-command assertion.

### SR14 (LOW/INFO, IRON LAW #1b): one canonical port rule
- Add `:0443`, `localhost:80`, `localhost:00080` rows to `trusted-api-url-cases.json`; the shell canonicalises the port numerically as `URL` does.

### SR15 (INFO, API): `WORKFLOW_NAME_MAPPINGS` lookup uses own keys only (`constructor` -> 404/400, not 500)

### SR16 (maintainer decision 2026-10-27: "Keep for customers"): team IRON LAWS stay in CLAUDE.md
- API `/shared/iron-laws`: unchanged for old plugins (base + team/personal append, as on main); with the new CLI's
  request for the signed base only (e.g. `?base=1`), the signed file byte-for-byte.
- New plugin: the sync appends team/personal laws below the verified block, marked unverified (Amendment 1 rule 3).
- Correct the inaccurate premise in `.oss/dev/FOLLOWUPS.md` and ADR-005 Amendment 1.

### To FOLLOWUPS (not this round)
- Replay of an old signed manifest (sign `generatedAt` + monotonic check: needs a format change older CLIs reject).
- `--list-prompts` reads the manifest unverified; `--verify-manifest` has no timeout (pre-existing).
- `OSS_DECRYPT_TAG` / `OSS_DECRYPT_CHECKSUMS` env overrides outside tests (pre-existing).
- `oss-channel.sh dev` copies hook symlinks as symlinks (maintainer-only).

### SR17 (LOW, security, IRON LAW #1b from SR4): every CLI writer refuses symlinks
- Found while fixing SR4: `src/cache.ts:152` (prompt cache), `src/update-state.ts:50`, `src/storage.ts:102` (credentials)
  write by path and follow symlinks. Same rule as the manifest cache: one shared safe-write helper (no-follow dir,
  owner check, temp file + rename), every writer routed through it.

### SR18 (integration break found merging round 2): watcher hook-error-adoption vs SR6
- `watcher/test/hooks/hook-error-adoption.test.ts` (fetch-iron-laws.sh, 4 tests) runs the real hook with a stub
  v0.0.0 CLI; since SR6 the hook always runs `ensure-decrypt-cli.sh`, which judges the stub outdated, so the
  expected OSSError emits never happen. Stub the installer as the shell suites do, keep every original assertion.
