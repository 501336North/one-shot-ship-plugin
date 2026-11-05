/**
 * /oss:models warns when the installed Claude Code is too old for model offload (Task 76b)
 *
 * @behavior A customer who mapped an agent (or the default) to a non-Claude model, and whose Claude Code does not
 *           know --restricted, sees one line in `/oss:models config` and `/oss:models list` telling them those
 *           agents run on Claude and how to update. Nobody else sees it, and a `claude` that is missing, fails or
 *           hangs never produces it (nor a hang).
 * @business-rule Offload needs `claude --restricted` (T76); an older CLI makes every mapped agent run on Claude.
 *           The customer keeps working on Claude, but is told.
 * @boundary CLI (executeModelsCommand in a child process with a temp HOME; `claude` is a stub on PATH, never the
 *           real one)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

const WARNING =
  'Model offload needs a newer Claude Code (update with: claude update); agents mapped to other models run on Claude until then.';

const HELP_OLD = `#!/bin/sh
echo run >> "$HOME/claude.ran"
echo "  --resume                Resume a conversation"
echo "  --restricted-tools      Not the flag"
`;
const HELP_NEW = `#!/bin/sh
echo run >> "$HOME/claude.ran"
echo "  --resume                Resume a conversation"
echo "  --restricted            Restricted mode"
`;
const FAILS = `#!/bin/sh
echo "boom" >&2
exit 2
`;
const HANGS = `#!/bin/sh
exec sleep 30
`;

const AGENT_MAPPED = { models: { agents: { 'oss:code-reviewer': 'ollama/qwen2.5-coder' } } };
const DEFAULT_MAPPED = { models: { default: 'openrouter/deepseek/deepseek-chat' } };

let work: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-models-warn-')));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/** Run `/oss:models <sub>` with this config and this `claude` (none: not on PATH); returns output and whether claude ran. */
function models(sub: string, config: object, claude: string | null): { out: string; ran: boolean } {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  fs.mkdirSync(path.join(home, '.oss'));
  fs.writeFileSync(path.join(home, '.oss', 'config.json'), JSON.stringify(config));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  if (claude !== null) fs.writeFileSync(path.join(bin, 'claude'), claude, { mode: 0o755 });
  const run = runInChild(
    `import { executeModelsCommand } from './cli/models.js';
     console.log(await executeModelsCommand([${JSON.stringify(sub)}]));`,
    { home, env: { PATH: `${bin}:/usr/bin:/bin` } },
  );
  expect(run.hung, 'the command hung').toBe(false);
  expect(run.status, run.stderr).toBe(0);
  return { out: run.stdout, ran: fs.existsSync(path.join(home, 'claude.ran')) };
}

const count = (out: string): number => out.split(WARNING).length - 1;

describe('/oss:models warns about a Claude Code too old for offload (Task 76b)', () => {
  it.each(['config', 'list'])('`%s` warns once when an agent is mapped and claude lacks --restricted', (sub) => {
    expect(count(models(sub, AGENT_MAPPED, HELP_OLD).out)).toBe(1);
  }, TEST_LIMIT_MS);

  it('warns when only the default is a non-Claude model', () => {
    expect(count(models('config', DEFAULT_MAPPED, HELP_OLD).out)).toBe(1);
  }, TEST_LIMIT_MS);

  it('does not warn when claude knows --restricted', () => {
    const r = models('config', AGENT_MAPPED, HELP_NEW);
    expect(r.ran).toBe(true);
    expect(count(r.out)).toBe(0);
  }, TEST_LIMIT_MS);

  it.each([
    ['nothing is mapped', {}],
    ['agents and the default are Claude', { models: { default: 'claude', agents: { 'oss:debugger': 'claude' } } }],
    ['only a command is mapped', { models: { commands: { 'oss:ship': 'gemini/gemini-2.0-flash' } } }],
  ])('does not warn, nor run claude, when %s', (_name, config) => {
    const r = models('config', config, HELP_OLD);
    expect(r.ran).toBe(false);
    expect(count(r.out)).toBe(0);
  }, TEST_LIMIT_MS);

  it.each([
    ['is not installed', null],
    ['fails', FAILS],
    ['hangs', HANGS],
  ])('does not warn when claude %s', (_name, claude) => {
    expect(count(models('config', AGENT_MAPPED, claude).out)).toBe(0);
  }, TEST_LIMIT_MS);
});
