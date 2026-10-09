# Learnings

## 2026-10-09 | Config | one-shot-ship-plugin
- **Context:** build (decrypt-download-pin)
- **Insight:** `releases/latest/download` is shared by EVERY release in the repo. Publishing any release (oss-launch) can silently take "Latest" and 404 another binary's installer for months. Pin each installer to its own tag and keep a guard test (`__tests__/new-user-install.acceptance.test.sh` A3) that fails on `releases/latest/download` in shipped files.

## 2026-10-09 | Config | one-shot-ship-plugin
- **Context:** build
- **Insight:** Hooks run from the ~/.oss/hooks COPY made at session start (fixed HOOKS_TO_COPY list). Any file a hook reads beside itself (e.g. a checksum manifest) must be added to that list, or it works in tests and fails closed for every customer. Fall back to `$(cat ~/.oss/plugin-root)/hooks/`.
