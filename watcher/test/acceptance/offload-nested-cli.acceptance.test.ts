/**
 * @behavior The offload runner starts a real `claude` process confined to the repo, and when the
 *           installed Claude Code is too old to confine it, the agent runs on native Claude instead.
 * @acceptance-criteria AC-OFFLOAD.8 (T76, security N1/N2)
 * @boundary CLI (watcher/src/cli/agent-offload.ts, real child process; `claude` is a fake on PATH)
 * @user-story As an OSS user who mapped an agent to a local model, repo files that try to
 *             prompt-inject that model cannot make it read my OSS key or files outside the repo,
 *             and an older Claude Code never runs it unconfined.
 *
 * Only the routing lookup, proxy probe and prompt read are stubbed. The nested session is a
 * real spawn of a fake `claude` script that records the argv it gets (one per line).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runAgentOffload, type OffloadDeps } from '../../src/cli/agent-offload';
import type { CheckResult } from '../../src/cli/agent-model-check';

const ROUTED: CheckResult = {
  useProxy: true,
  model: 'ollama/gpt-oss:120b',
  provider: 'ollama',
  proxyUrl: 'http://127.0.0.1:3456',
};

/** A current CLI: records argv and stdin, answers like the local model. */
const CURRENT_CLI = `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done > "$FAKE_CLAUDE_ARGV"
cat > "$FAKE_CLAUDE_ARGV.stdin"
echo "findings from the local model"
`;

/** An older CLI: rejects an option it does not know, as commander does (exit 1). */
const OLD_CLI = `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "--restricted" ]; then echo "error: unknown option '--restricted'" >&2; exit 1; fi
done
echo "ran unconfined"
`;

describe('Offload nested session against a real claude process (Acceptance)', () => {
  let root: string;
  let prevPath: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-offload-cli-'));
    fs.mkdirSync(path.join(root, 'bin'));
    prevPath = process.env.PATH;
    process.env.PATH = `${path.join(root, 'bin')}:${prevPath ?? '/usr/bin:/bin'}`;
    process.env.FAKE_CLAUDE_ARGV = path.join(root, 'argv.txt');
  });

  afterEach(() => {
    process.env.PATH = prevPath;
    delete process.env.FAKE_CLAUDE_ARGV;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const installClaude = (script: string): void => {
    fs.writeFileSync(path.join(root, 'bin', 'claude'), script, { mode: 0o755 });
  };

  const deps = (): OffloadDeps => ({
    checkAgentModel: async () => ROUTED,
    isProxyReachable: async () => true,
    readPrompt: () => 'EXPERT PROMPT + TASK CONTEXT',
  });

  it('GIVEN a current Claude Code, WHEN offloading, THEN the session is restricted, kept out of .oss, and gets the prompt on stdin', async () => {
    installClaude(CURRENT_CLI);

    const result = await runAgentOffload({ agent: 'oss:code-reviewer', promptFile: '/unused' }, deps());

    expect(result).toEqual({ offloaded: true, output: 'findings from the local model\n' });
    const argv = fs.readFileSync(path.join(root, 'argv.txt'), 'utf8').trim().split('\n');
    expect(argv).toEqual([
      '-p',
      '--tools', 'Read,Grep,Glob,Edit,Write',
      '--permission-mode', 'acceptEdits',
      '--restricted',
      '--strict-mcp-config',
      '--disallowedTools', 'Read(./.oss/**)', 'Edit(./.oss/**)',
    ]);
    expect(fs.readFileSync(path.join(root, 'argv.txt.stdin'), 'utf8')).toBe('EXPERT PROMPT + TASK CONTEXT');
  });

  /**
   * @behavior A customer on a Claude Code too old for --restricted is told, in one line, that the agent ran on
   *           Claude instead of their model and how to fix it. (T76b)
   * @business-rule Keep running on Claude (never unconfined), but never drop the customer's model choice silently.
   */
  it('GIVEN a Claude Code without --restricted, WHEN offloading, THEN nothing runs unconfined, the agent falls back to native Claude, and the customer is told why', async () => {
    installClaude(OLD_CLI);

    const result = await runAgentOffload({ agent: 'oss:code-reviewer', promptFile: '/unused' }, deps());

    expect(result.offloaded).toBe(false);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('cli_too_old');
    expect(result.output).toBeUndefined();
    expect(result.notice).toBe(
      'Model offload needs a newer Claude Code (update with: claude update); this agent ran on Claude instead of ollama/gpt-oss:120b.',
    );
  });

  it.each([
    ['another unknown option', "error: unknown option '--restricted-mode'"],
    ['a flag mentioned in some other error', 'error: --restricted cannot be used with --resume'],
    ['an API failure', 'API Error: connection refused'],
  ])('GIVEN the nested CLI fails with %s, WHEN offloading, THEN it stays a spawn_error with no notice', async (_name, err) => {
    installClaude(`#!/bin/sh\necho "${err}" >&2\nexit 1\n`);

    const result = await runAgentOffload({ agent: 'oss:code-reviewer', promptFile: '/unused' }, deps());

    expect(result).toMatchObject({ offloaded: false, fallback: true, reason: 'spawn_error' });
    expect(result.notice).toBeUndefined();
  });

  it('GIVEN a model name with control characters or great length, WHEN the notice names it, THEN it is one bounded printable line', async () => {
    installClaude(OLD_CLI);
    const model = `ollama/evil\n\u001b[31mFAKE PROMPT\r${'x'.repeat(500)}`;

    const result = await runAgentOffload(
      { agent: 'oss:code-reviewer', promptFile: '/unused' },
      { ...deps(), checkAgentModel: async () => ({ ...ROUTED, model }) },
    );

    expect(result.reason).toBe('cli_too_old');
    const notice = result.notice ?? '';
    expect(notice.startsWith('Model offload needs a newer Claude Code (update with: claude update); this agent ran on Claude instead of ollama/evil')).toBe(true);
    expect(notice).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(notice.length).toBeLessThan(200);
    expect(notice.endsWith('.')).toBe(true);
  });
});
