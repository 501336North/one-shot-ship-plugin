/**
 * Test Runner
 * Runs reproduction test and verifies it fails (RED confirmation)
 */

export interface TestResult {
  passed: boolean;
  errorMessage?: string;
}

export interface VerificationResult {
  success: boolean;
  error?: string;
}

/**
 * Build npm test command for single test file
 */
export function buildTestCommand(testPath: string): string {
  const filename = testPath.split('/').pop();
  return `npm test -- ${filename}`;
}

/**
 * Parse test output to determine pass/fail
 */
export function parseTestResult(output: string): TestResult {
  // Check for failure indicators
  if (output.includes('FAIL') || output.includes('AssertionError')) {
    const errorMatch = output.match(/AssertionError[^\n]*/);
    return {
      passed: false,
      errorMessage: errorMatch ? errorMatch[0] : 'Test failed',
    };
  }

  // Check for success indicators
  if (output.includes('✓') && output.includes('passed')) {
    return { passed: true };
  }

  // Default to failure for safety
  return { passed: false, errorMessage: 'Unable to parse test output' };
}

/**
 * Verify test fails (enforces TDD RED phase)
 */
export function verifyTestFails(result: TestResult): VerificationResult {
  if (result.passed) {
    return {
      success: false,
      error: 'Bug not reproduced - test passes',
    };
  }

  return { success: true };
}
