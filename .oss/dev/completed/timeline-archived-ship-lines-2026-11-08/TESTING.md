# Testing: timeline-archived-ship-lines

## Strategy
- Bash hook tests with a sandboxed HOME, each file run alone with `/bin/bash hooks/__tests__/<name>.test.sh`. Never the watcher's full suite (its setup pkills OSS processes machine-wide).

## Results (2026-11-07)
- RED: timeline-archived, 37 run, 3 failed. Each new archived case (command, gate, agent) landed in unfiled.
- GREEN:

  | Test file | Result |
  |---|---|
  | timeline-archived | 37/37 |
  | timeline-writer | 23/23 |
  | timeline-gate | 8/8 |
  | timeline-agent-hook | 7/7 |
  | timeline-merge | 14/14 |
  | timeline-push | 22/22 |
  | timeline-delivery | 35/35 |
  | timeline-bounds | 10/10 |
  | timeline-kept | 3/3 |
  | notify-timeline | 9/9 |
  | timeline.acceptance | 8/8 |
  | feature-resolve | 12/12 |
  | bash32-parse | 146/146 |
  | one-copy-helpers | 13/13 |
  | tests-hermetic-env | 101/101 |

- `bash -n hooks/oss-timeline.sh` passes.

### Ship (2026-11-08)
- Task 2, ship-merge-wording.test.sh: RED 0/5, GREEN 5/5; after the TA-2 amendment RED 4/7, GREEN 7/7.
- TA-3, timeline-archived.test.sh: 4 new cases (command, gate, agent unfiled with an archive older than today; merge still filed there). RED 3 failed, GREEN 41/41.
- Every commands/ and hooks/ shell test (no watcher suite, no real.integration): 112/114 pass. ideate-template and no-telegram-command fail on origin/main too (files unchanged by this branch); session-start-outside-kill passes (14/14) but takes 7m49s.
- wrapper-complete 95/95, prompt-promises 6/6.

## Last Updated: 2026-11-08 12:58 CST by ship (timeline-archived-ship-lines)
