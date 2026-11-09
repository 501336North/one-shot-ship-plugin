/**
 * Shell tokenizer for the tool gate (ADR-007: our own, no dependency).
 *
 * Reads a shell command the way the shell would, for the parts the rules need:
 * words (quotes removed), control operators, and redirects with their target.
 * Anything it cannot read safely (substitution, eval, a nested `sh -c` script,
 * an unterminated quote) is reported as unreadable instead of guessed at.
 */

export type Token =
  | { kind: 'word'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'redirect'; op: string; target: string };

export type TokenizeResult = { tokens: Token[] } | { unreadable: true; reason: string };

const CONTROL_OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '(', ')', '\n'];
const REDIRECT_OPERATORS = ['&>>', '<<<', '<<-', '&>', '>>', '>|', '<<', '<>', '>', '<'];
/** Longest first, so `&&` wins over `&` and `>>` over `>`. */
const ALL_OPERATORS = [...CONTROL_OPERATORS, ...REDIRECT_OPERATORS].sort((a, b) => b.length - a.length);
const HEREDOC_OPERATORS = ['<<', '<<-'];
const NESTED_SHELLS = new Set(['bash', 'sh', 'zsh']);
/** Characters a backslash escapes inside double quotes (a newline is a line continuation). */
const DOUBLE_QUOTE_ESCAPABLE = '$`"\\\n';

class Unreadable extends Error {}

export function tokenize(cmd: string): TokenizeResult {
  try {
    return { tokens: scan(cmd) };
  } catch (err) {
    if (err instanceof Unreadable) return { unreadable: true, reason: err.message };
    throw err;
  }
}

function matchOperator(cmd: string, i: number): string | undefined {
  return ALL_OPERATORS.find((op) => cmd.startsWith(op, i));
}

function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

/** A shell flag cluster that includes `-c` (`-c`, `-lc`, `-ec`). */
function isCommandStringFlag(value: string): boolean {
  return /^-[A-Za-z]*c[A-Za-z]*$/.test(value);
}

/** Single-character escapes inside bash `$'…'`. */
const ANSI_C_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v',
  '\\': '\\', "'": "'", '"': '"', '?': '?',
};
/** Escapes that take a run of digits: `\NNN` octal, `\xHH`, `\uHHHH`, `\UHHHHHHHH`. */
const ANSI_C_NUMERIC: Record<string, { digits: RegExp; radix: number; skip: number }> = {
  '0': { digits: /[0-7]{1,3}/y, radix: 8, skip: 1 },
  x: { digits: /[0-9A-Fa-f]{1,2}/y, radix: 16, skip: 2 },
  u: { digits: /[0-9A-Fa-f]{1,4}/y, radix: 16, skip: 2 },
  U: { digits: /[0-9A-Fa-f]{1,8}/y, radix: 16, skip: 2 },
};
for (const d of '1234567') ANSI_C_NUMERIC[d] = ANSI_C_NUMERIC['0'];

/**
 * Decodes a bash `$'…'` string whose body starts at `start`; returns the text and the index
 * after the closing quote. Like bash, a NUL ends the text (the rest up to the quote is dropped).
 */
function readAnsiCQuote(cmd: string, start: number): { text: string; end: number } {
  let text = '';
  let ended = false;
  let i = start;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "'") return { text, end: i + 1 };
    let decoded = c;
    let length = 1;
    if (c === '\\' && i + 1 < cmd.length) {
      const e = cmd[i + 1];
      const numeric = ANSI_C_NUMERIC[e];
      decoded = c + e;
      length = 2;
      if (e in ANSI_C_ESCAPES) {
        decoded = ANSI_C_ESCAPES[e];
      } else if (e === 'c' && i + 2 < cmd.length) {
        decoded = String.fromCharCode(cmd[i + 2].toUpperCase().charCodeAt(0) ^ 0x40);
        length = 3;
      } else if (numeric !== undefined) {
        numeric.digits.lastIndex = i + numeric.skip;
        const digits = numeric.digits.exec(cmd)?.[0];
        if (digits !== undefined) {
          const codePoint = parseInt(digits, numeric.radix);
          if (codePoint > 0x10ffff) throw new Unreadable(`escape \\${e}${digits} is not a character`);
          decoded = String.fromCodePoint(codePoint);
          length = numeric.skip + digits.length;
        }
      }
    }
    if (decoded === '\0') ended = true;
    if (!ended) text += decoded;
    i += length;
  }
  throw new Unreadable("unterminated $' quote");
}

