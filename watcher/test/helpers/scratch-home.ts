import fs from 'node:fs';
import path from 'node:path';

/**
 * Deletes `home/<parts>` only when `home` is the test run's own temp HOME (test/setup.ts names it
 * oss-test-home-*) and the path stays strictly inside it. Otherwise it throws and deletes nothing, so a test
 * whose setup failed (HOME still the developer's real home) can't remove the real ~/dev or ~/.ssh.
 */
export function removeInScratchHome(home: string, ...parts: string[]): void {
  if (!home || !path.basename(home).startsWith('oss-test-home-')) {
    throw new Error(`refusing to delete: ${JSON.stringify(home)} is not the test run's temp HOME`);
  }
  const base = path.resolve(home);
  const target = path.resolve(base, ...parts);
  if (!target.startsWith(base + path.sep)) {
    throw new Error(`refusing to delete: ${JSON.stringify(target)} is not inside the temp HOME`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}
