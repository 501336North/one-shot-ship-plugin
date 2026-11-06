/**
 * @behavior Text that came from the server cannot drive or spoof the user's terminal.
 * @business-rule Besides C0/DEL/C1 control characters, U+2028/U+2029 and every format character (Cf:
 *   bidi overrides, zero-width, BOM, soft hyphen, U+061C, word joiner, tag characters) are removed, the
 *   same set oss_json_field strips (T45), so a message cannot reorder or hide what the user reads; the
 *   readable words are kept.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { stripControl } from '../src/strip-control.js';

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

  // T45: the same set oss_json_field (hooks/oss-api-curl.sh) strips since T38.
  it('removes the line and paragraph separators U+2028 and U+2029', () => {
    expect(stripControl('a\u2028b\u2029c')).toBe('abc');
  });

  it('removes every format character: BOM, soft hyphen, U+061C, word joiner and invisible tag characters', () => {
    expect(stripControl('a\ufeffb\u00adc\u061cd\u2060e\u{e0041}\u{e0042}f')).toBe('abcdef');
  });

  it('keeps visible characters next to those format characters', () => {
    const visible = '\u00ac\u00ae\u061b\u2027\u205f\ufefc';
    expect(stripControl(visible)).toBe(visible);
  });

  // One set in two languages (IRON LAW #1b): the hooks strip with oss_json_field, this CLI with stripControl.
  // Every code point goes through both; what each keeps must be the same text.
  it('strips exactly the code points oss_json_field (hooks/oss-api-curl.sh) strips', () => {
    let corpus = '';
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp < 0xd800 || cp > 0xdfff) corpus += String.fromCodePoint(cp);
    }
    const hooks = join(__dirname, '..', '..', '..', 'hooks', 'oss-api-curl.sh');
    const r = spawnSync('bash', ['-c', 'source "$1" && oss_json_field t', 'bash', hooks], {
      input: JSON.stringify({ t: corpus }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(r.status, r.stderr).toBe(0);
    const fromHooks = r.stdout.replace(/\n$/, '');
    expect(fromHooks.length).toBeGreaterThan(1_000_000);
    expect(stripControl(corpus) === fromHooks).toBe(true);
  }, 60_000);

  it('keeps the visible neighbours of those ranges', () => {
    // U+2029 and U+206A were neighbours before T45; U+2029 (Zp) and U+206A (Cf) are stripped now.
    const neighbours = '\u200a\u2010\u2027\u202f\u2065\u2070';
    expect(stripControl(neighbours)).toBe(neighbours);
  });
});
