# Releasing OSS

OSS reaches customers through two pipes, and **merging into `main` releases**:
- **The plugin:** customers install `oss` from this repo's `main`.
- **The prompts:** the API repo's `main` deploys to Render `one-shot-ship-api`, and its prompts reach customers on their next command.

`next` is the integration branch in both repos (ADR-004). Customers never see it.

## Day to day
- Feature branches start from `origin/next` (`git fetch origin next && git checkout -b <branch> origin/next`), and their PRs target `next`.
- `next` carries beta versions of the plugin (`X.Y.Z-beta.N`). The version-bump gate orders them by SemVer (`hooks/oss-semver.sh`).
- The maintainer tests `next` on STAGING (`scripts/oss-channel.sh beta` in the API repo; the status line shows `⚠ STAGING`).

## Releasing `next` to customers
1. Open a PR from `next` into `main` using the release template: append `?template=release.md` to the PR URL, or pick it in the GitHub UI. The template is `.github/PULL_REQUEST_TEMPLATE/release.md`.
2. Tick the four gates:
   - The full workflow ran on STAGING.
   - The version is bumped from beta to stable.
   - The API is released first or together with the plugin, and migrations are applied to production first.
   - `main` is merged back into `next` after the release.
3. The maintainer merges. That is the release.
4. Merge `main` back into `next` through a small sync branch and PR (as in API #390).

## Hotfixes
A fix that customers need now goes straight to `main`:
1. Branch from `origin/main` (`fix/<slug>/hotfix`).
2. Open a PR into `main`. Its CI must be green, and the maintainer merges.
3. **Merge `main` back into `next` right after**, through a sync branch and a PR into `next`, so the next release does not undo the fix. Example: API hotfix #389 (prompt integrity) was followed by sync PR #390.
