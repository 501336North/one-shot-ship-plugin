/**
 * Team command names (the part after `team:`) allow a leading digit and longer names than
 * /oss: commands (G1), capped at 100 because oss-decrypt's validateName rejects longer
 * names (D2). /oss: names use isValidWorkflowName (workflow-name.ts).
 */
export function isSafeTeamCommandName(name: string): boolean {
  return /^[a-z0-9-]{1,100}$/.test(name);
}
