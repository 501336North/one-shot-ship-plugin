# ADR-005: Channel trust: staging signing key chosen by address; prompts fetched only through oss-decrypt

**Date:** 2026-10-26
**Status:** Accepted
**Deciders:** Boss (maintainer); Claude (proposals)

## Context
Two facts surfaced while designing release channels (ADR-004):

1. `oss-decrypt` verifies the prompt manifest's Ed25519 signature against **one public key built into the code** (`packages/cli-decrypt/src/commands/decrypt.ts`, `MANIFEST_PUBLIC_KEY`). A staging server serving different prompts needs to sign them.
2. **101** agent, skill and command files tell the model to WebFetch `https://one-shot-ship-api.onrender.com/api/v1/prompts/...` with `Authorization: Bearer {apiKey}`. Those fetches:
   - ignore `apiUrl`, so a beta install's agents would pull production prompts
   - skip the signature check
   - put the API key into the model's context

## Research
| Signing option | Pros | Cons | Fit |
|--------|------|------|-----|
| Separate staging key; key chosen by address | Prod private key only on prod; a staging leak can't sign for prod users | Two pinned public keys; address→key table to test | **Best** |
| Reuse the prod key on staging | No verifier change | Prod private key in two places; a compromised staging server could sign prompts prod users accept | Poor |
| Skip verification off-prod | Simplest | Weakens `/oss:trust`; a rogue `apiUrl` accepted | Poor |

| Prompt-fetch option | Pros | Cons | Fit |
|--------|------|------|-----|
| Every agent/skill/command fetches via `oss-decrypt --type <t> --name <n>` | Follows `apiUrl`, signature-checked, key out of model context, one code path | 101 mechanical edits; depends on the API serving those types on `oss-decrypt`'s endpoints | **Best** |
| Template the URL in the markdown | Smaller edit | Still unverified, still puts the key in context | Poor |

## Decision
1. `oss-decrypt` carries **two pinned public keys** and picks one by address: production address → production key; staging address or loopback → staging key; **any other address → refuse**, with a message naming `apiUrl`. Crossed combinations (prod address + staging signature, and the reverse) are refused.
2. The staging private key lives only in the staging service's environment (and the maintainer's DEV setup). The production private key never leaves production.
3. **All prompt fetches go through `oss-decrypt`.** No agent/skill/command file may WebFetch the API. A repo-wide ratchet test enforces this, and a second ratchet allows the production literal only in an allowlist.
4. Plan task 0 verifies that the API serves every converted type/name on `oss-decrypt`'s endpoints before any file is converted.
5. The beta `oss-decrypt` ships as a GitHub **pre-release** tag (never "Latest"). Each plugin version pins its own tag.

## Consequences
### Positive
- Closes a standing exposure: the API key no longer passes through model context for prompt fetches. This benefits stable customers once released.
- The channel's trust boundary is explicit and testable (an address→key table).

### Negative
- Key rotation now involves two keys. A staging key rotation needs a beta CLI release.
- The 101-file change is large, though mechanical, and must land on `next` only.

### Neutral
- The loopback address shares the staging key, so DEV needs the staging key pair locally.

## Alternatives Considered
### Alternative 1: Reuse the production key on staging
Rejected: it doubles the places the production private key lives.
### Alternative 2: Skip signature checks off production
Rejected: it contradicts the guarantee `/oss:trust` makes, and accepts rogue servers.
### Alternative 3: Template the WebFetch URL
Rejected: it keeps the unverified path and the key in context.

## Related Decisions
- ADR-004: Release channels

## Amendment 1 (2026-10-27): ship round 1, maintainer decisions
The quality gates found that verification failed OPEN: a missing, slow (>3 s; about 1 in 3 production fetches measured) or unlisted manifest delivered the prompt unverified. That made "key chosen by address" a non-boundary. The rules now:

1. **Verification is mandatory (fail closed).**
   - Every manifest-covered prompt (commands, workflows, skills, agents, hooks, `shared/iron-laws`, `templates/claude-md`) is refused when the manifest is missing, unreachable, unparseable, wrongly signed, or does not list it.
   - The manifest is fetched in parallel with the prompt (10 s timeout) and cached per API origin for 300 s. The cache is re-verified on every read.
   - The API adds signed `workflows/<name>` entries, because workflows are served from `commands/<target>` through `WORKFLOW_NAME_MAPPINGS`.
2. **One trust rule for every key sender:** production, staging, or loopback http only, normalised to the canonical origin. It applies in the shell `oss_api_url`, the CLI `trustedApiOrigin`, and the watcher `readApiCredentials`, all tested against `packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json`. A custom or look-alike host never receives the key. The config file itself must not be a symlink, foreign-owned or world-writable (group-writable is allowed).
3. **Documented unverified exceptions (maintainer decision, 2026-10-27):** team-authored content cannot be in the release-signed manifest.
   - team custom commands (`--type custom`): delivered only from a trusted address, marked `[verify] UNVERIFIED`
   - team/personal custom IRON LAWS (`/api/v1/iron-laws/team/:id`, `/personal`): served separately; `/shared/iron-laws` now serves only the signed base file
   - Follow-up: sign team content per team.
4. **The per-team workflow config** (`/api/v1/workflows`: which commands chain and which agents run) stays unsigned. It is host-restricted by rule 2. Follow-up: sign it.
5. **Startup signing is explicit:** `MANIFEST_SIGN_AT_STARTUP=1`, set on the staging service only. A key present without the flag (local dev, production) serves the committed, reviewed manifest.
