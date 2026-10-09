# Design: pin the oss-decrypt download (fix broken onboarding since 2026-06-28)

## Problem (verified 2026-10-09)
Every `/oss:*` command needs `~/.oss/bin/oss-decrypt`. Two sites download it from
`https://github.com/501336North/one-shot-ship-plugin/releases/latest/download/oss-decrypt-<OS>-<arch>`:
- `hooks/ensure-decrypt-cli.sh:21` (auto-install / auto-update, SHA-256 verified)
- `commands/login.md:255` (first-login manual install, NOT checksum-verified)

On 2026-06-28 the `oss-launch-v2.0.78` release became GitHub "Latest". It carries no `oss-decrypt-*` assets,
so `latest/download/oss-decrypt-*` returns **404 on Darwin-arm64, Darwin-x64, Linux-x64, Linux-arm64**
(checked with the exact asset names). `releases/download/cli-decrypt-v1.2.3/…` returns **200** for all 4
(+ `.sha256`). Any machine without a pre-June binary cannot run a single command. Evidence: both trials
since (2026-08-26, 2026-10-04) have 0 usage events; every earlier converting trial had commands.
Boss never noticed: his binary predates the break.

## Why it happened (provenance, IRON LAW #1b)
The 2026-06-28 oss-launch hardening pinned ITS OWN fetch to a tag (`ensure-oss-launch.sh` T3) but did not
check the sibling installer that still trusted `latest`, and its release silently took "Latest" from
cli-decrypt. One site fixed out of N.

## Fix
1. **Pin** both download sites to one tag constant, `cli-decrypt-v1.2.3` (all 4 platforms, arm64 native build).
   `login.md` stops carrying its own URL: it calls the hook, so there is ONE downloader (and login gains the
   SHA-256 check it lacks today).
2. **Guard the class:** a repo test fails if any shipped file (`hooks/`, `commands/`, `bin/`, `scripts/`)
   contains `releases/latest/download`.
3. **Stop releases stealing Latest:** `build-oss-launch.yml` marks its release `--latest=false`.
4. **Ops mitigation (needs Boss's OK, outward-facing):** mark `cli-decrypt-v1.2.3` as GitHub "Latest" now,
   so users on older plugin versions (whose hooks still use `latest`) recover without updating.
