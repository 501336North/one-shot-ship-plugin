# Progress: redaction-unsafe-chars

## Current Phase: build

## Tasks
- [x] Task 1: Widen UNSAFE_CHARS to the shared list, byte-identical to the API's line (completed 2026-11-02)
- [x] Task 2: Lone surrogate halves found in the original text and never left in place (completed 2026-11-02)
- [x] Task 3: Position-based mask over the invisible-kept and invisible-stripped views, plain-text fast path, connection-string NUL-run cap (completed 2026-11-02)
- [x] Build: watcher/dist rebuilt for redaction only; watcher-dist-fresh passes (completed 2026-11-02)
- [ ] Commit, push and PR (left to the coordinator; no version bump here)

## Blockers
- None

## Deferred to the redaction redesign (the user's choice)
- Private-use characters, noncharacters, U+1D159 and U+16FE4 can still split a secret.

## Last Updated: 2026-11-02 22:43 CST by typescript-pro
