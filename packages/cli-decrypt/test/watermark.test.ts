/**
 * @behavior Watermark stripping removes Unicode homoglyphs to restore original ASCII
 * @acceptance-criteria Strip Greek omicron, Cyrillic dze, Cyrillic ie back to ASCII
 * @boundary CLI Utility
 */
import { describe, it, expect } from 'vitest';
import { stripWatermark, HOMOGLYPH_MAP } from '../src/watermark.js';

describe('Watermark Stripping', () => {
  it('should replace Greek omicron (U+03BF) with ASCII "o"', () => {
    const watermarked = 'fοllow the cοde';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('follow the code');
    expect(stripped).not.toContain('\u03BF');
  });

  it('should replace Cyrillic dze (U+0455) with ASCII "s"', () => {
    const watermarked = 'you muѕt verify';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('you must verify');
    expect(stripped).not.toContain('\u0455');
  });

  it('should replace Cyrillic ie (U+0435) with ASCII "e"', () => {
    const watermarked = 'run the tеst suite';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('run the test suite');
    expect(stripped).not.toContain('\u0435');
  });

  it('should handle all three homoglyphs in a single string', () => {
    const watermarked = 'fοllow the cοde, muѕt pass tеst';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('follow the code, must pass test');
  });

  it('should return unchanged text when no watermarks present', () => {
    const plain = 'This is plain ASCII text with no homoglyphs.';
    const stripped = stripWatermark(plain);
    expect(stripped).toBe(plain);
  });

  it('should export the homoglyph map with correct mappings', () => {
    expect(HOMOGLYPH_MAP).toEqual({
      '\u03BF': 'o',
      '\u0455': 's',
      '\u0435': 'e',
    });
  });
});
