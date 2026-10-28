/**
 * Remove control and invisible characters, so server-supplied text cannot drive, hide or spoof what the terminal
 * shows: C0, DEL and C1 control characters, every format character (\p{Cf}: zero-width, bidi, soft hyphen, word
 * joiner, BOM, tags...), the line/paragraph separators U+2028/U+2029, and the blank-looking U+034F, U+115F, U+1160,
 * U+3164 and U+E0000–U+E007F. The same table as the API's INVISIBLE (packages/api/src/routes/prompts.ts, UR13), so
 * the CLI and the API agree on what is invisible (UR14).
 */
export function stripControl(text: string): string {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u034f\u115f\u1160\u3164\u{e0000}-\u{e007f}\p{Cf}]/gu,
    ''
  );
}

/**
 * stripControl for multi-line text a user reads as a document (a team custom command body): the same characters
 * are removed except line feed and tab, which carry the document's layout and cannot drive the terminal.
 */
export function stripControlKeepLines(text: string): string {
  return text.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u034f\u115f\u1160\u3164\u{e0000}-\u{e007f}\p{Cf}]/gu,
    ''
  );
}
