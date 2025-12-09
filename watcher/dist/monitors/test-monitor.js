/**
 * Test Monitor - Monitors test results for failures and flakiness
 *
 * Implements AC-003.1 through AC-003.5 from REQUIREMENTS.md
 */
export class TestMonitor {
    queueManager;
    testHistory;
    baselineCoverage;
    maxHistoryPerTest;
    constructor(queueManager, maxHistoryPerTest = 10) {
        this.queueManager = queueManager;
        this.testHistory = new Map();
        this.baselineCoverage = null;
        this.maxHistoryPerTest = maxHistoryPerTest;
    }
    /**
     * Check if a line looks like vitest output (not build tool output)
     */
    isVitestLine(line) {
        // Exclude common build tool outputs that use checkmarks
        const excludePatterns = [
            /Generated Prisma Client/i,
            /Build success/i,
            /Build start/i,
            /cache hit/i,
            /cache miss/i,
            /Cleaning output/i,
            /Installing/i,
            /Compiled/i,
            /Bundled/i,
            /Created/i,
            /Generating/i,
            /Generated /i, // Note: trailing space to be more specific
            /Tip:/i,
            /Start by/i,
            /pris\.ly/i,
            /https?:\/\//i, // URLs
            /@agentic\//, // Turbo package prefixes like @agentic/database:build
            /tsup/i,
            /esbuild/i,
            /webpack/i,
            /rollup/i,
            /vite(?!st)/i, // vite but not vitest
            /next\.js/i,
            /Building entry/i,
            /Using tsconfig/i,
            /Target:/i,
            /dist\//i, // Output paths like dist/index.js
            /\.d\.ts/i, // Type definition files
            /\.mjs/i, // ES module files in build output
            /node_modules/i,
        ];
        for (const pattern of excludePatterns) {
            if (pattern.test(line)) {
                return false;
            }
        }
        // Vitest test file lines look like: ✓ test/file.test.ts (N tests)
        // Vitest individual test lines are indented and may have timing
        const isTestFileLine = /[✓✔✕×]\s+\S+\.test\.[tj]sx?\s+\(\d+\s+tests?\)/i.test(line);
        const isIndentedTestLine = /^\s+[✓✔✕×]\s+.+/i.test(line);
        return isTestFileLine || isIndentedTestLine;
    }
    /**
     * Analyze test output and extract results
     */
    async analyzeTestOutput(output) {
        const result = {
            hasFailures: false,
            failedTests: [],
            passedTests: [],
            totalTests: 0,
            output,
        };
        // Detect failures from vitest FAIL pattern
        const failPattern = /FAIL\s+(\S+\.test\.[tj]sx?)/gi;
        const failMatch = output.match(failPattern);
        if (failMatch) {
            result.hasFailures = true;
            // Extract test file from first match
            const fileMatch = output.match(/FAIL\s+(\S+\.test\.[tj]sx?)/i);
            if (fileMatch) {
                result.testFile = fileMatch[1];
            }
        }
        // Process line by line to avoid false positives from build output
        const lines = output.split('\n');
        for (const line of lines) {
            // Skip lines that aren't vitest output
            if (!this.isVitestLine(line)) {
                continue;
            }
            // Extract failed test names (vitest pattern: ✕ test name)
            // Handles both "test name  123ms" and "test name (123ms)" formats
            const failedMatch = line.match(/[✕×]\s+(.+?)(?:\s+\(?\d+\s*m?s\)?|\s*$)/);
            if (failedMatch) {
                result.hasFailures = true;
                result.failedTests.push(failedMatch[1].trim());
            }
            // Extract passed test names (vitest pattern: ✓ test name)
            // Only count individual test names, not file summaries
            // Handles both "test name  123ms" and "test name (123ms)" formats
            const passedMatch = line.match(/^\s+[✓✔]\s+(.+?)(?:\s+\(?\d+\s*m?s\)?|\s*$)/);
            if (passedMatch) {
                result.passedTests.push(passedMatch[1].trim());
            }
        }
        result.totalTests = result.failedTests.length + result.passedTests.length;
        // Also check summary lines for authoritative count
        const summaryFailPattern = /(\d+)\s+failed/i;
        const summaryMatch = output.match(summaryFailPattern);
        if (summaryMatch && parseInt(summaryMatch[1], 10) > 0) {
            result.hasFailures = true;
        }
        // Trust summary over regex matching - vitest summary is authoritative
        const summaryPassPattern = /Tests\s+(\d+)\s+passed/i;
        const passMatch = output.match(summaryPassPattern);
        if (passMatch) {
            const summaryPassCount = parseInt(passMatch[1], 10);
            // If summary says all passed and we detected no failures, trust it
            if (summaryPassCount > 0 && !summaryMatch) {
                result.hasFailures = false;
                result.failedTests = [];
            }
        }
        return result;
    }
    /**
     * Record a test run for flakiness tracking
     */
    async recordTestRun(testFile, testName, passed) {
        const key = `${testFile}::${testName}`;
        const history = this.testHistory.get(key) || [];
        history.push({
            passed,
            timestamp: Date.now(),
        });
        // Limit history size
        while (history.length > this.maxHistoryPerTest) {
            history.shift();
        }
        this.testHistory.set(key, history);
    }
    /**
     * Check if a test is flaky (intermittent pass/fail)
     */
    isTestFlaky(testFile, testName) {
        const key = `${testFile}::${testName}`;
        const history = this.testHistory.get(key);
        if (!history || history.length < 3) {
            return false; // Need minimum runs to determine flakiness
        }
        // Check for mixed results
        const passes = history.filter(r => r.passed).length;
        const fails = history.filter(r => !r.passed).length;
        // Flaky if both passes and fails exist
        return passes > 0 && fails > 0;
    }
    /**
     * Get test history for a specific test
     */
    getTestHistory(testFile, testName) {
        const key = `${testFile}::${testName}`;
        return this.testHistory.get(key) || [];
    }
    /**
     * Report all detected flaky tests
     */
    async reportFlakyTests() {
        for (const [key, history] of this.testHistory.entries()) {
            const [testFile, testName] = key.split('::');
            if (this.isTestFlaky(testFile, testName)) {
                const passes = history.filter(r => r.passed).length;
                const fails = history.filter(r => !r.passed).length;
                const task = {
                    priority: 'medium',
                    source: 'test-monitor',
                    anomaly_type: 'test_flaky',
                    prompt: `Fix flaky test "${testName}" in ${testFile}. The test has passed ${passes} times and failed ${fails} times in recent runs. Investigate root cause (timing, shared state, external dependencies).`,
                    suggested_agent: 'debugger',
                    context: {
                        test_file: testFile,
                        test_name: testName,
                        failure_count: fails,
                    },
                };
                await this.queueManager.addTask(task);
            }
        }
    }
    /**
     * Set baseline coverage for drop detection
     */
    setBaselineCoverage(coverage) {
        this.baselineCoverage = coverage;
    }
    /**
     * Check if coverage dropped below baseline
     */
    async checkCoverage(currentCoverage) {
        const baseline = this.baselineCoverage || 0;
        const drop = baseline - currentCoverage;
        return {
            hasDrop: currentCoverage < baseline,
            current: currentCoverage,
            baseline,
            drop: Math.max(0, drop),
        };
    }
    /**
     * Report coverage drop
     */
    async reportCoverageDrop(current, baseline) {
        const drop = baseline - current;
        const task = {
            priority: 'medium',
            source: 'test-monitor',
            anomaly_type: 'coverage_drop',
            prompt: `Test coverage dropped from ${baseline}% to ${current}% (${drop}% decrease). Add tests for uncovered code paths.`,
            suggested_agent: 'test-engineer',
            context: {
                analysis: `Coverage dropped from ${baseline}% to ${current}% (${drop}% drop)`,
            },
        };
        await this.queueManager.addTask(task);
    }
    /**
     * Report test failure
     */
    async reportFailure(testResult) {
        // Only create a task if we have actual test failures with names
        // Don't create phantom "Unknown test" tasks
        if (!testResult.hasFailures || testResult.failedTests.length === 0) {
            return;
        }
        const failedTestName = testResult.failedTests[0];
        const task = {
            priority: 'high',
            source: 'test-monitor',
            anomaly_type: 'test_failure',
            prompt: `Fix failing test "${failedTestName}" in ${testResult.testFile || 'unknown file'}. Analyze the test failure and implement the necessary fix.`,
            suggested_agent: 'debugger',
            context: {
                test_file: testResult.testFile,
                test_name: failedTestName,
                failure_count: testResult.failedTests.length,
                last_error: testResult.output.slice(0, 300),
            },
        };
        await this.queueManager.addTask(task);
    }
    /**
     * Reset monitor state
     */
    reset() {
        this.testHistory.clear();
        this.baselineCoverage = null;
    }
}
//# sourceMappingURL=test-monitor.js.map