# Feature: Release channels (DEV / STAGING / PROD)

Design: `.oss/dev/active/release-channels/DESIGN.md` (COMMITTED 2026-10-26).

## Overview
This adds a STAGING swimlane next to production, so the maintainer can run new OSS work (plugin + prompts) end to end before customers get it. **Governing rule:** a stable-channel customer's behaviour stays unchanged until the maintainer's first release PR.

## Actors
| Actor | Description |
|-------|-------------|
| Customer | Paying user on the stable plugin (`main`) and the production API |
| Maintainer | Boss: develops on DEV, tests on STAGING, decides releases |
| External tester | Future: a staging account holder on the beta channel |

## User Stories

### US-001: Customers are untouched
**As a** customer
**I want** my OSS install to behave exactly as today
**So that** work in progress never risks my workflow

**Priority:** Must · **Estimate:** Small

**AC-001.1: Production by default.** Given a config with no `apiUrl`, when any hook, watcher call or prompt fetch runs, then it goes to the production API.
**AC-001.2: No release without a PR.** Given work merged into `next`, when a customer updates the plugin, then they receive nothing from `next` until a release PR merges into `main`.
**AC-001.3: Production signature unchanged.** Given the production address, when the manifest is verified, then only the production public key is accepted (as today).

### US-002: One API address for everything
**As a** maintainer
**I want** every network call to follow the configured API address
**So that** switching channel can't leave a call talking to the wrong server

**Priority:** Must · **Estimate:** Medium

**AC-002.1: Hooks follow apiUrl.** Given `apiUrl` = a loopback test server, when each listed hook runs, then its request reaches the test server and nothing else.
**AC-002.2: Watcher follows apiUrl.** Given the shared case table `api-url-cases.json`, when the watcher's address reader is evaluated, then it agrees with the shell helper and `oss-decrypt` on every row.
**AC-002.3: No stray literal.** Given the repository, when it is searched for the production API literal, then hits appear only in the allowlist (helper defaults, tests, ARCHITECTURE.md).
**AC-002.4: Invalid apiUrl refused.** Given an `apiUrl` that breaks the shared rule (http to a non-loopback host, user@, query, fragment), when a hook runs, then it sends nothing and reports the config error.

### US-003: Prompts always fetched through the verified path
**As a** maintainer
**I want** agents, skills and commands to fetch prompts via `oss-decrypt`
**So that** they follow the channel, are signature-checked, and keep the API key out of the model's context

**Priority:** Must · **Estimate:** Large (mechanical, 101 files)

**AC-003.1: No direct WebFetch.** Given the agents/skills/commands files, when they are searched for a WebFetch of the API, then there are none.
**AC-003.2: Each uses oss-decrypt.** Given each of those files, when its prompt-fetch step is read, then it names `oss-decrypt --type <type> --name <name>` matching its own name.
**AC-003.3: The endpoint exists.** Given the production API, when `oss-decrypt` requests each converted type/name, then it gets a prompt. Plan task 0 checks this before any conversion.

### US-004: The right key for the right server
**As a** maintainer
**I want** the staging server to sign with its own key
**So that** the production private key lives only on production

**Priority:** Must · **Estimate:** Medium

**AC-004.1: Key by address.** Given production address + production signature → accept. Staging or loopback address + staging signature → accept.
**AC-004.2: Crossed keys refused.** Given production address + staging signature, or staging address + production signature → refuse.
**AC-004.3: Unknown server refused.** Given any other address → refuse, with a message naming `apiUrl`.

### US-005: I always know I'm on STAGING
**As a** maintainer
**I want** a visible STAGING marker
**So that** I never confuse testing with real work

**Priority:** Must · **Estimate:** Small

**AC-005.1: Banner.** Given the address in use is staging or loopback, when the status line renders, then it shows `⚠ STAGING`.
**AC-005.2: No banner on prod.** Given the production address, then no channel marker is shown.
**AC-005.3: Mismatch warning.** Given a beta-versioned plugin on the production address, or a stable version on staging, then the status line shows a mismatch warning.

### US-006: One command to switch swimlanes
**As a** maintainer
**I want** `oss-channel.sh stable|beta|dev`
**So that** plugin code, API address, key, credentials, binary and hooks always switch together

**Priority:** Must · **Estimate:** Medium

