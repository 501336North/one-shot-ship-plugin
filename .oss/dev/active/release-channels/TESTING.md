# Testing: Release channels

## Strategy
Behaviour first, at the boundary each user sees:
- **customer:** prod by default, nothing changes
- **maintainer:** every call follows the channel, a visible STAGING marker, a safe switch

Repo-wide ratchets guard against a new site reintroducing a hard-coded host or a WebFetch.

## Planned suites
| Suite | Tasks | Covers |
|-------|-------|--------|
| `__tests__/integration-branch-note.test.sh` | T2 | AC-008.2 |
| `__tests__/api-literal-ratchet.test.sh` | T3, T11 | AC-002.3, no private key material |
| `hooks/__tests__/hooks-follow-api-url.test.sh` | T4, T5 | AC-001.1, AC-002.1, AC-002.4 |
| `watcher/test/api/api-credentials.test.ts` | T6 | AC-002.2, #47 |
| `watcher/test/engine/custom-command-executor.test.ts` | T6 | #45 |
| `__tests__/command-api-calls.test.sh` | T7 | #14 |
| `__tests__/prompt-fetch-via-decrypt.test.sh` + `test/fixtures/prompt-fetch-map.tsv` | T8 | AC-003.1/2, #44, #69 |
| `packages/api/test/prompts/manifest-integrity.test.ts` (API) | T9 | AC-003.3 |
| `packages/cli-decrypt/test/manifest-key-by-address.test.ts` | T10 | AC-004.x, AC-001.3 |
| `packages/cli-decrypt/test/staging-key.test.ts` | T11 | staging key slot |
| `__tests__/trust-allowlist-host.test.sh` (extended) | T12 | trust allowlist provenance |
| `__tests__/release-workflows.test.sh`, `hooks/__tests__/ensure-decrypt-cli.test.sh` (extended) | T13 | beta CLI pre-release |
| `hooks/__tests__/statusline-channel.test.sh` | T14 | AC-005.x |
| `packages/api/test/deploy/render-staging.test.ts` (API) | T15 | AC-007.1/2 |
| `packages/api/test/prompts/manifest-signing-key.test.ts` (API) | T16 | key from env |
| `scripts/__tests__/oss-channel.test.sh` (API) | T18 | AC-006.x |
| `__tests__/plugin-version-bump.test.sh` (extended) | T19 | AC-008.4 |
| `__tests__/release-checklist.test.sh` | T20 | AC-008.3 |

## Results
### 2026-10-26: acceptance written (`__tests__/release-channels.acceptance.test.sh`), 2/5 pass as expected
- A1 PASS (guard, US-001): with no apiUrl, every hook calls production only
- A2 FAIL (US-002): with apiUrl = http://127.0.0.1:9, fetch-iron-laws, oss-fetch-team-iron-laws, oss-changelog and oss-session-start still call production. Turns green with PLAN T4/T5.
- A3 FAIL (US-003): 99 files still WebFetch a prompt (matches the plan count). Turns green with PLAN T8 + T9.
- A4 FAIL (US-005): no STAGING marker off production. Turns green with PLAN T14.
- A5 PASS (guard, US-001/US-005): no marker on production
- Kept uncommitted until it is green (IRON LAW: no failing tests committed). /oss:build lands it with the task that turns its last row green.

