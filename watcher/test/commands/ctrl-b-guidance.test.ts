/**
 * @behavior Long-running commands should have Ctrl+B backgrounding guidance
 * @acceptance-criteria Task 1.4 - Background Task Documentation
 * @business-rule Users should know they can background long operations
 * @boundary Command Documentation
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Ctrl+B Background Task Guidance', () => {
  const commandsDir = path.resolve(__dirname, '../../../commands');

  // Commands that typically run long and should have Ctrl+B guidance
  const longRunningCommands = [
    'test.md',
    'build.md',
    'load.md',
    'bench.md',
  ];

  describe('Long-running Commands', () => {
    longRunningCommands.forEach((commandFile) => {
      it(`${commandFile} should have Ctrl+B backgrounding guidance`, () => {
        const filePath = path.join(commandsDir, commandFile);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Should mention Ctrl+B for backgrounding
        const hasCtrlBGuidance =
          content.includes('Ctrl+B') ||
          content.includes('Ctrl-B') ||
          content.includes('background');

        expect(hasCtrlBGuidance).toBe(true);
      });
    });
  });

  describe('Guidance Format', () => {
    it('build.md should have a dedicated backgrounding section or tip', () => {
      const filePath = path.join(commandsDir, 'build.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should have clear guidance about backgrounding long builds
      const hasBackgroundSection =
        content.includes('Background') ||
        content.includes('long-running') ||
        content.includes('Long-Running');

      expect(hasBackgroundSection).toBe(true);
    });
  });
});
