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
