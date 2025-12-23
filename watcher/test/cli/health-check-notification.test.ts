/**
 * @behavior health-check sendNotification uses status line, not terminal-notifier
 * @acceptance-criteria No terminal-notifier fallback in health check notifications
 * @business-rule All health check notifications use status line
 * @boundary cli/health-check
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

describe('health-check sendNotification', () => {
  /**
   * @behavior Source code must NOT contain terminal-notifier fallback in sendNotification
   */
  it('should not have terminal-notifier fallback in sendNotification function', () => {
    // Read the actual source file
    const healthCheckPath = path.join(__dirname, '../../src/cli/health-check.ts');
    const sourceCode = readFileSync(healthCheckPath, 'utf-8');

    // Find the sendNotification function
    const startMarker = 'function sendNotification(';
    const startIndex = sourceCode.indexOf(startMarker);

    expect(startIndex).toBeGreaterThan(-1);

    // Find the function body - count braces to find the end
    let braceCount = 0;
    let funcEnd = startIndex;
    let foundStart = false;

    for (let i = startIndex; i < sourceCode.length; i++) {
      if (sourceCode[i] === '{') {
        braceCount++;
        foundStart = true;
      } else if (sourceCode[i] === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
          funcEnd = i + 1;
          break;
        }
      }
    }

    const funcBody = sourceCode.slice(startIndex, funcEnd);

    // THEN: The sendNotification function should NOT contain terminal-notifier
    expect(funcBody).not.toContain('terminal-notifier');
  });

  /**
   * @behavior sendNotification function should exist
   */
  it('should have a sendNotification function', () => {
    const healthCheckPath = path.join(__dirname, '../../src/cli/health-check.ts');
    const sourceCode = readFileSync(healthCheckPath, 'utf-8');

    expect(sourceCode).toContain('function sendNotification(');
  });
});