**AC-006.1: First run migrates safely.** Given a plain `~/.oss` directory, when the script first runs, then it is backed up and moved to `~/.oss-stable`, and `~/.oss` becomes a symlink to it with contents unchanged.
**AC-006.2: Switch both ways.** Given stable, when switching to beta and back, then `~/.oss` points at the right home and the stable home is byte-identical to before.
**AC-006.3: Failure restores.** Given a failure mid-switch, then the previous symlink target is restored and the script exits non-zero.
**AC-006.4: Reports state.** After any switch, the script prints the channel, plugin version and API address.
**AC-006.5: DEV.** Given `dev`, then it refreshes `~/.oss-dev/hooks` from the working copy and prints the `claude --plugin-dir` command.

### US-007: A staging server that can't touch customers
**As a** maintainer
**I want** a separate staging service, DB and Stripe test mode
**So that** a bad beta deploy can't affect production data or billing

**Priority:** Must · **Estimate:** Medium

**AC-007.1: Defined, not created.** The staging service is defined in `render.yaml` (branch `next`). **It is created only after the maintainer's explicit go-ahead, with the cost confirmed.**
**AC-007.2: Isolation.** The staging service has no production DB URL, Stripe live key or production signing key in its environment.
**AC-007.3: Testers are accounts.** Adding an external tester = creating a staging account. No code change.

### US-008: A branch flow that keeps main = customers
**As a** maintainer
**I want** `next` as the integration branch and a release checklist
**So that** customers receive only what I decided to release

**Priority:** Must · **Estimate:** Small

**AC-008.1:** `next` exists in the plugin and API repos, created from `main`.
**AC-008.2:** Each repo's `CLAUDE.md` has the note "integration branch is `next`", outside the synced IRON LAWS block.
**AC-008.3:** A release PR template carries the checklist (STAGING run, version bump, API first + migrations, merge-back).
**AC-008.4:** Versions on `next` are `X.Y.Z-beta.N`.

## Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| `apiUrl` set but jq missing | The shell helper falls back to production (today's behaviour), which would silently put a beta machine on prod. The switch script refuses to switch to beta/dev without jq. |
| `~/.oss` is already a symlink (rerun) | No migration; switch only |
| `~/.oss-<channel>` missing on first switch to beta/dev | Created fresh; the user is told to run `/oss:login` against that channel |
| Staging asleep/unreachable | The existing 500/network error contract (OSS-API-001), never a fallback to production |
| Beta decrypt CLI tag missing | `ensure-decrypt-cli.sh` fails loudly on that channel only |
| A hotfix lands on `main` | The checklist's merge-back keeps `next` current |
| A new hook adds a prod literal | The AC-002.3 ratchet goes red |

## Non-Functional Requirements

### Security
- The production private key exists only in the production environment.
- The API key is never placed in model context by prompt-fetch steps (US-003).
- An unknown `apiUrl` never receives a key-signed request accepted as valid (US-004).

### Reliability
- The staging service is always-on (no free-tier sleep).

### Compatibility
- Bash 3.2 (macOS) for all shell changes, as today.

## Out of Scope
- oss-lab channels
- A published `/oss:channel` command
- An automated staging smoke suite
- Changing IRON LAW #4 for customers

## Dependencies
- Render (new staging service + DB): needs the maintainer's go-ahead
- GitHub: pre-release tag for the beta decrypt CLI; a new private repo `one-shot-ship-plugin-beta`
- API repo (AgenticDevWorkflow): staging config, signing-key env, `scripts/oss-channel.sh`

## Open Questions
- [ ] The staging hostname (Render default vs `staging.api.oneshotship.com`), fixed at infra creation
- [ ] Plan task 0: does the API serve every agent/skill/command on the `oss-decrypt` endpoints?

## Traceability Matrix
| Requirement | Story | Test (planned) |
|-------------|-------|----------------|
| Prod default | AC-001.1 | hook-url-follows-config rows (default case) |
| Hooks follow apiUrl | AC-002.1 | one row per hook against a loopback server |
| Watcher parity | AC-002.2 | watcher test over api-url-cases.json |
| Literal ratchet | AC-002.3 | repo grep with allowlist |
| No WebFetch of API | AC-003.1–2 | repo grep ratchet over agents/skills/commands |
| Key by address | AC-004.x | cli-decrypt verifier table test |
| Banner | AC-005.x | statusline rows |
| Switch script | AC-006.x | script test with throwaway HOME |
