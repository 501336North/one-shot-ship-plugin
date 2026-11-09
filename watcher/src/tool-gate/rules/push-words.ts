/**
 * Splits the words after `git push` into options and positional words (repository, then
 * refspecs). The value of an option such as `-o` is neither, so `-o force` is not a flag.
 */

/** `git push` options that take the next word as their value. */
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

export interface PushWords {
  options: string[];
  positional: string[];
}

export function readPushWords(args: string[]): PushWords {
  const options: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (PUSH_VALUE_OPTIONS.has(word)) i++;
    else if (word.startsWith('-')) options.push(word);
    else positional.push(word);
  }
  return { options, positional };
}
