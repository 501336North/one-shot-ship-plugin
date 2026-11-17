/**
 * @behavior Pure helpers of the agent-offload runner: invocation building + result classifying.
 * @boundary CLI (unit)
 *
 * These document the contracts the acceptance test relies on. The end-to-end behaviour of
 * runAgentOffload is covered by
 *   test/acceptance/interactive-local-model-offload.acceptance.test.ts
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type * as childProcess from 'child_process';
import {
  buildOffloadInvocation,
  classifyResult,
  parseOffloadArgs,
  runAgentOffload,
  type OffloadDeps,
} from '../../src/cli/agent-offload';
import type { CheckResult } from '../../src/cli/agent-model-check';

const ROUTED: CheckResult = {
  useProxy: true,
  model: 'ollama/gpt-oss:120b',
  provider: 'ollama',
  proxyUrl: 'http://127.0.0.1:3456',
};

describe('buildOffloadInvocation', () => {
  it('targets the local model through the proxy and sets the recursion guard', () => {
    const inv = buildOffloadInvocation(ROUTED);
    expect(inv.cmd).toBe('claude');
    expect(inv.args[0]).toBe('-p');
    // Must NOT pass a foreign --model — the Claude CLI rejects unknown model ids client-side.
    expect(inv.args).not.toContain('--model');
    // The base URL is the actual offload lever; the guard prevents nested re-offload.
    expect(inv.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3456');
    expect(inv.env.OSS_OFFLOAD_ACTIVE).toBe('1');
  });

  /**
   * @behavior The offloaded agent may read and edit files in the repo, but it cannot run commands,
   *           use the web or MCP tools, and nothing the repo ships can widen that. (T71)
   * @business-rule A local model reading repo files can be prompt-injected by them, so the nested
   *                session never skips permission checks.
   */
  it('never skips permission checks: file tools only, edits only inside the repo', () => {
    const { args } = buildOffloadInvocation(ROUTED);
    const valueOf = (flag: string): string | undefined => args[args.indexOf(flag) + 1];

    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--allow-dangerously-skip-permissions');
    expect(args).not.toContain('bypassPermissions');
    // Only the file tools exist in the nested session: no Bash, no web, no sub-agents.
    expect(valueOf('--tools')).toBe('Read,Grep,Glob,Edit,Write');
    // Edits inside the working directory are accepted; anything else would need a prompt, and
    // a `-p` run has nobody to answer one, so it is refused.
    expect(valueOf('--permission-mode')).toBe('acceptEdits');
    // No MCP servers are loaded.
    expect(args).toContain('--strict-mcp-config');
  });

  /**
   * @behavior The offloaded agent cannot read or change files outside the repo, or the OSS config
   *           copy a worktree keeps in .oss/, even when the user's own Claude settings allow broad
   *           reads. (T76, security N1/N2)
   * @business-rule Repo content may prompt-inject the local model, so no settings file may widen
   *                what it can reach, and the OSS key never enters its context.
   */
  it('is confined to the repo and kept out of .oss, whatever the user settings allow', () => {
    const { args } = buildOffloadInvocation(ROUTED);

    // --restricted ignores every settings file (user ones included) and confines the file tools
    // to the working directory; loading user settings would bring back their allow rules.
    expect(args).toContain('--restricted');
    expect(args).not.toContain('--setting-sources');
    // The worktree's .oss/config.json copy holds the key: reads and edits there are denied
    // (Edit, since the CLI ignores Write(path) deny rules). The flag takes several values, so
    // it comes last and nothing after it is read as a rule.
    const deny = args.indexOf('--disallowedTools');
    expect(deny).toBeGreaterThan(-1);
    expect(args.slice(deny + 1)).toEqual(['Read(./.oss/**)', 'Edit(./.oss/**)']);
  });

  it('does not leak ANTHROPIC_MODEL into the nested session', () => {
    // The runner is spawned from inside a Claude Code session that may export an exotic model id
    // (e.g. claude-opus-4-8[1m]); the nested `claude -p` would reject it client-side. Clear it so
    // the nested session uses a clean default — the proxy force-selects the real local model anyway.
    const prev = process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8[1m]';
    try {
      const inv = buildOffloadInvocation(ROUTED);
      expect(inv.env.ANTHROPIC_MODEL).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = prev;
    }
  });

  it('does not leak the real Anthropic credentials into the nested session', () => {
    // The nested session talks only to the local proxy (which ignores auth) — it must not carry
    // the parent's real ANTHROPIC_API_KEY / AUTH_TOKEN to a localhost listener / redirected endpoint.
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevTok = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-REAL-secret-value';
    process.env.ANTHROPIC_AUTH_TOKEN = 'oauth-real-token';
    try {
      const inv = buildOffloadInvocation(ROUTED);
      expect(inv.env.ANTHROPIC_API_KEY).not.toBe('sk-ant-REAL-secret-value');
      expect(inv.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevTok === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = prevTok;
    }
  });
});

