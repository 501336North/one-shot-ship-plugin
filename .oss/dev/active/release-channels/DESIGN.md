# Feature: Release channels (DEV / STAGING / PROD) for OSS

Status: COMMITTED (2026-10-26, Boss)

## Problem
For OSS, merging is releasing:
- **Plugin:** customers install `oss` from `501336north/one-shot-ship-plugin` with no `ref`, so it tracks `main`. A merge reaches them on their next plugin update.
- **Prompts:** they are code in `AgenticDevWorkflow/packages/api/src/prompts/`, deployed to Render `one-shot-ship-api` from `main` (render.yaml). A merge there changes every customer's next command immediately.

Sprint D (oss-lab PR #188, determinism) will change how OSS behaves, and paying customers depend on the current version. Boss needs to test new work himself before it reaches them. Boss is the only tester for now; external testers must be possible later without rework.

Scope: OSS only (plugin + API/prompts). oss-lab is unreleased and out of scope.

**Governing principle (Boss, 2026-10-26):** "as long as current customers aren't impacted, creating a new swimlane for testing what I'm developing without the current customer running any risks is an improvement." Every task in this feature must leave a stable-channel customer's behaviour byte-for-byte unchanged until Boss's first release PR. Any task that cannot meet this stops and is raised.

## Solution
Three levels:

| | DEV | STAGING | PROD |
|---|---|---|---|
| Who | Boss | Boss (external testers later) | customers |
| Plugin code | working copy via `claude --plugin-dir` | branch `next`, via private beta marketplace (`"ref": "next"`) | `main`, current marketplace (unchanged) |
| API / prompts | API on `localhost` | Render `one-shot-ship-api-staging`, deployed from `next` | `one-shot-ship-api` from `main` (unchanged) |
| Data | local | staging DB, Stripe test mode | prod |
| Signing key | staging key | staging key | prod key (unchanged) |
| OSS home | `~/.oss-dev` | `~/.oss-beta` | `~/.oss-stable` |

`~/.oss` is a symlink to the active home. The switch script swaps it.

## Approach

### Branches (plugin repo and API repo)
- `next` is the integration branch. Feature branches start from `origin/next`, and their PRs merge into `next`.
- `main` changes only through a **release PR** (`next` → `main`) or a **hotfix PR**. Every hotfix is merged back into `next`.
- Plugin versions on `next` are pre-releases (`X.Y.Z-beta.N`). The release PR bumps to stable.
- **IRON LAW #4 is unchanged** for customers. Each of the two repos gets a `CLAUDE.md` note outside the synced IRON LAWS block: "integration branch is `next`; branch from origin/next; `main` only for release and hotfix PRs".

### Release PR checklist (Boss decides when)
- [ ] ideate → plan → build → ship run on STAGING on a real repo
- [ ] plugin version bumped from beta to stable
- [ ] API released before or with the plugin; DB migrations applied to prod first
- [ ] `main` merged back into `next` afterwards

### Plugin changes (on `next`)
1. **One source for the API address.** Every hook gets it from `oss_api_url` (`hooks/oss-api-curl.sh`, existing). Sites: oss-session-start(.sh, -new, -test), oss-push-metrics, oss-iron-laws-sync, oss-fetch-team-iron-laws, fetch-iron-laws, oss-changelog, check-updates, oss-login. The watcher TS (`api/api-credentials.ts`, `detectors/llm-analyzer.ts`, `monitors/iron-law-log-parser.ts`, `cli/chain-trigger`) follows the same rule and is tested against the shared case table `packages/cli-decrypt/test/fixtures/api-url-cases.json`. Default stays production.
2. **Agents, skills and commands fetch through `oss-decrypt`, not WebFetch.** 101 files currently tell the model to WebFetch the production URL with the API key in the header. That bypasses `apiUrl` and the manifest signature check, and it puts the key in the model's context. They switch to `~/.oss/bin/oss-decrypt --type <agents|skills|commands> --name <x>`.
3. **Signing key chosen by address** in `oss-decrypt`: production address → production key; staging address or loopback → staging key; any other address → refused.
4. **Status line:** `⚠ STAGING` whenever the address in use is not production. A separate warning when the plugin version and the address disagree (beta version on prod, or stable version on staging).
5. **Repo note** in `CLAUDE.md` (see Branches).

### Decrypt CLI
The beta build is published as a GitHub **pre-release** tag (never "Latest"; see the 2026-06-28 incident in `hooks/ensure-decrypt-cli.sh`). Each plugin version already pins its own tag. Separate homes keep the beta binary out of stable.

### Server (API repo, private)
- `render.yaml`: service `one-shot-ship-api-staging`, branch `next`, its own DB, Stripe **test** keys, and the staging signing key as env vars. The production private key never goes to staging.
- Testers = accounts in the staging DB.
- Plan: the smallest **always-on** paid instance (a free instance sleeps, causing 30–60 s cold starts).
- **Creating the Render service and DB costs money and touches external systems: STOP and get Boss's confirmation before creating them.**

### Beta marketplace
A private repo `one-shot-ship-plugin-beta`. Its `marketplace.json` lists `oss` from the plugin repo with `"ref": "next"`.

### Switch script (unpublished)
`AgenticDevWorkflow/scripts/oss-channel.sh stable|beta|dev`:
- Repoints the `~/.oss` symlink to `~/.oss-<channel>`. On first run, the current `~/.oss` is moved to `~/.oss-stable` after a backup.
- Installs `oss` from the matching marketplace. For `dev`, it prints the `claude --plugin-dir <working copy>` command and refreshes `~/.oss-dev/hooks` from the working copy.
- Each home holds its own `config.json` (`apiUrl`, `apiKey`), `credentials.enc`, `bin/`, `hooks/` and `plugin-root`.
- Prints the active channel, plugin version and API address when done.

## Components
- `hooks/oss-api-curl.sh` `oss_api_url`: the single address source for shell (existing)
- watcher address reader: the same rule in TS
- `packages/cli-decrypt`: key-by-address verification
- the 101 agent/skill/command prompt-fetch steps
- the status line channel indicator
- API: staging service definition and signing-key env
- `one-shot-ship-plugin-beta`: the beta marketplace
- `scripts/oss-channel.sh`: the channel switch

## Success Criteria
- [ ] With no `apiUrl`, every network call goes to production (no customer-visible change)
- [ ] With `apiUrl` = a test server, every hook, watcher call and prompt fetch goes there and nowhere else
- [ ] No file outside the allowlist (helper defaults, tests, ARCHITECTURE.md) contains the production API literal
- [ ] `oss-decrypt` accepts a staging-signed manifest only from staging or loopback, and refuses any unknown address
- [ ] Status line shows `⚠ STAGING` on staging/loopback, nothing on production, and a mismatch warning when the version channel and the address disagree
- [ ] `oss-channel.sh` switches stable ↔ beta ↔ dev and back with the homes intact, and restores from backup on failure
- [ ] Boss runs ideate → ship on STAGING end to end
- [ ] Nothing in this feature reaches `main` before the first release PR

## TDD Test Plan
- [ ] Each listed hook, run with a temp `OSS_CONFIG_DIR` whose `apiUrl` is a loopback test server, sends its request there (one row per hook)
- [ ] Watcher address reader passes every row of `api-url-cases.json`
- [ ] Ratchet: grep for the production literal outside the allowlist returns nothing
- [ ] Key selection table: prod address + prod sig ✓; staging address + staging sig ✓; prod address + staging sig ✗; staging address + prod sig ✗; unknown address ✗
- [ ] Prompt-fetch steps: no agent/skill/command file contains a WebFetch of the API (ratchet), and each names an `oss-decrypt` call
- [ ] Status line rows: prod (no banner), staging (banner), loopback (banner), beta version on prod (mismatch), stable version on staging (mismatch)
- [ ] `oss-channel.sh` against a throwaway `HOME`: first-run migration, switch both ways, failure mid-switch restores the backup

## Out of Scope
- oss-lab channels (unreleased)
- A published `/oss:channel` command (the script stays private until external testers arrive)
- Automated staging smoke suite (the release gate is Boss + checklist)
- Changing IRON LAW #4 for customers

## Open items, resolved in plan/build
- **F2: resolved at plan time (2026-10-26).** The API serves 53 of 55 agent/workflow prompts and 6 of 6 skill prompts through `oss-decrypt`. Two (`agents/performance-auditor`, `agents/visionos-developer`) fail integrity on production, so they are fixed first (PLAN Task 9).
- The staging address (Render default hostname vs `staging.api.oneshotship.com`) is fixed when the infra is created.

## Stress test (2026-10-26): all accepted as proposed
- **F1 (Feasibility):** `~/.oss` is one shared home (copied hooks, decrypt binary, `credentials.enc`, config, `plugin-root` pinned to 2.0.83). Resolved with one home per channel and a symlink swap.
- **F2 (Feasibility):** the API must serve those prompt types through `oss-decrypt`'s endpoints. Verified in plan task 0.
- **F3 (Feasibility):** the beta decrypt CLI is published as a GitHub pre-release; pins and separate homes keep it out of stable.
- **U1 (UX):** the free Render tier sleeps. Use an always-on instance, cost confirmed before creation.
- **T1 (Tech debt):** long `next`/`main` drift. Release small and often, hotfix merge-back on the checklist, and an allowlist for the literal ratchet.

No dissent records: Boss accepted every proposal.
