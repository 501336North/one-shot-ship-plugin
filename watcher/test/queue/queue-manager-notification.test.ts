/**
 * @behavior QueueManager.sendDebugNotification uses status line, not terminal-notifier
 * @acceptance-criteria No terminal-notifier fallback in queue notifications
 * @business-rule All queue notifications use status line
 * @boundary QueueManager
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

describe('QueueManager sendDebugNotification', () => {
  /**
   * @behavior Source code must NOT contain terminal-notifier fallback in sendDebugNotification
   */
  it('should not have terminal-notifier fallback in sendDebugNotification method', () => {
    // Read the actual source file
    const managerPath = path.join(__dirname, '../../src/queue/manager.ts');
    const sourceCode = readFileSync(managerPath, 'utf-8');

    // Find the sendDebugNotification method
    const startMarker = 'private sendDebugNotification(';
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

    // THEN: The sendDebugNotification method should NOT contain terminal-notifier
    expect(methodBody).not.toContain('terminal-notifier');
  });

  /**
   * @behavior sendDebugNotification method should exist
   */
  it('should have a sendDebugNotification method', () => {
    const managerPath = path.join(__dirname, '../../src/queue/manager.ts');
    const sourceCode = readFileSync(managerPath, 'utf-8');

    expect(sourceCode).toContain('private sendDebugNotification(');
  });
});
