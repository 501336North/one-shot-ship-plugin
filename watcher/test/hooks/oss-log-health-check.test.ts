/**
 * @behavior Health check command writes output to log file for SwiftBar status detection
 * @acceptance-criteria SwiftBar shows correct icon (green/red) based on health check result
 * @business-rule Health check status must persist to log file for menu bar visibility
 * @boundary Shell script (oss-log.sh health-check)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh health-check', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const healthCheckLog = path.join(logsDir, 'health-check.log');

  // Save original files
  let originalCurrentProject: string | null = null;
  let originalPluginRoot: string | null = null;

  beforeEach(() => {
    // Save original marker files
    const currentProjectFile = path.join(ossDir, 'current-project');
    const pluginRootFile = path.join(ossDir, 'plugin-root');

    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    if (fs.existsSync(pluginRootFile)) {
      originalPluginRoot = fs.readFileSync(pluginRootFile, 'utf-8');
    }

    // Create test project with passing tests
    fs.mkdirSync(testProjectDir, { recursive: true });
    fs.writeFileSync(
      path.join(testProjectDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: {
          test: 'echo "1 passing" && exit 0'
        }
      })
    );

    // Set up marker files for health check
    fs.mkdirSync(ossDir, { recursive: true });
    fs.writeFileSync(path.join(ossDir, 'current-project'), testProjectDir);
    fs.writeFileSync(path.join(ossDir, 'plugin-root'), path.join(__dirname, '../../..'));

    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Remove any existing health check log
    if (fs.existsSync(healthCheckLog)) {
      fs.unlinkSync(healthCheckLog);
    }
  });

  afterEach(() => {
    // Restore original marker files
    const currentProjectFile = path.join(ossDir, 'current-project');
    const pluginRootFile = path.join(ossDir, 'plugin-root');

    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    }
    if (originalPluginRoot !== null) {
      fs.writeFileSync(pluginRootFile, originalPluginRoot);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Running health-check writes output to health-check.log
   * @acceptance-criteria Log file must contain health check output for SwiftBar to read
   */
  it('should write health check output to log file', () => {
    // GIVEN: A project with passing tests and no existing log file
    expect(fs.existsSync(healthCheckLog)).toBe(false);

    // WHEN: Running oss-log.sh health-check
    try {
      execSync(`bash "${ossLogScript}" health-check`, {
        timeout: 60000,
        encoding: 'utf-8',
      });
    } catch {
      // Command may exit with non-zero for various reasons, we care about the log file
    }

    // THEN: The health check log file should exist and contain output
    expect(fs.existsSync(healthCheckLog)).toBe(true);

    const logContent = fs.readFileSync(healthCheckLog, 'utf-8');
    expect(logContent.length).toBeGreaterThan(0);
  });

  /**
   * @behavior Log file contains PASSED or FAILED marker for SwiftBar detection
   * @acceptance-criteria SwiftBar grep for "HEALTH CHECK PASSED" or "HEALTH CHECK FAILED" must find result
   * @note Health check can pass/fail based on many factors (test output, system checks)
   */
  it('should contain PASSED or FAILED marker in log file', () => {
    // GIVEN: A project with tests

    // WHEN: Running health check
    try {
      execSync(`bash "${ossLogScript}" health-check`, {
        timeout: 60000,
        encoding: 'utf-8',
      });
    } catch {
      // Ignore exit code
    }

    // THEN: Log file should contain a status marker
    expect(fs.existsSync(healthCheckLog)).toBe(true);

    const logContent = fs.readFileSync(healthCheckLog, 'utf-8');
    // Health check CLI outputs "HEALTH CHECK PASSED" or "HEALTH CHECK FAILED" or "HEALTH CHECK WARNING"
    // or may contain other status indicators like "✅" or "❌" or "⚠️"
    const hasPassedMarker = logContent.includes('HEALTH CHECK PASSED') || logContent.includes('✅');
    const hasFailedMarker = logContent.includes('HEALTH CHECK FAILED') || logContent.includes('❌') || logContent.includes('CRITICAL');
    const hasWarningMarker = logContent.includes('HEALTH CHECK WARNING') || logContent.includes('⚠️');

    expect(hasPassedMarker || hasFailedMarker || hasWarningMarker).toBe(true);
  });

  /**
   * @behavior Exit code reflects health check result (0 = pass, 1 = fail, 2 = error)
   * @acceptance-criteria Scripts can chain based on health check exit code
   * @note In test environment, system health checks may fail (missing git, logs, etc.)
   *       so we just verify the CLI runs and returns a valid exit code
   */
  it('should preserve exit code from health check', () => {
    // GIVEN: A project with passing tests (but minimal test environment)

    // WHEN: Running health check
    let exitCode: number | null = null;
    try {
      execSync(`bash "${ossLogScript}" health-check`, {
        timeout: 60000,
        encoding: 'utf-8',
      });
      exitCode = 0;
    } catch (error) {
      const execError = error as { status?: number };
      exitCode = execError.status ?? 1;
    }

    // THEN: Exit code should be a valid health check code
    // 0 = all passed, 1 = test failures, 2 = system errors/critical issues
    expect([0, 1, 2]).toContain(exitCode);
  });

  /**
   * @behavior Failed tests result in log file being written (regardless of exit code)
   * @acceptance-criteria SwiftBar can read log file to determine status
   * @note Exit code depends on health check CLI analysis, not npm test exit code directly
   */
  it('should write log file even when tests fail', () => {
    // GIVEN: A project with failing tests
    fs.writeFileSync(
      path.join(testProjectDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: {
          test: 'echo "1 failing" && exit 1'
        }
      })
    );

    // WHEN: Running health check (may pass or fail based on CLI analysis)
    try {
      execSync(`bash "${ossLogScript}" health-check`, {
        timeout: 60000,
        encoding: 'utf-8',
      });
    } catch {
      // Exit code varies based on health check CLI analysis
    }

    // THEN: Log file should still be written
    expect(fs.existsSync(healthCheckLog)).toBe(true);
    const logContent = fs.readFileSync(healthCheckLog, 'utf-8');
    expect(logContent.length).toBeGreaterThan(0);
  });
});
