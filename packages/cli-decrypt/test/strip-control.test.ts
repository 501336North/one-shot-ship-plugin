/**
 * @behavior Text that came from the server cannot drive or spoof the user's terminal.
 * @business-rule Besides C0/DEL/C1 control characters, the invisible bidi-override and zero-width
 *   characters (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069) are removed, so a message cannot reorder
 *   or hide what the user reads; the readable words are kept.
 */
import { describe, it, expect } from 'vitest';
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

  it('keeps the visible neighbours of those ranges', () => {
    const neighbours = ' ‐  ⁥⁪';
    expect(stripControl(neighbours)).toBe(neighbours);
  });
});
