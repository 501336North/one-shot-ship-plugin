/**
 * Pattern matchers for the tool gate. The patterns themselves come from the rule file
 * (config/tool-gates.json and the repo's .oss/tool-gates.json); this module holds none.
 *
 * - matchPath: path globs. `~/` is the user's home, a leading `**\/` matches at any depth
 *   (also outside the repo, by the path's tail), other relative globs are anchored at the
 *   repo root. `*` and `?` stay within one segment and match dotfiles; `**` crosses
 *   segments; a trailing `/**` matches what is under a folder, not the folder itself.
 * - matchCommand: the command's leading words match the pattern words one by one, each as
 *   a whole word where `*` matches any characters.
 */

import path from 'node:path';

const REGEX_CHARS = /[.+^${}()|[\]\\]/g;
const GLOB_TOKENS = new RegExp(`\\*\\*/|/\\*\\*$|\\*|\\?|${REGEX_CHARS.source}`, 'g');

function escape(text: string): string {
  return text.replace(REGEX_CHARS, '\\$&');
}

function globToRegex(glob: string): RegExp {
  const source = glob.replace(GLOB_TOKENS, (token) => {
    if (token === '**/') return '(?:.*/)?';
    if (token === '/**') return '/.+';
    if (token === '*') return '[^/]*';
    if (token === '?') return '[^/]';
    return escape(token);
  });
  return new RegExp(`^${source}$`);
}

export function matchPath(glob: string, absPath: string, opts: { home: string; root: string }): boolean {
  let full: string;
  if (glob.startsWith('~/')) full = path.join(opts.home, glob.slice(2));
  else if (glob.startsWith('**/') || path.isAbsolute(glob)) full = path.normalize(glob);
  else full = path.join(opts.root, glob);
  return globToRegex(full).test(path.normalize(absPath));
}

function wordMatches(patternWord: string, word: string): boolean {
  const source = patternWord.split('*').map(escape).join('.*');
  return new RegExp(`^${source}$`).test(word);
}

export function matchCommand(pattern: string, words: string[]): boolean {
  const patternWords = pattern.split(' ');
  return (
    words.length >= patternWords.length &&
    patternWords.every((patternWord, i) => wordMatches(patternWord, words[i] ?? ''))
  );
}
