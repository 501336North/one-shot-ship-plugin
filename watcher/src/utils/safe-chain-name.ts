/**
 * The one workflow/command-name rule shared by chain-trigger and workflow-config.
 *
 * TODO(T1b): replace with isValidWorkflowName from watcher/src/utils/workflow-name.ts
 * once 2.0.87 lands - one helper, no second copy (IRON LAW #1b).
 */
export function isSafeChainName(name: string): boolean {
  return /^[a-z][a-z0-9-]{0,40}$/.test(name);
}
