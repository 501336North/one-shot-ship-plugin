#!/usr/bin/env node
/**
 * tool-gate CLI: called by hooks/oss-tool-gate.sh with the hook JSON on stdin.
 *
 * Usage:
 *   node tool-gate.cjs pre  < hook.json   # PreToolUse: allow (exit 0) or refuse (exit 2 + stderr)
 *   node tool-gate.cjs post < hook.json   # PostToolUse / PostToolUseFailure: record a test run
 *
 * Exit codes: 0 allow (stdout empty, or one allow-and-tell JSON line), 2 refuse, 1 wrong usage
 * (the hook wrapper turns any exit other than 0 or 2 into allow-and-tell).
 */

import { runToolGate, type GateResult } from '../tool-gate/gate.js';

const USAGE = 'Usage: tool-gate pre|post < hook.json\n';

export async function runCli(
  argv: readonly string[],
  input: string,
  env: Record<string, string | undefined>,
): Promise<GateResult> {
  const mode = argv[0];
  if (mode !== 'pre' && mode !== 'post') return { exitCode: 1, stdout: '', stderr: USAGE };
  return runToolGate({ mode, input, env: { HOME: env.HOME ?? '', CLAUDE_PLUGIN_ROOT: env.CLAUDE_PLUGIN_ROOT ?? '' } });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

/** Writes the answer, then exits once both streams have flushed (pipes are async on macOS). */
function answer(result: GateResult): void {
  process.stderr.write(result.stderr, () => {
    process.stdout.write(result.stdout, () => process.exit(result.exitCode));
  });
}

// Only run when executed directly (not imported by tests); .js (tsc) and .cjs (bundle).
if (/tool-gate\.(js|cjs)$/.test(process.argv[1] || '')) {
  readStdin()
    .then((input) => runCli(process.argv.slice(2), input, process.env))
    .then(answer, () => answer({ exitCode: 1, stdout: '', stderr: 'tool-gate: could not read the hook input\n' }));
}