function scan(cmd: string): Token[] {
  const tokens: Token[] = [];
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
  let word = '';
  let inWord = false;
  let quote: '' | "'" | '"' = '';
  let pendingRedirect: string | null = null;
  let pendingRedirectEnd = -1;
  let atCommandStart = true;
  let program: string | null = null;

  const checkReadable = (value: string): void => {
    if (atCommandStart) {
      if (isAssignment(value)) return;
      program = value.slice(value.lastIndexOf('/') + 1);
      atCommandStart = false;
      if (program === 'eval') throw new Unreadable('eval runs text the gate cannot read');
    } else if (program !== null && NESTED_SHELLS.has(program) && isCommandStringFlag(value)) {
      throw new Unreadable(`${program} -c runs a nested script the gate cannot read`);
    }
  };

  const endWord = (): void => {
    if (!inWord) return;
    const value = word;
    word = '';
    inWord = false;
    if (pendingRedirect !== null) {
      if (HEREDOC_OPERATORS.includes(pendingRedirect)) {
        heredocs.push({ delimiter: value, stripTabs: pendingRedirect === '<<-' });
      }
      tokens.push({ kind: 'redirect', op: pendingRedirect, target: value });
      pendingRedirect = null;
      return;
    }
    checkReadable(value);
    tokens.push({ kind: 'word', value });
  };

  /** Skips heredoc bodies that start at `i` (right after a newline); returns the new index. */
  const skipHeredocBodies = (i: number): number => {
    for (const { delimiter, stripTabs } of heredocs) {
      while (i < cmd.length) {
        const end = cmd.indexOf('\n', i);
        const lineEnd = end === -1 ? cmd.length : end;
        let line = cmd.slice(i, lineEnd);
        if (stripTabs) line = line.replace(/^\t+/, '');
        i = lineEnd + 1;
        if (line === delimiter) break;
      }
    }
    heredocs.length = 0;
    return Math.min(i, cmd.length);
  };

  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    const next = cmd[i + 1];

    if (quote === "'") {
      if (c === "'") quote = '';
      else word += c;
      i++;
      continue;
    }

    if (quote === '"') {
      if (c === '"') {
        quote = '';
      } else if (c === '\\' && next !== undefined && DOUBLE_QUOTE_ESCAPABLE.includes(next)) {
        if (next !== '\n') word += next;
        i++;
      } else if (c === '`' || (c === '$' && next === '(')) {
        throw new Unreadable('command substitution');
      } else {
        word += c;
      }
      i++;
      continue;
    }

    if (c === '$' && next === "'") {
      const { text, end } = readAnsiCQuote(cmd, i + 2);
      word += text;
      inWord = true;
      i = end;
      continue;
    }

    // `$"…"` (locale translation) reads as a plain double-quoted string.
    if (c === '$' && next === '"') {
      i++;
      continue;
    }

    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      i++;
      continue;
    }

    if (c === '\\') {
      if (next === '\n') {
        i += 2;
      } else if (next === undefined) {
        word += c;
        inWord = true;
        i++;
      } else {
        word += next;
        inWord = true;
        i += 2;
      }
      continue;
    }

    if (c === '`' || (c === '$' && next === '(')) throw new Unreadable('command substitution');
    if ((c === '<' || c === '>') && next === '(') throw new Unreadable('process substitution');

    if (c === '#' && !inWord) {
      const end = cmd.indexOf('\n', i);
      i = end === -1 ? cmd.length : end;
      continue;
    }

    if (c === ' ' || c === '\t') {
      endWord();
      i++;
      continue;
    }

    // `2>&1`, `>&2`: an `&` right after a redirect names another output, not a file.
    if (c === '&' && pendingRedirect !== null && !inWord && i === pendingRedirectEnd) {
      word = '&';
      inWord = true;
      i++;
      continue;
    }

    const operator = matchOperator(cmd, i);
    if (operator === undefined) {
      word += c;
      inWord = true;
      i++;
      continue;
    }

    const isRedirect = REDIRECT_OPERATORS.includes(operator);
    let opText = operator;
    const fdPrefix = isRedirect && inWord && /^[0-9]+$/.test(word) && cmd.slice(i - word.length, i) === word;
    if (fdPrefix) {
      opText = word + operator;
      word = '';
      inWord = false;
    } else {
      endWord();
    }
    if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
    i += operator.length;

    if (isRedirect) {
      pendingRedirect = opText;
      pendingRedirectEnd = i;
      continue;
    }

    tokens.push({ kind: 'op', value: operator });
    atCommandStart = true;
    program = null;
    if (operator === '\n') i = skipHeredocBodies(i);
  }

  if (quote !== '') throw new Unreadable(`unterminated ${quote} quote`);
  endWord();
  if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
  return tokens;
}
