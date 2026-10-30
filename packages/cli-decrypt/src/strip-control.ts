/**
 * Remove C0, DEL and C1 control characters, U+2028/U+2029 and every Unicode format character (\p{Cf}:
 * zero-width, bidi, BOM, soft hyphen, U+061C, word joiner, invisible tag characters), so server-supplied text
 * cannot drive, spoof or hide text in the terminal. The same set as oss_json_field in hooks/oss-api-curl.sh
 * (C0 plus oss_invisible there, T45); change both together.
 */
export function stripControl(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\p{Cf}]/gu, '');
}
