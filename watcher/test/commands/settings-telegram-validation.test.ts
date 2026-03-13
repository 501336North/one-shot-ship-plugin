/**
 * @behavior /oss:settings should validate telegram setup before allowing selection
 * @acceptance-criteria Settings command must check telegram linking status via API
 * @business-rule Users cannot select telegram style without linking their account first
 * @boundary Command Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('/oss:settings Telegram Validation', () => {
  const settingsMdPath = path.resolve(__dirname, '../../../commands/settings.md');

  it('should warn about telegram requiring linking', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // Should mention that telegram requires linking via /oss:telegram link
    expect(content).toContain('/oss:telegram link');
  });

  it('should describe telegram option with linking requirement', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // The Telegram option description should mention it requires linking
    const hasTelegramConfig =
      content.includes('link account first') ||
      content.includes('link your') ||
      content.includes('/oss:telegram link');
    expect(hasTelegramConfig).toBe(true);
  });

  it('should have step to check telegram linking status', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // Should check if telegram is linked before allowing selection
    expect(content).toContain('TELEGRAM_LINKED');
  });

  it('should explain what happens if telegram not linked', () => {
    const content = fs.readFileSync(settingsMdPath, 'utf-8');
    // Should explain fallback when telegram not linked
    const hasExplanation =
      content.includes('not linked') ||
      content.includes('Not linked') ||
      content.includes('falling back');
    expect(hasExplanation).toBe(true);
  });
});
