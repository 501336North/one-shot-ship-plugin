/**
 * @behavior Text that came from the server cannot drive or spoof the user's terminal.
 * @business-rule Besides C0/DEL/C1 control characters, the invisible bidi-override and zero-width
 *   characters (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069) are removed, so a message cannot reorder
 *   or hide what the user reads; the readable words are kept.
 *   UR14 (release-channels ship round 4): the removed set is the API's INVISIBLE table (UR13), so the CLI and
 *   the API agree on what is invisible: also every format character (\p{Cf}: soft hyphen, word joiner, BOM,
 *   tags, ...), the line/paragraph separators U+2028/U+2029, and the blank-looking U+034F, U+115F, U+1160,
 *   U+3164 and U+E0000–U+E007F. The keep-lines variant (team custom command bodies) keeps only LF and TAB.
 */
import { describe, it, expect } from 'vitest';
import { stripControl, stripControlKeepLines } from '../src/strip-control.js';

function range(from: number, to: number): string {
  let out = '';
  for (let cp = from; cp <= to; cp++) out += String.fromCodePoint(cp);
  return out;
}

describe('stripControl removes invisible spoofing characters', () => {
  it('removes zero-width and directional marks U+200B–U+200F', () => {
    expect(stripControl(`a${range(0x200b, 0x200f)}b`)).toBe('ab');
  });

  it('removes bidi embeddings and overrides U+202A–U+202E', () => {
    expect(stripControl(`a${range(0x202a, 0x202e)}b`)).toBe('ab');
  });

  it('removes bidi isolates U+2066–U+2069', () => {
    expect(stripControl(`a${range(0x2066, 0x2069)}b`)).toBe('ab');
  });

  it('keeps the visible neighbours of those ranges', () => {
    const neighbours = '\u200a\u2010\u202f\u2065';
    expect(stripControl(neighbours)).toBe(neighbours);
  });
});

// One entry per part of the API's INVISIBLE table that the old set missed (UR14). Each part has its own
// witness that no other part covers, so dropping any one part from the table turns a row red.
const WIDENED: ReadonlyArray<readonly [string, string]> = [
  ['U+2028 line separator', '\u2028'],
  ['U+2029 paragraph separator', '\u2029'],
  ['U+034F combining grapheme joiner', '\u034f'],
  ['U+115F Hangul choseong filler', '\u115f'],
  ['U+1160 Hangul jungseong filler', '\u1160'],
  ['U+3164 Hangul filler', '\u3164'],
  ['U+E0000 (tag block, unassigned)', '\u{e0000}'],
  ['U+E0002 (tag block, unassigned)', '\u{e0002}'],
  ['U+E0020 tag space', '\u{e0020}'],
  ['U+E007F cancel tag', '\u{e007f}'],
  ['U+00AD soft hyphen (Cf)', '\u00ad'],
  ['U+2060 word joiner (Cf)', '\u2060'],
  ['U+206A inhibit symmetric swapping (Cf)', '\u206a'],
  ['U+FEFF byte order mark (Cf)', '\ufeff'],
  ['U+0600 Arabic number sign (Cf)', '\u0600'],
];

describe.each([
  ['stripControl', stripControl],
  ['stripControlKeepLines', stripControlKeepLines],
])('%s strips the same invisible table as the API (UR14)', (_name, strip) => {
  it.each(WIDENED)('removes %s', (_label, invisible) => {
    expect(strip(`a${invisible}b`)).toBe('ab');
  });

  it('keeps an ordinary line with emoji, accents and punctuation byte-identical', () => {
    const line = 'Deploy 🚀 then ship ✅ — café, naïve, 日本語 (100%) <ok> [done]';
    expect(strip(line)).toBe(line);
  });
});

describe('stripControlKeepLines keeps a team command document intact (UR14)', () => {
  it('keeps an ordinary multi-line command with tabs and emoji byte-identical', () => {
    const command = '# Release 🚀\n\n## Steps\n\tRun the tests ✅\n\tShip it — café\n- [ ] done 🎉\n';
    expect(stripControlKeepLines(command)).toBe(command);
  });
});
