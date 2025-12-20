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
export declare function buildTestCommand(testPath: string): string;
/**
 * Parse test output to determine pass/fail
 */
export declare function parseTestResult(output: string): TestResult;
/**
 * Verify test fails (enforces TDD RED phase)
 */
export declare function verifyTestFails(result: TestResult): VerificationResult;
//# sourceMappingURL=test-runner.d.ts.map