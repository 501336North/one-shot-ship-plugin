/**
 * Remove C0, DEL and C1 control characters, U+2028/U+2029 and every Unicode format character (\p{Cf}:
 * zero-width, bidi, BOM, soft hyphen, U+061C, word joiner, invisible tag characters) and every default-ignorable
 * code point (variation selectors, Hangul fillers, U+034F, U+2800, U+2065), so server-supplied text
 * cannot drive, spoof or hide text in the terminal. The same set as oss_json_field in hooks/oss-api-curl.sh
 * (C0 plus oss_invisible there, T45); change both together.
 */
export function stripControl(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\p{Cf}\ufe00-\ufe0f\u{e0000}-\u{e0fff}\u034f\u115f\u1160\u3164\uffa0\u2800\u17b4\u17b5\u180b-\u180d\u180f\u2065\ufff0-\ufff8\p{Default_Ignorable_Code_Point}]/gu, '');
}
