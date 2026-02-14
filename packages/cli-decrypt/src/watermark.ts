/**
 * Watermark stripping utility
 *
 * Reverses the steganographic watermarking applied server-side.
 * Replaces Unicode homoglyph characters with their ASCII equivalents
 * so that prompt content can be hashed for manifest verification.
 *
 * NOTE: Stripping is done in-memory only for hash comparison.
 * The watermarked version is still what executes (preserving leak detection).
 */

/**
 * Unicode homoglyph → ASCII mapping
 * Must match the server-side WATERMARK_CHARS in watermark.ts
 */
export const HOMOGLYPH_MAP: Record<string, string> = {
  '\u03BF': 'o', // Greek small letter omicron → ASCII 'o'
  '\u039F': 'O', // Greek capital letter omicron → ASCII 'O'
  '\u0455': 's', // Cyrillic small letter dze → ASCII 's'
  '\u0405': 'S', // Cyrillic capital letter dze → ASCII 'S'
  '\u0435': 'e', // Cyrillic small letter ie → ASCII 'e'
  '\u0415': 'E', // Cyrillic capital letter ie → ASCII 'E'
};

/**
 * Strip watermark homoglyphs from content, restoring original ASCII.
 *
 * @param content - Watermarked prompt content
 * @returns Content with homoglyphs replaced by ASCII equivalents
 */
export function stripWatermark(content: string): string {
  let result = content;
  for (const [homoglyph, ascii] of Object.entries(HOMOGLYPH_MAP)) {
    result = result.replaceAll(homoglyph, ascii);
  }
  return result;
}
