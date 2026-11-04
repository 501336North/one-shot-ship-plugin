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

  it('GIVEN a Claude Code without --restricted, WHEN offloading, THEN nothing runs unconfined and the agent falls back to native Claude', async () => {
    installClaude(OLD_CLI);

    const result = await runAgentOffload({ agent: 'oss:code-reviewer', promptFile: '/unused' }, deps());

    expect(result.offloaded).toBe(false);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('spawn_error');
    expect(result.output).toBeUndefined();
  });
});
