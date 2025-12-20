/**
 * Debug Documentation Generator
 * Generates DEBUG.md from investigation results
 */

import type { ConfirmedBug } from './reproduction.js';

export interface DebugData {
  bug: ConfirmedBug;
  testPath: string;
  investigation: string;
}

/**
 * Generate DEBUG.md content from debug data
 */
export function generateDebugDoc(data: DebugData): string {
  let doc = '# Debug Report\n\n';

  doc += '## Bug Report\n\n';
  doc += `**Error Type**: ${data.bug.errorType}\n`;
  doc += `**Message**: ${data.bug.message}\n`;
  doc += `**Component**: ${data.bug.component}\n`;
  doc += `**Severity**: ${data.bug.severity}\n\n`;

  doc += '## Investigation\n\n';
  doc += `${data.investigation}\n\n`;

  doc += '## Root Cause Analysis\n\n';
  doc += `**Cause**: ${data.bug.rootCause.cause}\n`;
  doc += `**Evidence**: ${data.bug.rootCause.evidence}\n\n`;

  doc += '## Reproduction Test\n\n';
  doc += `**Test Path**: ${data.testPath}\n\n`;

  doc += '## TDD Fix Plan\n\n';
  doc += 'Fix tasks will be added to PROGRESS.md\n\n';

  doc += '## Verification Checklist\n\n';
  doc += '- [ ] Test fails\n';
  doc += '- [ ] Root cause verified\n';
  doc += '- [ ] Fix approach documented\n';

  return doc;
}
