# Plan: redaction-unsafe-chars

Widen the invisible-character pre-clean that runs before secret redaction, on BOTH sides together. This is
the watcher half (`watcher/src/services/redaction.ts`, used by `watcher/src/cli/redact-decision.ts`). The API
half is AgenticDevWorkflow `packages/api/src/services/decisions/redact.ts`; the two must behave the same.
All test characters are written as escapes or built with `String.fromCodePoint`, never as literals
(trojan-source hazard).

## Task 1: Widen UNSAFE_CHARS (TDD)

- Target (user-approved, byte-identical to the API side): C0 controls except TAB and LF (CR is still
  stripped), DEL, C1, `\p{Cf}`, `\p{Default_Ignorable_Code_Point}`, and U+2800 (Braille blank, which is
  not default-ignorable), with flags `gu`.
- ESLint: only `no-control-regex` is disabled. Lint passes without `no-misleading-character-class`.
- Tests: the API's shared 26-row fixture (each code point splits a fake GitHub token, which must be
  masked), plus U+FFF9 and U+0600 (Cf but not default-ignorable), plus a negative case (letters, digits,
  U+1F600, space, TAB and LF stay; CR is removed).

## Task 2: Lone surrogate halves never stay in place (MEDIUM, surrogate rejoin)

- A character stripped from between a lone high half and a lone low half joined them into U+E0020, an
  invisible tag that split the token. Lone halves are found in the ORIGINAL text, in the same walk that
  removes the controls, so a control between two halves cannot pair them. They are U+FFFD in the kept view
  (their kept-view indexes are recorded) and deleted from the stored view. A U+FFFD already in the input is
  not recorded: it is visible text and is kept in both views.
- Tests: a GitHub token with high half + (U+200B or U+0001) + low half at position 10 is fully redacted,
  with no U+E0020 and no U+FFFD; high + U+0001 + low that would pair into a visible emoji (U+1F600) inside
  a token is still fully redacted; a lone half on its own is removed; a real pair (emoji) and a U+FFFD
  already in the input are kept.

## Task 3: Position-based mask over two views (the API's final shape)

`cleanAndRedactWithRemoved` (used by `redact-decision`):
0. Fast path: a value with no UNSAFE_CHARS character (controls but TAB/LF, invisible characters) and no lone
   surrogate half goes through `redactStringWithRemoved` unchanged, so plain text, touching secrets included,
   is byte-identical to before.
1. `maskOf(view)` runs the patterns in redaction order, putting NULs (same UTF-16 length) in place of each
   secret value, and returns a per-code-unit mask (char code 0 = secret). Neither view can hold a NUL of
   its own: the controls walk removes U+0000 before either view exists, so input cannot fake a mask.
2. Kept view = main's old view: controls removed (TAB and LF kept), other invisible characters kept, lone
   halves as U+FFFD. keptMask = maskOf(kept).
3. Stored view = walk the kept view by code point, dropping a recorded lone half or any character that
   matches UNSAFE_CHARS (now non-global `/u`, as in the API); each code unit of a surviving character
   carries its keptMask bit, ORed with maskOf(stored).
4. Output by code point: a character is masked when any of its code units is, so a mask edge never splits a
   surrogate pair. Each run of masked characters becomes one [REDACTED]. Two secrets that touch become one
   (accepted).
`redactString`/`redactStringWithRemoved` share the pattern loop with `maskOf`. One pattern changed with the
API: the connection-string password now counts a run of NULs (a token maskOf already covers) as one
character, so the 256-character cap cannot stop short of the @ and leave the rest of a long password
readable. On text without NULs it matches exactly what `\S{1,256}` matched. `UNSAFE_CHARS` is now `/u`
(non-global, byte-identical to the API's line), so its `.test()` carries no `lastIndex` state.

Rejected along the way (each replaced before shipping):
- Two sequential passes (fillers kept, then removed): left the tail of a long key readable when a filler sat
  after 20+ body characters.
- A text-search union (mask each kept-view secret by split/join): only covered the 4 Hangul fillers, let an
  earlier pattern eat the head of a token after AIza/xoxb- and leave the tail, and masked other copies of a
  value in ordinary text.

Tests: A (`word` + U+2800 / lone U+D800 / U+FE0F / U+E0020 + an sk-proj- key gives `word[REDACTED]`;
`by` + lone U+D800 + `pass=s3cretvalue` gives `bypass=[REDACTED]`), B (AIza/xoxb- + filler + key, hf_ token
or Slack webhook URL: no 6-character window of the secret survives), C (four inputs must equal the plain
`redactString` exactly; on the watcher, `password=` and `TOKEN=` are taken with their value by the
plugin-only secret-param pattern, as on main), an emoji right after a secret is kept or masked whole (never
half), a mask edge inside an emoji masks the whole emoji, the 4 filler glue rows, the TAIL rows,
`by` + U+3164 + `pass=abc123`, a mostly-filler value that must not blank ordinary words, a differential
check (1500+ inputs with no invisible character: API fixture samples, a key/scheme/value grid and 400
seeded random log-like lines), and a fuzz check (3000 fixed-seed strings). Both must be byte-identical to
the pre-change pipeline. Also: a long connection-string password holding an AWS key (with and without a
zero-width space after it) is redacted up to the @; two touching GitHub tokens in plain text stay two
markers, and with an invisible character between them they become one.

## Build

- Rebuild watcher/dist for the redaction change only, and make
  `hooks/__tests__/watcher-dist-fresh.test.sh` pass.
- No version bump (coordinated at merge time).

## Deferred to the redaction redesign (the user's choice)

- Private-use characters.
- Noncharacters.
- U+1D159.
- U+16FE4.
