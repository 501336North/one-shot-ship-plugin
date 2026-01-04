/**
 * Shared test utilities for safe cleanup
 * Handles race conditions in parallel test execution
 */

import * as fs from 'fs';

/**
 * Safely remove a directory with retry logic for race conditions
 * @param dir Directory to remove
 * @param retries Number of retry attempts (default 3)
 */
export function safeRmDir(dir: string, retries = 3): void {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    } catch (err) {
      if (i === retries - 1) {
        // Last retry, ignore error silently
        // Test cleanup failures shouldn't fail the test
      } else {
        // Brief wait before retry
        const waitMs = 50 * (i + 1);
        const start = Date.now();
        while (Date.now() - start < waitMs) {
          // Busy wait (sync sleep)
        }
      }
    }
  }
}

/**
 * Generate a unique test directory path
 * Includes timestamp and random suffix to avoid collisions
 */
export function uniqueTestDir(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `/tmp/${prefix}-${timestamp}-${random}`;
}
