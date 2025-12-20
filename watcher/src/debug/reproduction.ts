/**
 * Reproduction Test Generator
 * Generates failing test that proves bug exists (TDD RED phase)
 */

import type { ParsedBug } from './bug-parser.js';
import type { RootCause } from './investigation.js';
import type { SeverityLevel } from './severity.js';
import type { TaskParams } from './investigation.js';

export interface ConfirmedBug extends ParsedBug {
  rootCause: RootCause;
  severity: SeverityLevel;
  file?: string;
}

/**
 * Generate test file path based on bug location
 */
export function getTestPath(bug: { file?: string }): string {
  const timestamp = Date.now();

  if (!bug.file) {
    return `test/bug-${timestamp}.test.ts`;
  }

  // Extract directory from file path (e.g., 'src/auth.ts' -> 'auth')
  const match = bug.file.match(/src\/([^\/]+)\./);
  const dir = match ? match[1] : 'bug';

  return `test/${dir}/bug-${timestamp}.test.ts`;
}

/**
 * Generate test content that encodes expected behavior
 */
export function generateTestContent(bug: ConfirmedBug): string {
  const component = bug.component || 'component';

  let content = `describe('${component}', () => {\n`;
  content += `  it('${bug.rootCause.cause}', () => {\n`;
  content += `    expect(actual).toBe(expected);\n`;
  content += `  });\n`;
  content += `});\n`;

  return content;
}

/**
 * Create test-engineer task for writing reproduction test
 */
export function createTestTask(bug: ConfirmedBug): TaskParams {
  let prompt = `Write a failing test that reproduces this bug:\n\n`;
  prompt += `Error Type: ${bug.errorType}\n`;

  if (bug.message) {
    prompt += `Message: ${bug.message}\n`;
  }

  prompt += `\nRoot Cause: ${bug.rootCause.cause}\n`;
  prompt += `Evidence: ${bug.rootCause.evidence}\n`;

  return {
    subagent_type: 'test-engineer',
    prompt,
  };
}