### 2026-10-26: build results so far
- hooks-follow-api-url 36/36; oss-value 350/350; check-updates 8/8; changelog 4/4
- command-api-calls 8/8; command-api-key-argv 7/7; prompt-fetch-via-decrypt 7/7 (2 mutations killed)
- value-file-wrappers 42/42; value-file-wrappers-run 61/61; xray-wrapper 7/7; no-compound-commands and no-model-text-in-failed green
- watcher (T6 agent, safe config): 377/377 over 15 files; watcher-dist-fresh PASS (116 files) after merge
- API: release-channels-branching 3/3; manifest-integrity 139/139; full API unit 6680/6680
- Acceptance: A1, A2, A5 green; A3 waits for the 2 blocked agents (#389); A4 waits for T14
- Pre-existing on clean origin/next: ideate-template, no-telegram-command
- Load flakes (pass 2/2 alone, FOLLOWUPS): oss-api-curl.real.integration, oss-notification-style, oss-notify-complete-bounds

### 2026-10-26: T10 (manifest key by address)
- cli-decrypt: manifest-key-by-address 36/36 (real Ed25519, throwaway keys); untrusted-address-refused 10/10 (fetch mocked at the boundary)
- Mutations killed: prod->staging key, startsWith instead of origin, unknown->prod fallback, missing staging key->prod, each caller with a fixed prod key
- api-url-source: 2 tests re-expressed (loopback decrypt now fails closed until T11; one-source test proves it through the shared refusal)
- Full cli-decrypt 358/358; tsc clean; bundle rebuilt; live prod manifest verifies (signatureValid true, 138 prompts)

### 2026-10-27: ship round 1 integration (real CLI from this branch against PRODUCTION, read-only)
| Prompt | Result |
|---|---|
| agents/code-reviewer, skills/london-tdd | verified |
| shared/iron-laws, templates/claude-md (FR15 path) | verified |
| workflows/build | REFUSED: not in the signed manifest. Expected until the production manifest is re-signed with the 22 workflows/* entries (release gate). Staging signs at startup with them. |
| commands/status | not served (plugin-local command), as before |
- Fail-closed confirmed against the live service; no mock/reality mismatch in the hooks (the oss-decrypt stub contract = the real CLI's exit code + stdout).
- Full regression: 82 shell suites. Only the known pre-existing failures (ideate-template, no-telegram-command) remain; the load flakes (iron-laws-sync-safety, oss-api-curl ps, notify bounds) pass alone. cli-decrypt 422/422.


### 2026-10-27: ship round 2 fixes SR1-SR18 (one /oss:build round)
Every fix RED first, each guard proven by reverting/mutating it (all killed except the noted ones).
| Group | Tasks | New/changed tests | Result |
|---|---|---|---|
| API (build-t15-t18) | SR1, SR15, SR16 | workflow-manifest-agreement (50 shipped wrapper names in a committed fixture), manifest-generator, verify-manifest, iron-laws-custom (3 modes) | unit 6896 pass (3 load timeouts pass alone); tsc clean; oss-channel 19/19 |
| CLI | SR2, SR3, SR4, SR7, SR10, SR16, SR17 | loopback-config-privacy, config-read-once, manifest-cache-no-symlink, safe-write-writers, channel-config-dir (symlinked `~/.oss`), api-timeout (stalled body), fail-closed acceptance (?base=1, stripped custom text) | 453/453 merged; tsc clean; bundle rebuilt. Unproven: O_EXCL on the random temp name; AbortSignal.timeout vs controller not distinguishable in vitest |
| Shell hooks | SR2, SR3, SR5, SR6, SR8, SR9, SR11, SR14, SR16 | oss-api-trust (55: ports, loopback modes, symlinked channel home, swap-after-check), statusline-channel (+no-jq), statusline-channel-cost (process count), ensure-decrypt-channel/cli (plugin-root checks), fetch-iron-laws / iron-laws-sync(-safety) (ensure always, team laws section) | status line: compute_channel 17-27 ms -> 7-12 ms per call; full render mean +20.5 -> +2.7 ms vs origin/next (median +17 -> +11, noisy, load 6-13) |
| Watcher | SR2, SR10, SR12, SR13, SR18 | api-credentials (loopback modes, symlinked home), stalled-response-timeout (forced GC), iron-law-log-parser hint, statusline tests pinned to a stable plugin, hook-error-adoption (stub installer, curl tripwire) | 812/815 (3 load timeouts in untouched files pass alone); tsc clean |
- Merged regression: 83 shell suites; failing only ideate-template, no-telegram-command (pre-existing on next) and iron-laws-sync-safety 63/64 (load flake, 64/64 alone).
- Found by the merge, not by any one group: SR6 x watcher hook-error-adoption (real GitHub downloads from a test) -> SR18.


### 2026-10-27: ship round 2 integration (real API router on loopback, in-memory DB, throwaway signing key)
| Boundary | Mock assumption | Reality | Verdict |
|---|---|---|---|
| CLI shared fetch | fake API serves the signed file at `?base=1` | real route served 13331 bytes, sha256 = manifest entry; signature + hash verified with an injected key | MATCH |
| `oss_custom_iron_laws` | curl stub returns `## Custom Team Laws` section | real `?part=custom` = the legacy append exactly; sync writes base + note + section into CLAUDE.md | MATCH (team) |
| personal laws | API test seeds a `personal_<id>` row | the real writer stores personal laws elsewhere; never served (pre-existing on main) | MISMATCH, FOLLOWUPS (product decision) |
| workflow-name fixture | 50 names from 5a48652 | identical at HEAD; all signed by the generator | MATCH |
| symlinked `~/.oss` | per-package temp layouts | real status line STAGING, oss_api_url, oss-value root, CLI setup writes credentials.enc into .oss-beta; 0770 target refused | MATCH |
- Committed: `hooks/__tests__/release-channels.api.integration.test.sh` (15 checks, needs `OSS_API_REPO`; prints SKIP with a reason otherwise). Shown to fail on 4 contract mutations.


### 2026-10-27: ship round 3 fixes TR1-TR10 (one /oss:build round)
| Task | Guard | Mutation evidence |
|---|---|---|
| TR1 CLI + manifest deadline (race) | signal-ignoring fetch stubs (red on abort-only on every Node) + forced-GC stall tests | race removed 8-9 red; read outside deadline 12 red; signal not passed 4 red |
| TR1 watcher | direct `withDeadline` tests + each sender with a signal-ignoring fetch | race/reject removed 4 red; each sender abort-only 1 red (old GC test stayed green on Node 26) |
| TR2 API | `neutraliseLawMarkdown` (normalise, then headings/setext/rules, repeat); as-served and post-strip views; ordinary law byte-identical | 8 mutations killed |
| TR2 shell + hint | oss-custom-iron-laws (forgery cases), closing line last, hint names verified laws only (note read from oss-api-curl.sh) | 5+ mutations killed |
| TR3 / TR4 | 16 KiB cap (`--max-filesize` + byte check); rc 2 = failed fetch → 1 h backoff, `-m 5`; real-curl stall + Content-Length tests | killed |
| TR5 / TR6 / TR9 | one config read for URL + key in every hook; no-jq ambiguous key refused; hooks-read-key-via-helper 30 cases | killed per hook |
| TR7 | production + stable status line starts 0 programs (was 2) | killed |
| TR8 | `-q` on the integration test's curls; hostile `.curlrc` planted | killed |
| TR10 | code-simplifier asserts the oss-decrypt contract | 6 mutations |
- Merged regression: all 92 tracked shell tests (agents/, bin/, scripts/, .github/ included for the first time): 90 pass, only ideate-template and no-telegram-command fail (also on next). Watcher 822/822, cli-decrypt 462/462, API 6903 pass + 1 live `npm audit` flake (76/76 alone), tsc clean everywhere, real-API integration 15/15.


### 2026-10-27: ship round 3 integration (hostile team laws, real API + real hook + real sync)
| Boundary | Verdict |
|---|---|
| API `?part=custom` → `oss_custom_iron_laws` → sync → CLAUDE.md, 7 forgeries (zero-width, indented, setext, control+rule, forged note, forged closing line, forged END) | MATCH: each layer neutralises them alone; one START/END, note and closing line once, second (really refetching) sync byte-identical |
| API legacy body (stable plugin writes it raw) | MATCH for the 7 forgeries |
| API vs hook heading rule (`\s{0,3}` vs `\s*`) | MISMATCH (IRON LAW #1b), legacy path only |
| container-prefixed headings (`> ##`, `- ##`, `1. #`, `+ ---`, `> ===`) | pass both halves: round-4 fix task |
- Committed ff1b22a (api.integration 25/25; mutants of each half go red). oss-api-curl.real.integration 15/16 once in 7 (the ps-sampling check, already in FOLLOWUPS).


### 2026-10-28: ship round 4 fixes UR1'-UR16 (one /oss:build round)
| Task | Guard | Mutation evidence |
|---|---|---|
| UR1' fence (maintainer decision: new plugin only) | oss-custom-iron-laws 40 cases (every gate forgery stays inside a `text` fence longer than any backtick run), custom-laws-fence.sh structural check, markdown-it check in the real-API test, sync byte-identical on refetch | fence fixed at 4, no strip, prefix heading, no fence, marker drop removed: all killed |
| UR2 no proxy | real curl + recording proxy | `--noproxy` removed: red |
| UR3 flat-only without jq | key and URL, status line | 3 sites killed |
| UR4 / UR10 / UR11 / UR12 | session-start-untrusted-config (9), fetch-team-iron-laws (15), 3xx/non-section = failed, team retry stamp separate from the daily verified refresh | killed |
| UR5-A (owner + readable fast path) | hard-link to a root-owned file, mode 000 | killed; UR5-B write bits not applied (FOLLOWUPS) |
| UR6 one read in notify/value | swap-after-check shim | killed |
| UR7 hint / UR16 one heading source | watcher test reads OSS_CUSTOM_LAWS_NOTE and OSS_CUSTOM_LAWS_HEADINGS | killed |
| UR8 hermetic real-API test | outer proxy + NODE_OPTIONS marker planted: 0 connections, 0 loads; JSON mail transport | killed |
| UR9 timer guards | `vi.getTimerCount() === 0` in CLI and watcher | clearTimeout removed: red |
| UR13 / UR14 / UR15 one strip table | API `INVISIBLE`, CLI stripControl(KeepLines), shell `def invisible` (team laws and oss_json_field) | each range killed |
- Regression (behind a loopback-only curl shim): shell 94 suites, only ideate-template / no-telegram-command fail plus load-sensitive suites that pass alone; cli-decrypt 497/497; watcher 823/825 (the UR16 break, fixed, and a load flake); API 7284/7295 with 8 exec/real-hooks files timing out under load (1127/1127 alone); tsc clean; real-API integration 33/33.
- The shim refused 3 production requests in the loaded full run only (FOLLOWUPS, HIGH: a killed hook test's background curls fall through to the real curl).

### 2026-10-28: ship round 5 fix UR17 (one /oss:build round)
- watcher/test/skills/workflows.test.ts: the stale `/api/v1/workflows` assertion replaced by two behaviours (fetch through `oss-value.sh api workflows` / `api workflow`, whole-line; no raw /api/v1/, Bearer, {apiKey}, `grep apiKey`). RED against origin/next's pre-T7 workflows.md (2 failed); 4 mutations each killed.
- IRON LAW #1b grep: no other test asserts a raw API path in a T7-moved command file.
- Full watcher suite (safe config, temp HOME, shim): 259 files, 3675/3675; tsc clean.
- Round-5 gate suites (before UR17): shell 94 tracked *.test.sh, only ideate-template and no-telegram-command fail (both fail on next too); API integration 33/33 x2; cli-decrypt 497/497; API unit 7295/7295; oss-channel 19/19.

## Last Updated: 2026-10-28 14:30 CST by /oss:build (ship round 5 fix UR17)
