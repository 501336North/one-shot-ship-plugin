# Design: timeline-archived-ship-lines

Raised by a user heads-up on 2026-11-07, after AgenticDevWorkflow PR #430 (G2 Phase C, ADR-017: ship archives the feature inside its PR, before the merge).

## Problem
- After the ship moves `.oss/dev/active/<f>` to `.oss/dev/completed/<f>-<date>`, only `merge` and `merge-unknown` lines found the archived folder (B7).
- The ship's own `command ship complete` line, and any gate or agent line written after the move, went to `.oss/dev/timeline-unfiled.ndjson`. Unfiled lines are never pushed (P-3), so the G3 timeline missed the end of every ship.
- Seen in a real ship: G2 Phase C's `complete` line was unfiled.

## Design
- In `oss_timeline_append`, the B7 fallback (`_oss_tl_archived`) applies to every kind when `oss_resolve_feature` finds no active folder.
- `_oss_tl_archived` is unchanged, so B7's safety rules hold:
  - the newest `<f>-YYYY-MM-DD` dated no later than today;
  - no link on the path;
  - the folder must be the user's own;
  - the timeline file must have a single link.
- The outbox rule already keys on "feature set and not merge-unknown", so archived lines push like filed lines. P-2 is unchanged.
- `oss_resolve_feature` (shared with G1) is unchanged.

## Release
- Plugin **2.1.0**, the release after 2.0.99, as the owner decided. Patch bumps resume after it.
