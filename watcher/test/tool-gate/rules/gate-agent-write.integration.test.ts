/**
 * @behavior On a real disk, a review agent's write to a temp-looking path that is really a symlink
 *   into the repo is refused, by an edit tool and by a Bash redirect; its writes to a real
 *   `mktemp -d` folder outside the repo are allowed.
 * @business-rule R-266 AC-004.3 and AC-004.7: a link can't let a review agent change the repo it judges.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../../../src/tool-gate/command-reader.js';
import { realPathResolver } from '../../../src/tool-gate/path-resolver.js';
import { loadSettings } from '../../../src/tool-gate/rule-file.js';
import { checkGateAgentBash, checkGateAgentEdit } from '../../../src/tool-gate/rules/gate-agent-write.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REVIEWER = 'oss:code-reviewer';
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A repo with a `src` folder, a scratch folder outside it, and a link in the scratch folder into `src`. */
function setup() {
  const root = tempDir('oss-gate-agent-repo-');
  const home = tempDir('oss-gate-agent-home-');
  const scratch = tempDir('oss-offload.');
  fs.mkdirSync(path.join(root, 'src'));
  fs.symlinkSync(path.join(root, 'src'), path.join(scratch, 'link'));
  const settings = loadSettings(
    (p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null),
    PLUGIN_ROOT,
    root,
  ).settings;
  const checkEdit = (filePath: string) => checkGateAgentEdit({ filePath }, REVIEWER, settings, root, realPathResolver);
  const checkBash = (cmd: string) => {
    const facts = readCommand(cmd, root, home);
    if ('unreadable' in facts) throw new Error('expected a readable command');
    return facts.parts.map((part) => checkGateAgentBash(part, REVIEWER, settings, root, realPathResolver)).find((r) => r !== null) ?? null;
  };
  return { scratch, checkEdit, checkBash };
}

describe('gate-agent-write on a real disk', () => {
  it('should refuse a write through a temp folder link into the repo (AC-004.7)', () => {
    const { scratch, checkEdit, checkBash } = setup();

    expect(checkEdit(path.join(scratch, 'link', 'app.ts'))?.rule).toBe('gate-agent-write');
    expect(checkBash(`echo x > ${path.join(scratch, 'link', 'app.ts')}`)?.rule).toBe('gate-agent-write');
  });

  it('should allow writes in a real mktemp -d folder outside the repo (AC-004.3)', () => {
    const { scratch, checkEdit, checkBash } = setup();

    expect(checkEdit(path.join(scratch, 'prompt.md'))).toBeNull();
    expect(checkBash(`echo x > ${path.join(scratch, 'prompt.md')} && rm ${path.join(scratch, 'prompt.md')}`)).toBeNull();
  });
});
