/**
 * Tags rule (US-008): when the repo sets `tagsAllowed` to false, refuses `git tag` calls that
 * create, delete or move a tag, and `git push` calls that carry tags (`--tags`, `--follow-tags`,
 * `--mirror`, a `refs/tags/` destination, or the `tag <name>` refspec). Listing and verifying
 * tags stay allowed.
 */

import type { CommandPart } from '../command-reader.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';
import { rawDestination } from './protected-branch.js';
import { readPushWords } from './push-words.js';

/** `git tag` long options that take the next word as their value (a shortened form counts too). */
const TAG_VALUE_LONG = [
  '--local-user', '--message', '--file', '--contains', '--no-contains', '--points-at', '--merged',
  '--no-merged', '--sort', '--format', '--cleanup', '--trailer',
];
/** `git tag` short options that take a value: the rest of the word, or the next word. */
const TAG_VALUE_SHORT = new Set(['m', 'F', 'u']);
const TAG_CHANGE_LONG = new Set(['--annotate', '--sign', '--local-user', '--force', '--delete', '--message', '--file']);
const TAG_CHANGE_SHORT = new Set(['a', 's', 'u', 'f', 'd', 'm', 'F']);
const TAG_READ_LONG = new Set(['--list', '--verify']);
const TAG_READ_SHORT = new Set(['l', 'v']);

const PUSH_TAG_OPTIONS = new Set(['--tags', '--follow-tags', '--mirror']);
const TAGS_REF = 'refs/tags/';

/** True when this `git tag` call creates, deletes or moves a tag. */
function changesTag(args: string[]): boolean {
  let reads = false;
  let changes = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word.startsWith('--')) {
      const name = word.split('=')[0];
      if (TAG_READ_LONG.has(name)) reads = true;
      if (TAG_CHANGE_LONG.has(name)) changes = true;
      if (!word.includes('=') && name.length > 2 && TAG_VALUE_LONG.some((option) => option.startsWith(name))) i++;
    } else if (word.startsWith('-') && word.length > 1) {
      for (let c = 1; c < word.length; c++) {
        const letter = word[c];
        if (TAG_READ_SHORT.has(letter)) reads = true;
        if (TAG_CHANGE_SHORT.has(letter)) changes = true;
        if (TAG_VALUE_SHORT.has(letter)) {
          if (c === word.length - 1) i++;
          break;
        }
      }
    } else {
      changes = true;
    }
  }
  return changes && !reads;
}

/** The option or refspec words of a `git push` that carry tags, or undefined. */
function pushedTags(args: string[]): string | undefined {
  const { options, positional } = readPushWords(args);
  const option = options.find((word) => PUSH_TAG_OPTIONS.has(word));
  if (option !== undefined) return option;
  const refspecs = positional.slice(1);
  const tagWord = refspecs.indexOf('tag');
  if (tagWord !== -1 && tagWord + 1 < refspecs.length) return `tag ${refspecs[tagWord + 1]}`;
  return refspecs.find((spec) => spec.slice(spec.indexOf(':') + 1).replace(/^\+/, '').startsWith(TAGS_REF) || wildcardTags(spec));
}

/**
 * A wildcard destination (git's `*`, any text) that can name a tag: the text before its first `*`
 * is on the way to `refs/tags/` (`*`, `refs/*`, `refs/t*`) or already inside it.
 */
function wildcardTags(refspec: string): boolean {
  const dst = rawDestination(refspec);
  const star = dst.indexOf('*');
  if (star === -1) return false;
  const known = dst.slice(0, star);
  return TAGS_REF.startsWith(known) || known.startsWith(TAGS_REF);
}

function refuse(what: string): Refusal {
  return {
    rule: 'tags',
    reason: `Refused: \`${what}\`: this repo doesn't use tags (tagsAllowed is false in .oss/tool-gates.json).`,
  };
}

export function checkTags(part: CommandPart, settings: GateSettings): Refusal | null {
  if (settings.tagsAllowed || part.git === null) return null;
  const { subcommand, args } = part.git;
  if (subcommand === 'tag') {
    return changesTag(args) ? refuse(['git tag', ...args].join(' ')) : null;
  }
  if (subcommand === 'push') {
    const found = pushedTags(args);
    return found === undefined ? null : refuse(`git push ${found}`);
  }
  return null;
}