/** Runs the offloader with a fake nested session and returns the args it was started with. */
async function spawnedArgs(agent: string, extra: OffloadDeps = {}): Promise<string[]> {
  let captured: string[] = [];
  const spawnFn = ((_cmd: string, args: readonly string[]) => {
    captured = [...args];
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: (): boolean => true, end: (): void => undefined },
    });
    setImmediate(() => {
      child.stdout.emit('data', 'review done');
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof childProcess.spawn;
  await runAgentOffload(
    { agent, promptFile: '/unused' },
    {
      checkAgentModel: async () => ROUTED,
      isProxyReachable: async () => true,
      readPrompt: () => 'task',
      spawnFn,
      ...extra,
    },
  );
  return captured;
}

const denied = (args: string[]): string[] => args.slice(args.indexOf('--disallowedTools') + 1);

/**
 * @behavior A review agent whose work is offloaded to a local model cannot change the repo it
 *           judges: the nested session has no edit tools. Builders keep theirs. (Task 13)
 * @business-rule A review must not alter the code under review; the review agents are the
 *                plugin's gateAgents list, the single source of who reviews.
 */
describe('offloaded review agents stay read-only', () => {
  it.each(['oss:code-reviewer', 'code-reviewer', 'oss:security-auditor', 'oss:penetration-tester', 'oss:performance-auditor'])(
    '%s gets no edit tools',
    async (agent) => {
      const args = await spawnedArgs(agent);
      expect(denied(args)).toEqual(['Read(./.oss/**)', 'Edit(./.oss/**)', 'Edit', 'Write', 'NotebookEdit']);
      expect(args).not.toContain('MultiEdit');
    },
  );

  it('a builder agent keeps its edit tools', async () => {
    const args = await spawnedArgs('oss:typescript-pro');
    expect(denied(args)).toEqual(['Read(./.oss/**)', 'Edit(./.oss/**)']);
    expect(args).not.toContain('MultiEdit');
  });

  it('when the review list cannot be read, every offload is read-only (fails closed)', async () => {
    const args = await spawnedArgs('oss:typescript-pro', {
      readGateAgents: () => {
        throw new Error('config missing');
      },
    });
    expect(denied(args)).toEqual(['Read(./.oss/**)', 'Edit(./.oss/**)', 'Edit', 'Write', 'NotebookEdit']);
    expect(args).not.toContain('MultiEdit');
  });
});

describe('classifyResult', () => {
  it('non-zero exit ⇒ spawn_error', () => {
    expect(classifyResult(1, 'whatever')).toBe('spawn_error');
  });
  it('exit 0 but empty/whitespace stdout ⇒ empty_output (gpt-oss tiny-budget guard)', () => {
    expect(classifyResult(0, '   \n')).toBe('empty_output');
  });
  it('exit 0 with content ⇒ success', () => {
    expect(classifyResult(0, 'CRITICAL: bug')).toBe('success');
  });
});

describe('parseOffloadArgs', () => {
  it('parses --agent / --prompt-file / --project-dir', () => {
    const p = parseOffloadArgs(['--agent', 'oss:code-reviewer', '--prompt-file', '/tmp/p.txt', '--project-dir', '/repo']);
    expect(p).toEqual({ agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt', projectDir: '/repo' });
  });
});
