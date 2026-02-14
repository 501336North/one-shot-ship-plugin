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

  it('should replace uppercase Greek omicron (U+039F) with ASCII "O"', () => {
    const watermarked = 'F\u039FLL\u039FW THE C\u039FDE';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('FOLLOW THE CODE');
    expect(stripped).not.toContain('\u039F');
  });

  it('should replace uppercase Cyrillic dze (U+0405) with ASCII "S"', () => {
    const watermarked = 'MU\u0405T VERIFY';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('MUST VERIFY');
    expect(stripped).not.toContain('\u0405');
  });

  it('should replace uppercase Cyrillic ie (U+0415) with ASCII "E"', () => {
    const watermarked = 'T\u0415ST SUITE';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('TEST SUITE');
    expect(stripped).not.toContain('\u0415');
  });

  it('should handle mixed case homoglyphs in a single string', () => {
    const watermarked = 'f\u03BFllow the C\u039FDE, mu\u0455t pass T\u0415ST';
    const stripped = stripWatermark(watermarked);
    expect(stripped).toBe('follow the CODE, must pass TEST');
  });

  it('should export the homoglyph map with correct mappings', () => {
    expect(HOMOGLYPH_MAP).toEqual({
      '\u03BF': 'o',
      '\u039F': 'O',
      '\u0455': 's',
      '\u0405': 'S',
      '\u0435': 'e',
      '\u0415': 'E',
    });
  });
});
