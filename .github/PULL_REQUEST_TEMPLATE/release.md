## Release: `next` → `main`

This PR ships what is on `next` to every customer. See `docs/RELEASING.md`.

**Version:** `<beta version on next>` → `<stable version>`

### Gates (all four must be ticked by the maintainer)
- [ ] The full workflow (ideate → plan → build → ship) ran on STAGING (`⚠ STAGING` in the status line) on a real repo, with this exact `next`
- [ ] The plugin version is bumped from the beta (`X.Y.Z-beta.N`) to a stable `X.Y.Z` (no pre-release part)
- [ ] The API is released first or together with the plugin, and any DB migrations are applied to production first
- [ ] After this merges: `main` is merged back into `next` (so `next` carries the release commit)

### What changes for customers
<!-- one line per user-visible change -->
