/**
 * Probe for setup-isolation.test.ts: when OSS_SETUP_PROBE_OUT is set, records
 * what a test sees of its environment after watcher/test/setup.ts has run.
 * Otherwise (a normal full-suite run) it does nothing.
 */
import { it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function ossDirReport(dir: string): { isDirectory: boolean; entries: string[] } | null {
  if (!fs.existsSync(dir)) return null;
  const isDirectory = fs.statSync(dir).isDirectory();
  return { isDirectory, entries: isDirectory ? fs.readdirSync(dir) : [] };
}

it('reports the environment a test sees', () => {
  const out = process.env.OSS_SETUP_PROBE_OUT;
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify({
        homedir: os.homedir(),
        HOME: process.env.HOME ?? null,
        CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null,
        CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ?? null,
        ossDir: ossDirReport(path.join(os.homedir(), '.oss')),
      })
    );
  }
  expect(true).toBe(true);
});
