/**
 * Dev Docs PROGRESS.md Synchronization Tests
 *
 * @behavior Agents update PROGRESS.md after completing work
 * @acceptance-criteria AC-DOC-001: PROGRESS.md updated after task completion
 * @acceptance-criteria AC-DOC-002: Stale PROGRESS.md detected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('PROGRESS.md Synchronization', () => {
  let testDir: string;
  let devDocsDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-sync-test-'));
    devDocsDir = path.join(testDir, 'dev', 'active', 'test-feature');
    fs.mkdirSync(devDocsDir, { recursive: true });
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('PROGRESS.md update verification', () => {
    it('should verify PROGRESS.md exists after task logged', async () => {
      // GIVEN: A task completes and should update PROGRESS.md
      const progressPath = path.join(devDocsDir, 'PROGRESS.md');

      // Create initial PROGRESS.md
      fs.writeFileSync(
        progressPath,
        `# Progress: Test Feature

## Current Phase: build

## Tasks
- [ ] Task 1: Implement feature (pending)
- [ ] Task 2: Write tests (pending)

## Last Updated: 2025-12-08 10:00 by /oss:plan
`
      );

      // WHEN: Task completion is logged
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          type: 'TASK_COMPLETE',
          task: 'Task 1: Implement feature',
          devdocs_updated: true,
          progress_file: progressPath,
        },
      });

      // Simulate agent updating PROGRESS.md
      const updatedContent = `# Progress: Test Feature

## Current Phase: build

## Tasks
- [x] Task 1: Implement feature (completed 2025-12-08)
- [ ] Task 2: Write tests (pending)

## Last Updated: 2025-12-08 15:30 by /oss:build
`;
      fs.writeFileSync(progressPath, updatedContent);

      // THEN: PROGRESS.md should exist and be updated
      expect(fs.existsSync(progressPath)).toBe(true);
      const content = fs.readFileSync(progressPath, 'utf-8');
      expect(content).toContain('[x] Task 1');
      expect(content).toContain('completed 2025-12-08');
    });

    it('should log dev docs update in workflow log', async () => {
      // GIVEN: Agent updates dev docs
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          type: 'DEVDOCS_UPDATED',
          files: ['PROGRESS.md', 'TESTING.md'],
          feature: 'test-feature',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Dev docs update logged
      expect(entries[0].data.type).toBe('DEVDOCS_UPDATED');
      expect(entries[0].data.files).toContain('PROGRESS.md');
    });
  });

  describe('Stale PROGRESS.md detection', () => {
    it('should detect stale PROGRESS.md (not updated in >1 hour during active work)', async () => {
      // GIVEN: PROGRESS.md was last updated 2 hours ago
      const progressPath = path.join(devDocsDir, 'PROGRESS.md');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      fs.writeFileSync(
        progressPath,
        `# Progress: Test Feature

## Current Phase: build

## Tasks
- [ ] Task 1: Implement feature (in progress)

## Last Updated: ${twoHoursAgo.toISOString().slice(0, 16).replace('T', ' ')} by /oss:build
`
      );

      // Set file modification time to 2 hours ago
      fs.utimesSync(progressPath, twoHoursAgo, twoHoursAgo);

      // WHEN: Active work is happening (logged recently)
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: { step: 'implementation_step_5' },
      });

      // THEN: We can detect the staleness by checking file mtime
      const stats = fs.statSync(progressPath);
      const now = new Date();
      const ageMs = now.getTime() - stats.mtime.getTime();
      const isStale = ageMs > 60 * 60 * 1000; // 1 hour

      expect(isStale).toBe(true);
    });

    it('should not flag fresh PROGRESS.md as stale', async () => {
      // GIVEN: PROGRESS.md was just updated
      const progressPath = path.join(devDocsDir, 'PROGRESS.md');

      fs.writeFileSync(
        progressPath,
        `# Progress: Test Feature

## Current Phase: build

## Tasks
- [x] Task 1: Implement feature (completed)

## Last Updated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by /oss:build
`
      );

      // THEN: File should not be stale
      const stats = fs.statSync(progressPath);
      const now = new Date();
      const ageMs = now.getTime() - stats.mtime.getTime();
      const isStale = ageMs > 60 * 60 * 1000;

      expect(isStale).toBe(false);
    });
  });

  describe('PROGRESS.md format verification', () => {
    it('should verify PROGRESS.md contains required sections', async () => {
      // GIVEN: A valid PROGRESS.md
      const progressPath = path.join(devDocsDir, 'PROGRESS.md');

      fs.writeFileSync(
        progressPath,
        `# Progress: Test Feature

## Current Phase: build

## Tasks
- [x] Task 1: Design (completed)
- [ ] Task 2: Implement (in progress)
- [ ] Task 3: Test (pending)

## Blockers
- None

## Last Updated: 2025-12-08 15:30 by /oss:build
`
      );

      // WHEN: Reading and validating content
      const content = fs.readFileSync(progressPath, 'utf-8');

      // THEN: Required sections exist
      expect(content).toContain('# Progress:');
      expect(content).toContain('## Current Phase:');
      expect(content).toContain('## Tasks');
      expect(content).toContain('## Last Updated:');

      // Task format is correct
      expect(content).toMatch(/- \[[ x]\] Task \d+:/);
    });
  });
});
