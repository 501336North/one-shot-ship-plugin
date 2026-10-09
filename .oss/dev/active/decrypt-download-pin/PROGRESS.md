# Progress: decrypt-download-pin

## Current Phase: ship (fix round 1 built; re-running quality gates)

## Tasks
- [x] Task 0: OPS — cli-decrypt-v1.2.3 marked GitHub Latest (Boss OK 2026-10-09). Verified: 4 platforms + .sha256 → 200 (Darwin-arm64 briefly served a cached 404 for ~1 min); a fresh install with the hook from origin/main (what customers run today) succeeds.
- [x] Task 1: ensure-decrypt-cli.sh pinned to cli-decrypt-v1.2.3, OSS_DECRYPT_TAG seam (2026-10-09)
- [x] Task 1b: two-method verify — committed hooks/oss-decrypt-checksums.txt, fail-closed, plugin-root lookup (2026-10-09)
- [x] Task 1c: session start copies the manifest next to the hook (2026-10-09)
- [x] Task 2: /oss:login installs through the hook (2026-10-09)
- [x] Task 3: guard — acceptance A3, no releases/latest/download in shipped files (2026-10-09)
- [x] Task 4: build-oss-launch.yml keeps Latest on the newest cli-decrypt release (2026-10-09)
- [x] Task 5: clean-machine acceptance against the real release (2026-10-09)
- [x] Version bump 2.0.83

## Blockers
- None. Pre-existing failures on main (not caused here): config-change-guard, format-hook, worktree-hooks shell suites.

- [x] Ship fix round 1: F1–F11 from quality/perf/security gates (2026-10-09); F12 = PR body; P1/L3/P3/P4 deferred with reasons (PLAN.md)

## Last Updated: 2026-10-09 12:42 +07 by Claude Code (/oss:build ship-fix round 1)
