/**
 * @behavior WatcherSupervisor.sendNotification uses status line, not terminal-notifier
 * @acceptance-criteria No terminal-notifier fallback in supervisor notifications
 * @business-rule All runtime notifications must use status line
 * @boundary WatcherSupervisor
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

describe('WatcherSupervisor sendNotification', () => {
  /**
   * @behavior Source code must NOT contain terminal-notifier fallback in sendNotification
   */
  it('should not have terminal-notifier fallback in sendNotification method', () => {
    // Read the actual source file
    const indexPath = path.join(__dirname, '../src/index.ts');
    const sourceCode = readFileSync(indexPath, 'utf-8');

    // Find the sendNotification method (private method that handles notifications)
    // Look for lines between 'private sendNotification' and the closing brace
    const startMarker = 'private sendNotification(';
    const startIndex = sourceCode.indexOf(startMarker);

    expect(startIndex).toBeGreaterThan(-1);

    // Find the method body - count braces to find the end
    let braceCount = 0;
    let methodEnd = startIndex;
    let foundStart = false;

    for (let i = startIndex; i < sourceCode.length; i++) {
      if (sourceCode[i] === '{') {
        braceCount++;
        foundStart = true;
      } else if (sourceCode[i] === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
          methodEnd = i + 1;
          break;
        }
      }
    }

    const methodBody = sourceCode.slice(startIndex, methodEnd);

    // THEN: The sendNotification method should NOT contain terminal-notifier
    expect(methodBody).not.toContain('terminal-notifier');
  });

  /**
   * @behavior sendNotification method should exist
   */
  it('should have a sendNotification method', () => {
    const indexPath = path.join(__dirname, '../src/index.ts');
    const sourceCode = readFileSync(indexPath, 'utf-8');

    expect(sourceCode).toContain('private sendNotification(');
  });
});
