/**
 * Remove C0, DEL and C1 control characters, and the zero-width and bidi characters that can hide or reorder
 * text (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069), so server-supplied text cannot drive or spoof the
 * terminal. Same character set as oss_json_field in hooks/oss-api-curl.sh.
 */
export function stripControl(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}
