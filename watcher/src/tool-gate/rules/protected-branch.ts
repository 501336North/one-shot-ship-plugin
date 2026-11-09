/**
 * Protected-branch rule (US-001): refuses `git commit` / `git push` while the part's
 * directory is on a protected branch, and a push whose destination is a protected branch
 * (explicit refspec, `--all` or `--mirror`) from any branch. Branch names come only from
 * the settings.
 */

import type { CommandPart } from '../command-reader.js';
import type { GateSettings } from '../rule-file.js';
import type { GitReader } from '../git-reader.js';
import type { Refusal } from './refusal.js';
import { readPushWords } from './push-words.js';

/** The remote branch a refspec writes to (or deletes). */
function destination(refspec: string): string {
  const spec = refspec.startsWith('+') ? refspec.slice(1) : refspec;
  const colon = spec.indexOf(':');
  const dst = colon === -1 ? spec : spec.slice(colon + 1);
  return dst.startsWith('refs/heads/') ? dst.slice('refs/heads/'.length) : dst;
}

export function checkProtectedBranch(part: CommandPart, settings: GateSettings, git: GitReader): Refusal | null {
  const facts = part.git;
  if (!facts || (facts.subcommand !== 'commit' && facts.subcommand !== 'push')) return null;
  const command = `git ${facts.subcommand}`;
  const protectedList = settings.protectedBranches;

  const branch = git.currentBranch(facts.dir);
  if (branch !== null && protectedList.includes(branch)) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command}\` while on \`${branch}\`, a protected branch. Use a feature branch.`,
    };
  }
  if (facts.subcommand !== 'push') return null;

  const { options, positional } = readPushWords(facts.args);
  const everything = options.find((word) => word === '--all' || word === '--mirror');
  if (everything !== undefined) {
    return {
      rule: 'protected-branch',
      reason: `Refused: \`${command} ${everything}\` can push protected branches (${protectedList.map((b) => `\`${b}\``).join(', ')}). Push one feature branch instead.`,
    };
  }
  const target = positional.slice(1).map(destination).find((dst) => protectedList.includes(dst));
  if (target === undefined) return null;
  return {
    rule: 'protected-branch',
    reason: `Refused: \`${command}\` to \`${target}\`, a protected branch. Push a feature branch and open a PR.`,
  };
}
