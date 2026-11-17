/**
 * What the main agent and the user are told about a review run (R-266, ADR-009): void (the repo changed
 * while it ran) or unverified (the check could not tell). Changed paths come from the repo a review
 * agent could write, so each is cut to one plain line before it is shown.
 */

import type { Notice } from './run-store.js';

const MAX_LISTED = 20;

/** Why a review run is unverified. */
export const REASONS = {
  badId: 'the review run could not be identified',
  notARepo: 'the review did not run in a git repo',
  startFailed: "the snapshot at the review's start failed",
  noSnapshot: 'no snapshot of the repo was found when the review ended',
  checkFailed: 'the check failed',
  timeout: 'the check ran out of time',
  tampered: "the check's own records were changed or replayed during the run",
  unknownNotice: 'a notice was found for a review run the check never started',
  noticeUnreadable: 'a notice could not be read; treat review runs in this session as unverified',
  recordsUnusable: "the check's records for this session could not be used",
  stopUnfinished: "the check at the review's end did not finish",
  versionChanged: 'the review check changed version during the run',
  /** Kept by hooks/oss-gate-run.sh itself (same text there) when it has no usable node to run the check. */
  noNode: 'the review check has no usable node',
} as const;

/** A path made safe for one line: control, format and line/paragraph separator characters become `?`. */
function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?');
}

/** The void message: up to 20 changed paths, then how many more (of `total`). */
export function voidMessage(files: readonly string[], total = files.length): string {
  const listed = files.slice(0, MAX_LISTED).map((file) => `- ${oneLine(file)}`);
  if (total > MAX_LISTED) listed.push(`- and ${total - MAX_LISTED} more`);
  const user = files.some((file) => file.startsWith('(user) '))
    ? [
        'Paths marked (user) are files outside the reviewed code that steer the review gate (OSS tool-gate and model settings, Claude hook, env and plugin settings in your home folder or a reviewed repo\'s .claude folder, installed plugins, the OSS hooks and plugin, the node and programs the hooks run, the repos the check covers).',
        'A change from outside the review, by another Claude session or you, would also void it.',
      ]
    : [];
  const cli = files.some((file) => file === '(user) ~/.oss/bin/oss-decrypt')
    ? ['~/.oss/bin/oss-decrypt changed: an OSS decrypt CLI update during the review is the likely cause; the review is still void.']
    : [];
  return [
    "This review's report is void: the repo changed while the review ran, so it did not judge the code as it is now.",
    'Changed:',
    ...listed,
    ...user,
    ...cli,
    'Stop the ship and ask the user how to go on before acting on this review.',
  ].join('\n');
}

/** The unverified message, with the reason. */
export function unverifiedMessage(reason: string): string {
  return [
    `This review's report is unverified: OSS could not check whether the repo changed while the review ran (${oneLine(reason)}).`,
    "Treat the review's report as unverified: stop the ship and ask the user how to go on before acting on this review.",
  ].join('\n');
}

export function noticeMessage(notice: Notice): string {
  return notice.kind === 'void' ? voidMessage(notice.files, notice.total) : unverifiedMessage(notice.reason);
}
