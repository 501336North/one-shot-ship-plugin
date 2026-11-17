/**
 * Finds variables a command sets inside an expansion (`${NAME:=x}`, `${NAME=x}`, `${NAME::=x}`,
 * `${NAME[i]=x}`) or in arithmetic (`$((NAME=1))`, `((NAME+=1))`), in time linear in the command's
 * length (R-266 round 7 performance CRITICAL: the old regular expressions backtracked without bound).
 *
 * - `${`: one bounded match per `${` (an index in brackets at most 256 characters, no newline; a
 *   longer or unclosed index counts as a set).
 * - `((`: the text up to the next `)` is searched once; a later `((` that closes at the same `)` lies
 *   inside text already searched, and the next `)` is found once for every `((` before it.
 */

/** Longest array index read in `NAME[…]`. */
const MAX_INDEX = 256;
/** `[index]`, read without backtracking (a lookahead takes the index once, as an atomic group would). */
const INDEX = `(?:\\[(?=([^\\]\\n]{0,${MAX_INDEX}}))\\2\\])`;
/** zsh parameter flags before the name (`${(A)cdpath::=…}`, `${(P)x=…}`), read once (round 11, CR HIGH-B). */
const FLAGS = '(?:\\([^)\\n]{0,64}\\))?';
const BRACED = new RegExp(`\\$\\{${FLAGS}([A-Za-z_][A-Za-z0-9_]*)${INDEX}?:{0,2}=`, 'g');
const ARITHMETIC_SET = new RegExp(
  `(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\\s*(?:${INDEX}\\s*)?(?:[-+*/%&|^]|<<|>>)?=(?!=)`,
  'g',
);

/**
 * `NAME[` whose `]` doesn't come within MAX_INDEX characters (or before a newline), or whose index holds
 * `$`, a backtick or `[` (a nested index, `${CDPATH[${X[0]}]:=/d}`, closes at the inner `]`): the search
 * can't read the index, so it counts as a set of NAME (round 9, CR MEDIUM-5; round 10, CR HIGH-1: fail
 * closed).
 */
const UNREAD_INDEX = `\\[(?![^\\]\\n$\\x60\\[]{0,${MAX_INDEX}}\\])`;
const BRACED_UNREAD = new RegExp(`\\$\\{${FLAGS}([A-Za-z_][A-Za-z0-9_]*)${UNREAD_INDEX}`, 'g');
const ARITHMETIC_UNREAD = new RegExp(`(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)${UNREAD_INDEX}`, 'g');

/** The first variable the command sets in an expansion or arithmetic that `wanted` accepts, or null. */
export function expansionSet(command: string, wanted: (name: string) => boolean): string | null {
  for (const pattern of [BRACED, BRACED_UNREAD]) {
    for (const match of command.matchAll(pattern)) {
      if (wanted(match[1])) return match[1];
    }
  }
  let close = -1;
  let searchedTo = -1;
  for (let open = command.indexOf('(('); open !== -1; open = command.indexOf('((', open + 1)) {
    if (close < open + 2) close = command.indexOf(')', open + 2);
    if (close === -1) break;
    if (close === searchedTo) continue;
    searchedTo = close;
    const inside = command.slice(open + 2, close);
    for (const pattern of [ARITHMETIC_SET, ARITHMETIC_UNREAD]) {
      for (const match of inside.matchAll(pattern)) {
        if (wanted(match[1])) return match[1];
      }
    }
  }
  return null;
}
