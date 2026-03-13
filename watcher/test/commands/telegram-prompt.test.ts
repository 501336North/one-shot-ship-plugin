/**
 * @behavior /oss:telegram command prompt provides documentation for Telegram notifications
 * @acceptance-criteria Command prompt exists and documents all subcommands
 * @business-rule Users should understand how to configure Telegram notifications
 * @boundary CLI command (telegram)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('telegram.md command prompt', () => {
  const commandPath = path.join(__dirname, '../../../commands/telegram.md');

  it('should exist in commands directory', () => {
    expect(fs.existsSync(commandPath)).toBe(true);
  });

  it('should have correct frontmatter', () => {
    const content = fs.readFileSync(commandPath, 'utf-8');
    // Command uses filename-based naming (telegram.md -> /oss:telegram)
    // No explicit name: field needed - plugin namespace handles it
    expect(content).toContain('description:');
  });

  it('should document all subcommands', () => {
    const content = fs.readFileSync(commandPath, 'utf-8');
    expect(content).toContain('/oss:telegram on');
    expect(content).toContain('/oss:telegram off');
    expect(content).toContain('/oss:telegram link');
  });

  it('should include magic link setup instructions', () => {
    const content = fs.readFileSync(commandPath, 'utf-8');
    expect(content).toContain('magic link');
    expect(content).toContain('OSSDevWorkflowBot');
  });

  it('should reference API endpoints for implementation', () => {
    const content = fs.readFileSync(commandPath, 'utf-8');
    expect(content).toContain('telegram/status');
    expect(content).toContain('telegram/link');
    expect(content).toContain('telegram/notifications');
  });
});
