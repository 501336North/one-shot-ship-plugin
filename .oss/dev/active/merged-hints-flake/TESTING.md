# Testing: merged-hints-flake

Strategy: the RED case simulates a slow machine deterministically (no real load); GREEN must hold with that simulation in place.
Targeted files only, temp HOME, no full suite, no heavy load (R-259 proof running).

## Results
- Root cause confirmed: phase-result.ts:516 starts `deadline = Date.now() + MERGED_BUDGET_MS` (9 s, merge-ready.ts:46); every git
  call (merge-ready.ts:49-61) and the gh spawn (merge-ready.ts:209-222) time out at `deadline - Date.now()`. Under load gh is
  killed or never starts, so the check answers gh_unreachable.
- RED (slow machine simulated: Date.now at start + 9000 - 1 just before gh runs): "gh logged out" and "HTTP 404" failed with
  `internal_error: GitHub could not be reached: send complete again when online` — 2 failed, 2 passed, the load failure exactly.
- GREEN: `completeCheck()` pins `Date.now` for the in-process `main()` call (restored by the existing `vi.restoreAllMocks()`).
  No assertion changed; no src/ change; product budget unchanged. The simulation case was removed after RED (a pinned clock
  leaves it nothing to act on).
- Runs (temp HOME, once, no retries): phase-result-merged-hints, phase-result-deadline, merge-ready: 3 files, 40/40. tsc clean.
- Still load-sensitive, not seen failing: feature.ts:107 caps each archived-lookup git call at min(2000, deadline - now), a real
  2 s limit even with a pinned clock (would refuse DIFF_TIMEOUT under extreme load).

### /oss:integration, 2026-11-28
| Seam | Real check | Result |
|---|---|---|
| `Date.now` pinned for `main()` in phase-result-merged-hints | The real wall-clock budget stays covered without a pin: merge-ready.test.ts:291 (a real slow gh stub, `exec sleep`, runs past what is left -> gh_unreachable) and :395 (every call gets only what is left of one 9 s budget); phase-result-deadline.test.ts (budget already spent -> refusal). merged-hints asserts each refusal's hint wording (D88), not timing. | matches; no mismatch |

## Last Updated: 2026-11-28 10:00 +07 by /oss:build
