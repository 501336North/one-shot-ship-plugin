import { QueueManager } from '../queue/manager.js';
/**
 * Result of test output analysis
 */
export interface TestResult {
    hasFailures: boolean;
    testFile?: string;
    failedTests: string[];
    passedTests: string[];
    totalTests: number;
    duration?: number;
    output: string;
}
/**
 * Coverage check result
 */
export interface CoverageResult {
    hasDrop: boolean;
    current: number;
    baseline: number;
    drop: number;
}
/**
 * Test run record
 */
interface TestRunRecord {
    passed: boolean;
    timestamp: number;
}
/**
 * Test Monitor - Monitors test results for failures and flakiness
 *
 * Implements AC-003.1 through AC-003.5 from REQUIREMENTS.md
 */
export declare class TestMonitor {
    private readonly queueManager;
    private testHistory;
    private baselineCoverage;
    private readonly maxHistoryPerTest;
    constructor(queueManager: QueueManager, maxHistoryPerTest?: number);
    /**
     * Analyze test output and extract results
     */
    analyzeTestOutput(output: string): Promise<TestResult>;
    /**
     * Record a test run for flakiness tracking
     */
    recordTestRun(testFile: string, testName: string, passed: boolean): Promise<void>;
    /**
     * Check if a test is flaky (intermittent pass/fail)
     */
    isTestFlaky(testFile: string, testName: string): boolean;
    /**
     * Get test history for a specific test
     */
    getTestHistory(testFile: string, testName: string): TestRunRecord[];
    /**
     * Report all detected flaky tests
     */
    reportFlakyTests(): Promise<void>;
    /**
     * Set baseline coverage for drop detection
     */
    setBaselineCoverage(coverage: number): void;
    /**
     * Check if coverage dropped below baseline
     */
    checkCoverage(currentCoverage: number): Promise<CoverageResult>;
    /**
     * Report coverage drop
     */
    reportCoverageDrop(current: number, baseline: number): Promise<void>;
    /**
     * Report test failure
     */
    reportFailure(testResult: TestResult): Promise<void>;
    /**
     * Reset monitor state
     */
    reset(): void;
}
export {};
//# sourceMappingURL=test-monitor.d.ts.map