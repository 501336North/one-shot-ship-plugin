# Decisions: Release channels

| # | Decision | Record |
|---|----------|--------|
| 1 | Three levels: DEV (local), STAGING (`next` + separate Render service/DB/Stripe test), PROD (`main`, unchanged) | ADR-004 |
| 2 | `next` integration branch; release PR + hotfix merge-back; beta versions `X.Y.Z-beta.N` | ADR-004 |
| 3 | IRON LAW #4 unchanged for customers; repo note in CLAUDE.md | ADR-004 |
| 4 | One OSS home per channel, `~/.oss` symlink | ADR-004 |
| 5 | Unpublished `scripts/oss-channel.sh` in the API repo | ADR-004 |
| 6 | Release gate = maintainer + checklist | ADR-004 |
| 7 | Staging infra created only after explicit go-ahead + cost confirmation | ADR-004 |
| 8 | Staging signing key, key chosen by address, unknown address refused | ADR-005 |
| 9 | All prompt fetches through `oss-decrypt` (101 files), enforced by ratchets | ADR-005 |
| 10 | Beta decrypt CLI as a GitHub pre-release | ADR-005 |

Files: `docs/architecture/decisions/ADR-004-release-channels.md`, `docs/architecture/decisions/ADR-005-channel-trust.md`

Last Updated: 2026-10-26 by /oss:adr
