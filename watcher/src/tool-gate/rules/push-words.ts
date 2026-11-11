/**
 * Splits the words after `git push` into options and positional words (repository, then
 * refspecs). The value of an option such as `-o` is neither, so `-o force` is not a flag.
 * A shortened long option (`--forc`, `--mir`) is read as the full option git takes it for.
 */

/** `git push` options that take the next word as their value. */
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

/** The long options of `git push` (git push -h), used to expand shortened ones. */
const PUSH_LONG_OPTIONS = [
  '--all', '--branches', '--mirror', '--delete', '--tags', '--dry-run', '--porcelain', '--force',
  '--force-with-lease', '--force-if-includes', '--recurse-submodules', '--thin', '--no-thin',
  '--receive-pack', '--exec', '--repo', '--set-upstream', '--follow-tags', '--signed', '--atomic',
  '--push-option', '--ipv4', '--ipv6', '--no-verify', '--verify', '--progress', '--quiet', '--verbose',
  '--prune', '--no-force-with-lease', '--no-signed',
];

/**
 * The full option a long option stands for. A prefix of several options is expanded only when
 * one of them is a prefix of all the others (`--forc` → `--force`); otherwise it is kept.
 */
function fullOption(word: string): string {
  if (!word.startsWith('--')) return word;
  const eq = word.indexOf('=');
  const name = eq === -1 ? word : word.slice(0, eq);
  const matches = PUSH_LONG_OPTIONS.filter((option) => option.startsWith(name));
  const shortest = matches.find((option) => matches.every((other) => other.startsWith(option)));
  if (shortest === undefined) return word;
  return eq === -1 ? shortest : shortest + word.slice(eq);
}

export interface PushWords {
  options: string[];
  positional: string[];
}

export function readPushWords(args: string[]): PushWords {
  const options: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = fullOption(args[i]);
    if (PUSH_VALUE_OPTIONS.has(word)) i++;
    else if (word.startsWith('-')) options.push(word);
    else positional.push(word);
  }
  return { options, positional };
}
