# ADR-004: Release channels: DEV / STAGING / PROD swimlanes for OSS

**Date:** 2026-10-26
**Status:** Accepted
**Deciders:** Boss (maintainer); Claude (proposals)

## Context
For OSS, merging is releasing. Customers install `oss` from `501336north/one-shot-ship-plugin` with no `ref`, so it tracks `main`. Prompts are code in the private API repo, deployed to Render `one-shot-ship-api` from `main`, and change every customer's next command immediately. Sprint D (determinism) will change OSS behaviour. Paying customers rely on the current version, and the maintainer needs to test new work end to end first.

Governing rule (Boss): "as long as current customers aren't impacted, creating a new swimlane for testing what I'm developing without the current customer running any risks is an improvement."

Forces:
- The maintainer is the only tester today; external testers must be possible later.
- `~/.oss` is a single shared home: hooks are **copied** there and commands call `~/.oss/hooks/...`; it also holds `bin/oss-decrypt`, `credentials.enc`, `config.json` and `plugin-root`.
- IRON LAW #4 (branch from `origin/main`) is served from the API to every customer.

## Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Separate staging service + DB + Stripe test, from `next` | Full isolation; testers = staging accounts | One more paid instance + DB | **Best** |
| Same prod API, channel flag per account | No new infra | Beta code runs on prod server and DB | Poor |
| Local-only DEV | Cheapest | No path for testers; no realistic deploy | Decent (kept as the DEV level) |

| Switching option | Pros | Cons | Fit |
|--------|------|------|-----|
| Unpublished switch script + one home per channel (`~/.oss` symlink) | Swaps everything together; no change to the hundreds of files that use `~/.oss` | Symlink migration on first run | **Best** |
| Version decides the channel | One action | Leaves shared `~/.oss` state (hooks, binary, credentials) mixed | Poor |
| Config `channel` key | Simple | Two switches that can drift | Poor |
| Published `/oss:channel` command | Tester-friendly | Build/test cost for one tester now | Later |

| Release gate | Fit |
|--------|-----|
| Maintainer's call + checklist | **Best** (now) |
| + automated staging smoke | Later |
| Time-based soak | Poor (proves nothing ran) |

## Decision
1. **Three levels.** DEV (working copy via `claude --plugin-dir`, API on localhost); STAGING (`next`, private beta marketplace pinned to `"ref": "next"`, Render `one-shot-ship-api-staging` from `next`, own DB, Stripe test mode); PROD (`main`, unchanged).
2. **`next` is the integration branch** in the plugin and API repos. `main` changes only by release PR or hotfix PR, and hotfixes are merged back. Versions on `next` are `X.Y.Z-beta.N`.
3. **IRON LAW #4 is unchanged for customers.** Each of the two repos gets a `CLAUDE.md` note outside the synced IRON LAWS block: integration branch is `next`.
4. **One OSS home per channel**: `~/.oss-stable`, `~/.oss-beta`, `~/.oss-dev`, with `~/.oss` a symlink to the active one.
5. **An unpublished switch script**, `AgenticDevWorkflow/scripts/oss-channel.sh stable|beta|dev`, swaps the home and the plugin source together, backs up first, restores on failure, refuses beta/dev without jq, and prints the resulting state.
6. **Release gate:** the maintainer decides; the release PR carries the checklist (STAGING run, version bump, API + migrations first, merge-back).
7. **Staging infra is created only after the maintainer's explicit go-ahead with cost confirmed.** It runs on an always-on instance.

## Consequences
### Positive
- Customers are untouched until a deliberate release.
- External testers later need only a staging account and access to the beta marketplace repo.
- The switch can't leave one channel's hooks, binary or credentials under another channel's address.

### Negative
- A second Render service + DB to pay for and maintain.
- `next`/`main` drift risk. Mitigation: release small and often, hotfix merge-back on the checklist.
- The first switch migrates `~/.oss` to a symlink. It must be reversible (backup).

### Neutral
- Feature branches in these two repos start from `origin/next`.

## Alternatives Considered
### Alternative 1: Same API with a beta flag
Rejected: beta code would run on the production server and database.
### Alternative 2: Version-driven channel without separate homes
Rejected: `~/.oss` shared state (copied hooks, binary, credentials) would leak across channels (stress test F1).
### Alternative 3: Generalise IRON LAW #4
Rejected: it changes the law for every customer, and would ship through the channel being built.

## Related Decisions
- ADR-005: Channel trust (staging signing key by address; prompts fetched only via oss-decrypt)
- Design: `.oss/dev/active/release-channels/DESIGN.md`; requirements: `docs/requirements/release-channels.md`
