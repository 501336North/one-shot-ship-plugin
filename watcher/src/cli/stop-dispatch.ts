#!/usr/bin/env node
/**
 * stop-dispatch CLI (R-257 T11, ADR-1): run by hooks/oss-stop-dispatch.sh as the bundle dist/cli/stop-dispatch.cjs.
 *
 * Usage: stop-dispatch --cwd <dir> [--project-dir <dir>] --session <id> --stop-hook-active <true|false>
 *
 * --project-dir is CLAUDE_PROJECT_DIR's repo: checked too, so a nested repo the model cd's into hides nothing.
 *
 * Prints the Stop hook JSON (`{"decision":"block","reason"}` and/or `{"systemMessage"}`) or nothing (allow), exit 0.
 * Wrong usage or an escaped error exits 2 with no stdout, so the shell takes its own fail-open path (markers +
 * systemMessage). The phase-result CLI it checks with is the sibling bundle dist/cli/phase-result.cjs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dispatch } from '../stop/dispatch.js';

function parse(argv: string[]): { cwd: string; projectDir?: string; session: string; active: boolean } | null {
  const m = new Map<string, string>();
  for (let i = 0; i + 1 < argv.length; i += 2) m.set(argv[i], argv[i + 1]);
  const cwd = m.get('--cwd');
  const active = m.get('--stop-hook-active');
  if (cwd === undefined || (active !== 'true' && active !== 'false')) return null;
  return { cwd, projectDir: m.get('--project-dir'), session: m.get('--session') ?? '', active: active === 'true' };
}

async function main(argv: string[]): Promise<number> {
  const a = parse(argv);
  if (a === null) {
    process.stderr.write('usage: stop-dispatch --cwd <dir> [--project-dir <dir>] --session <id> --stop-hook-active <true|false>\n');
    return 2;
  }
  const phaseResultCli = path.join(path.dirname(fs.realpathSync(process.argv[1] ?? '')), 'phase-result.cjs');
  const out = await dispatch({ cwd: a.cwd, projectDir: a.projectDir, sessionId: a.session, stopHookActive: a.active }, { phaseResultCli });
  if (out !== null) process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (rc) => {
    process.exitCode = rc;
  },
  () => {
    process.exitCode = 2;
  },
);
