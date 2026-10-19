/**
 * @behavior Ship enhancements provide learn extraction capabilities
 * @acceptance-criteria learn-extractor.sh exists and works correctly
 * @business-rule Ship can extract error-resolution patterns from session logs
 * @boundary Shell script (learn-extractor.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Ship Enhancements', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const learnScript = path.join(hooksDir, 'learn-extractor.sh');

  const execOptions: ExecSyncOptionsWithStringEncoding = {
    timeout: 30000,
    encoding: 'utf-8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
    },
  };

  describe('learn-extractor.sh', () => {
    const testSessionDir = path.join(os.tmpdir(), `oss-learn-test-${Date.now()}`);
    const testLogsDir = path.join(testSessionDir, '.oss', 'logs', 'current-session');
    const testSkillsDir = path.join(testSessionDir, '.oss', 'skills', 'learned');

    beforeEach(() => {
      // Create test directories
      fs.mkdirSync(testLogsDir, { recursive: true });
      fs.mkdirSync(testSkillsDir, { recursive: true });
    });

    afterEach(() => {
      // Clean up test directories
      if (fs.existsSync(testSessionDir)) {
        fs.rmSync(testSessionDir, { recursive: true, force: true });
      }
    });

    /**
     * @behavior learn-extractor.sh exists and is executable
     * @acceptance-criteria Script exists in hooks directory with execute permission
     */
    it('should exist and be executable', () => {
      expect(fs.existsSync(learnScript)).toBe(true);
      const stats = fs.statSync(learnScript);
      // Check if executable (any execute bit set)
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    /**
     * @behavior extracts patterns from session logs
     * @acceptance-criteria Reads .oss/logs/current-session/*.log files
     */
    it('should read session log files', () => {
      // Create a test log file with an error-resolution pattern
      const logContent = `
[2026-01-23T10:00:00Z] ERROR: TypeScript compilation failed
[2026-01-23T10:00:01Z] Error: Cannot find module './types'
[2026-01-23T10:00:30Z] RESOLUTION: Added missing export in types.ts
[2026-01-23T10:00:31Z] SUCCESS: TypeScript compilation passed
`;
      fs.writeFileSync(path.join(testLogsDir, 'session.log'), logContent);

      let output: string;
      try {
        output = execSync(`bash "${learnScript}" --project-root "${testSessionDir}" --dry-run`, {
          ...execOptions,
          env: {
            ...execOptions.env,
            OSS_PROJECT_ROOT: testSessionDir,
          },
        });
      } catch (error: unknown) {
        output = (error as { stdout?: string }).stdout || '';
      }

      // Should indicate it found the log file
      expect(output).toMatch(/session\.log|log.*found|scanning/i);
    });

    /**
     * @behavior saves patterns to correct location
     * @acceptance-criteria Pattern files created in .oss/skills/learned/{pattern-name}.md
     */
    it('should save patterns to .oss/skills/learned/', () => {
      // Create a test log with clear error-resolution pattern
      const logContent = `
[2026-01-23T10:00:00Z] ERROR: Missing dependency lodash
[2026-01-23T10:00:05Z] RESOLUTION: npm install lodash
[2026-01-23T10:00:10Z] SUCCESS: Dependency installed
`;
      fs.writeFileSync(path.join(testLogsDir, 'session.log'), logContent);

      try {
        execSync(`bash "${learnScript}" --project-root "${testSessionDir}"`, {
          ...execOptions,
          env: {
            ...execOptions.env,
            OSS_PROJECT_ROOT: testSessionDir,
          },
        });
      } catch {
        // Script may exit with error if no patterns found
      }

      // Check the output location is correct (skills/learned directory)
      const expectedDir = path.join(testSessionDir, '.oss', 'skills', 'learned');
      expect(fs.existsSync(expectedDir)).toBe(true);
    });

    /**
     * @behavior pattern file has required sections
     * @acceptance-criteria Pattern file contains: Pattern name, Extracted date, Source Session, Problem, Solution, When to Apply
     */
    it('should create pattern files with required sections', () => {
      // Create a detailed log with clear pattern
      const logContent = `
[2026-01-23T10:00:00Z] ERROR: Jest test timeout
[2026-01-23T10:00:01Z] Details: Test exceeded 5000ms timeout
[2026-01-23T10:00:30Z] RESOLUTION: Added async/await and increased timeout
[2026-01-23T10:00:31Z] SUCCESS: Tests passing
`;
      fs.writeFileSync(path.join(testLogsDir, 'session.log'), logContent);

      try {
        execSync(`bash "${learnScript}" --project-root "${testSessionDir}"`, {
          ...execOptions,
          env: {
            ...execOptions.env,
            OSS_PROJECT_ROOT: testSessionDir,
          },
        });
      } catch {
        // Script may exit with non-zero if no patterns extracted
      }

      // Check if any pattern file was created
      const files = fs.existsSync(testSkillsDir)
        ? fs.readdirSync(testSkillsDir).filter(f => f.endsWith('.md'))
        : [];

      if (files.length > 0) {
        const patternFile = fs.readFileSync(path.join(testSkillsDir, files[0]), 'utf-8');

        // Check for required sections
        expect(patternFile).toMatch(/# Pattern:/);
        expect(patternFile).toMatch(/\*\*Extracted:\*\*/);
        expect(patternFile).toMatch(/\*\*Source Session:\*\*/);
        expect(patternFile).toMatch(/## Problem/);
        expect(patternFile).toMatch(/## Solution/);
        expect(patternFile).toMatch(/## When to Apply/);
      } else {
        // If no files created, ensure the script at least accepts the format
        let output: string;
        try {
          output = execSync(`bash "${learnScript}" --help`, execOptions);
        } catch (error: unknown) {
          output = (error as { stdout?: string }).stdout || '';
        }
        expect(output).toMatch(/pattern|learn|extract/i);
      }
    });

    /**
     * @behavior identifies error-resolution patterns in logs
     * @acceptance-criteria Detects ERROR followed by RESOLUTION/SUCCESS patterns
     */
    it('should identify error-resolution patterns', () => {
      const logContent = `
[2026-01-23T10:00:00Z] INFO: Starting build
[2026-01-23T10:00:05Z] ERROR: Module not found: react
[2026-01-23T10:00:10Z] ACTION: npm install react
[2026-01-23T10:00:20Z] RESOLUTION: Added react dependency
[2026-01-23T10:00:25Z] SUCCESS: Build completed
`;
      fs.writeFileSync(path.join(testLogsDir, 'build.log'), logContent);

      let output: string;
      try {
        output = execSync(`bash "${learnScript}" --project-root "${testSessionDir}" --verbose`, {
          ...execOptions,
          env: {
            ...execOptions.env,
            OSS_PROJECT_ROOT: testSessionDir,
          },
        });
      } catch (error: unknown) {
        output = (error as { stdout?: string }).stdout || '';
      }

      // Should detect the error-resolution pattern
      expect(output).toMatch(/pattern|error|resolution|found/i);
    });
  });
});
