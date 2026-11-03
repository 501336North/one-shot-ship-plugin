# Testing: redaction-unsafe-chars

## Where the tests are

- `watcher/test/services/redaction.test.ts`: the 26-row shared fixture (mirrored from the API test), the
  U+FFF9/U+0600 rows, the negative case, the function-level checks for `cleanAndRedactWithRemoved`, and the
  differential and fuzz checks against a copy of the pre-change pipeline (origin/main 91c808e).
- `watcher/test/cli/redact-decision.test.ts`: the decision CLI boundary (lone-half rows, emoji pair,
  filler glue, TAIL, `by` + U+3164 + `pass=abc123`).
- Test characters are built with `String.fromCodePoint` or written as escapes; the source holds no literal
  invisible character and no NUL.

## RED (each step, before the code)

1. Widened list: 13 of 21 fixture rows failed (U+034F, U+115F, U+1160, U+3164, U+FFA0, U+2800, U+FE00,
   U+FE0F, U+E0100, U+E01EF, U+2064, U+E0001, U+E007F). The 5 later rows (U+17B4, U+180B, U+FFF0, U+E0000,
   U+E0FFF) failed against the interim list.
2. Lone halves: the surrogate rejoin test failed (U+E0020 formed); later, deleting instead of U+FFFD failed
   3 tests (U+FFFD left in the token, a lone half left in text).
3. Fillers: the `bypass=` rows failed once the widened list deleted the fillers. The two-pass design then
   failed the TAIL rows (`x [REDACTED]TAIL9xyz end`). The union failed A (lone half + pass=), B (xoxb- +
   hf_/webhook), C (both) and the differential (210 differences). The mask design failed only the
   mask-edge-in-an-emoji tests (a lone half was emitted).
4. Closing checks: the long connection-string password (both rows: the `!Pxxx...` tail stayed readable),
   two touching tokens in plain text (merged), and the byte-identical differential (176) and fuzz (2).

## GREEN

- Redaction tests: 121 passed (services + CLI).
- Full watcher suite: 257 files, 3685 tests passed (exit 0, 2167 s, run with `--hookTimeout=60000`).
- `npx tsc --noEmit`: 0 errors. ESLint 8.57.1 (the API worktree's binary and TS parser, rules
  no-control-regex, no-misleading-character-class and no-irregular-whitespace,
  `--report-unused-disable-directives`) on the 4 changed files: exit 0.
- Shell: `watcher-dist-fresh.test.sh` PASS (117 tracked dist files match a fresh build);
  `oss-decision-record.test.sh` 111 run, 0 failed; `decision-push.test.sh` 89 run, 0 failed;
  `decision-record.acceptance.test.sh` 5 run, 0 failed (the token in the note never left the machine).

## Mutations (final code, all killed)

| Mutation | Result |
|---|---|
| F-a drop the fast path | 3 failed (touching tokens, differential, fuzz) |
| F-b fast path skips the lone-surrogate check | 3 failed (lone-half rows) |
| F-c fast path skips the UNSAFE_CHARS check | 55 failed |
| K-a connection-string pattern back to `\S{1,256}` | 1 failed (password + zero-width space) |
| R1 drop the OR of maskOf(stored) | 38 failed |
| R2 drop the keptMask | 12 failed |
| R3 collapse per unit instead of per run | 57 failed |
| R4 keep the U+FFFD that stand for lone halves | 7 failed |
| R6 split a surrogate pair at a mask edge | 1 failed |
| R7 remove controls before finding lone halves | 1 failed (halves pair into a visible emoji) |
| M1 drop `\p{Cf}` | 2 failed (U+FFF9, U+0600) |
| M2 drop the u flag | 89 failed, and tsc TS1530 |
| M3 drop `\p{Default_Ignorable_Code_Point}` | 36 failed |
| M4 drop U+2800 | 2 failed |
| M5 keep CR | 1 failed |
| M6 strip TAB and LF | 3 failed |

Extra mutation, not requested: leaving lone halves in the kept view instead of U+FFFD survives. It does not
change behaviour, since the patterns treat a lone half and U+FFFD the same.

## Notes

- `test/setup.ts` (pre-existing) runs `pkill -f "watcher/dist/index.js"`, `oss-session-start` and
  `health-check.js` in `beforeAll` on every vitest run, plus a `find` over the tmpdir. That `find` sometimes
  went past the 10 s hook timeout under load (whole files then showed as skipped), so runs here used
  `--hookTimeout=60000` (CLI only, no file changed). No watcher process matched while these runs were made.

## Last Updated: 2026-11-02 22:43 CST by typescript-pro
