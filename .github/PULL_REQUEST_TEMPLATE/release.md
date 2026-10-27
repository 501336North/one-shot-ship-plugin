## Release: `next` → `main`

This PR ships what is on `next` to every customer. See `docs/RELEASING.md`.

**Version:** `<beta version on next>` → `<stable version>`

### Gates (every one must be ticked by the maintainer)
- [ ] The full workflow (ideate → plan → build → ship) ran on STAGING (`⚠ STAGING` in the status line) on a real repo, with this exact `next`
- [ ] The plugin version is bumped from the beta (`X.Y.Z-beta.N`) to a stable `X.Y.Z` (no pre-release part)
- [ ] The API is released first or together with the plugin, and any DB migrations are applied to production first
- [ ] After this merges: `main` is merged back into `next` (so `next` carries the release commit)
- [ ] If prompts changed: the production `prompt-manifest.json` is regenerated and re-signed with the PRODUCTION key (`npm run manifest:generate`), and `manifest:verify` passes against the pinned production public key. The first release needs this for the `workflows/*` entries (every name the workflows route serves; `manifest:verify` lists them as untracked until then).
- [ ] If the CLI changed: a stable cli-decrypt tag is published (e.g. `cli-decrypt-v1.3.0`), its 4 checksums are committed in `hooks/oss-decrypt-checksums.txt`, and `OSS_DECRYPT_STABLE_TAG` points at it. The first release needs this: `v1.2.4` lacks fail-closed verification and the `shared`/`templates` types.

### What changes for customers
<!-- one line per user-visible change -->
