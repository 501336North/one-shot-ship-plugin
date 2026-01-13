/**
 * @behavior /oss:settings should validate telegram setup before allowing selection
 * @acceptance-criteria Settings command must check telegram credentials exist
 * @business-rule Users cannot select telegram style without proper configuration
 * @boundary Command Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('/oss:settings Telegram Validation', () => {
  const settingsMdPath = path.resolve(__dirname, '../../../commands/settings.md');

  it('should warn about telegram requiring setup', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // Should mention that telegram requires setup
    expect(content).toContain('/oss:telegram setup');
  });

  it('should describe telegram option with setup requirement', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // The Telegram option description should mention it requires configuration
    const hasTelegramConfig =
      content.includes('requires setup') ||
      content.includes('Requires /oss:telegram') ||
      content.includes('run /oss:telegram');
    expect(hasTelegramConfig).toBe(true);
  });

  it('should have step to check telegram configuration', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // Should check if telegram.botToken exists before allowing selection
    expect(content).toContain('telegram.botToken');
  });

  it('should explain what happens if telegram not configured', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // Should explain fallback or error when telegram not configured
    const hasExplanation =
      content.includes('not configured') ||
      content.includes('Not Configured') ||
      content.includes('NOT_CONFIGURED');
    expect(hasExplanation).toBe(true);
  });
});
