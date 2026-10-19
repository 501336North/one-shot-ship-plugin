/**
 * The one workflow/command-name rule. Twin of oss_valid_workflow_name in hooks/oss-safe-path.sh;
 * test/utils/workflow-name.test.ts reads that file and fails if the two literals differ.
 */
export const WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

export function isValidWorkflowName(name: string): boolean {
  return WORKFLOW_NAME_PATTERN.test(name);
}

export function assertValidWorkflowName(name: string): void {
  if (!isValidWorkflowName(name)) {
    throw new Error('Invalid workflow name');
  }
}
