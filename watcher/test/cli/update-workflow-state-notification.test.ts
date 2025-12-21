/**
 * CLI tests for notification commands
 *
 * @behavior CLI accepts setNotification and clearNotification commands
 * @acceptance-criteria AC-CLI-NOTIFY.1 through AC-CLI-NOTIFY.4
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

describe('CLI Notification Commands', () => {
  let tempDir: string;
  let stateFilePath: string;
  let cliPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-cli-notify-test-'));
    const ossDir = path.join(tempDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
    stateFilePath = path.join(ossDir, 'workflow-state.json');
    cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * @behavior setNotification command sets notification with default TTL
   * @acceptance-criteria AC-CLI-NOTIFY.1
   */
  test('setNotification sets notification with default TTL', async () => {
    const beforeSet = Date.now();

    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" init`);
    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" setNotification "Context restored"`);

    const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    expect(state.notification).toBeDefined();
    expect(state.notification.message).toBe('Context restored');

    // Expiry should be ~10s from now
    const expiresAt = new Date(state.notification.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(beforeSet + 9000);
    expect(expiresAt).toBeLessThan(beforeSet + 11000);
  });

  /**
   * @behavior setNotification command accepts custom TTL
   * @acceptance-criteria AC-CLI-NOTIFY.2
   */
  test('setNotification accepts custom TTL', async () => {
    const beforeSet = Date.now();

    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" init`);
    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" setNotification "Quick message" 5`);

    const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    const expiresAt = new Date(state.notification.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(beforeSet + 4000);
    expect(expiresAt).toBeLessThan(beforeSet + 6000);
  });

  /**
   * @behavior clearNotification command removes notification
   * @acceptance-criteria AC-CLI-NOTIFY.3
   */
  test('clearNotification removes notification', async () => {
    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" init`);
    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" setNotification "Temporary"`);

    // Verify notification was set
    let state = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    expect(state.notification).toBeDefined();

    // Clear it
    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" clearNotification`);

    state = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    expect(state.notification).toBeUndefined();
  });

  /**
   * @behavior setNotification outputs confirmation message
   * @acceptance-criteria AC-CLI-NOTIFY.4
   */
  test('setNotification outputs confirmation', async () => {
    await execAsync(`node "${cliPath}" --project-dir "${tempDir}" init`);
    const { stdout } = await execAsync(
      `node "${cliPath}" --project-dir "${tempDir}" setNotification "Test message"`
    );

    expect(stdout).toContain('Notification set');
    expect(stdout).toContain('Test message');
  });
});
