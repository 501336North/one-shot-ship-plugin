/**
 * @behavior Claude Code status line shows TDD phase from workflow-state.json
 * @acceptance-criteria AC-STATUS-003
 * @business-rule STATUS-003
 * @boundary Shell/Claude Code
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('Claude Code Status Line', () => {
  const testHome = path.join(tmpdir(), `oss-statusline-home-${Date.now()}`);
  const testOssDir = path.join(testHome, '.oss');
  const workflowStateFile = path.join(testOssDir, 'workflow-state.json');

  // Path to the status line script
  const statusLineScript = path.join(__dirname, '../../..', 'hooks', 'oss-statusline.sh');

  beforeEach(async () => {
    await fs.mkdir(testOssDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testHome, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  /**
   * Helper to run status line script with Claude Code context
   */
  function runStatusLine(context: object = {}): string {
    const defaultContext = {
      hook_event_name: 'Status',
      model: { id: 'claude-opus-4-5-20251101', display_name: 'Opus' },
      workspace: { current_dir: '/test/project', project_dir: '/test/project' }
    };
    const mergedContext = { ...defaultContext, ...context };

    try {
      const output = execSync(
        `echo '${JSON.stringify(mergedContext)}' | HOME="${testHome}" bash "${statusLineScript}"`,
        { encoding: 'utf-8', env: { ...process.env, HOME: testHome } }
      );
      return output.trim();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'stdout' in error) {
        return ((error as { stdout: string }).stdout || '').trim();
      }
      throw error;
    }
  }

  describe('TDD Phase Display', () => {
    it('should show 🔴 phase emoji in status line', async () => {
      await fs.writeFile(workflowStateFile, JSON.stringify({
        tddPhase: 'RED',
        progress: '3/8',
        supervisor: 'watching'
      }));

      const output = runStatusLine();

      expect(output).toContain('🔴');
      // Emoji-only display (no "RED" text)
    });

    it('should show 🟢 phase emoji in status line', async () => {
      await fs.writeFile(workflowStateFile, JSON.stringify({
        tddPhase: 'GREEN',
        progress: '5/8',
        supervisor: 'watching'
      }));

      const output = runStatusLine();

      expect(output).toContain('🟢');
      // Emoji-only display (no "GREEN" text)
    });

    it('should show 🔄 phase emoji in status line', async () => {
      await fs.writeFile(workflowStateFile, JSON.stringify({
        tddPhase: 'REFACTOR',
        progress: '7/8',
        supervisor: 'watching'
      }));

      const output = runStatusLine();

      expect(output).toContain('🔄');
      // Emoji-only display (no "REFACTOR" text)
    });
  });

  describe('Task Progress Display', () => {
    it('should show task progress in status line', async () => {
      await fs.writeFile(workflowStateFile, JSON.stringify({
        tddPhase: 'RED',
        progress: '3/8',
        supervisor: null
      }));

      const output = runStatusLine();

      expect(output).toContain('3/8');
    });
  });

  describe('Model Display', () => {
    it('should include model name from Claude Code context', async () => {
      await fs.writeFile(workflowStateFile, JSON.stringify({
        tddPhase: 'GREEN',
        progress: '4/10',
        supervisor: null
      }));

      const output = runStatusLine({ model: { display_name: 'Opus' } });

      expect(output).toContain('Opus');
    });
  });

  describe('Queue Count Display', () => {
    const queueFile = path.join(testOssDir, 'queue.json');

    it('should show 📋N when queue has N pending tasks', async () => {
      await fs.writeFile(queueFile, JSON.stringify({
        version: '1.0',
        updated_at: new Date().toISOString(),
        tasks: [
          { id: '1', priority: 'medium', status: 'pending' },
          { id: '2', priority: 'low', status: 'pending' },
          { id: '3', priority: 'medium', status: 'pending' },
          { id: '4', priority: 'low', status: 'completed' },
          { id: '5', priority: 'medium', status: 'pending' },
        ]
      }));

      const output = runStatusLine();

      expect(output).toContain('📋4');
    });

    it('should show 🚨N when queue has N critical tasks', async () => {
      await fs.writeFile(queueFile, JSON.stringify({
        version: '1.0',
        updated_at: new Date().toISOString(),
        tasks: [
          { id: '1', priority: 'critical', status: 'pending' },
          { id: '2', priority: 'critical', status: 'pending' },
          { id: '3', priority: 'high', status: 'pending' },
          { id: '4', priority: 'critical', status: 'pending' },
        ]
      }));

      const output = runStatusLine();

      expect(output).toContain('🚨3');
    });

    it('should not show queue count when no queue.json exists', async () => {
      // No queue file

      const output = runStatusLine();

      expect(output).not.toContain('📋');
      expect(output).not.toContain('🚨');
    });
  });

  describe('No Active Status', () => {
    it('should show model only when no workflow-state.json exists', async () => {
      // Don't create workflow-state.json

      const output = runStatusLine({ model: { display_name: 'Sonnet' } });

      expect(output).toContain('Sonnet');
      // Should not crash
      expect(output).toBeDefined();
    });

    it('should handle null phase gracefully', async () => {
      await fs.writeFile(workflowStateFile, JSON.stringify({
        tddPhase: null,
        progress: null,
        supervisor: null
      }));

      const output = runStatusLine();

      // Should not crash, should still show something
      expect(output).toBeDefined();
    });
  });
});
