#!/usr/bin/env node
/**
 * gate-run CLI: called by hooks/oss-gate-run.sh with the hook JSON on stdin (R-266, ADR-009).
 *
 * Usage:
 *   node gate-run.cjs subagent-start|subagent-stop|agent-post < hook.json
 *
 * Exit 0 with the check's stdout (empty, or one JSON line). Exit 1 for wrong usage, which the hook
 * wrapper turns into allow + log + tell. Ships only as the standalone bundle dist/cli/gate-run.cjs.
 */

import path from 'node:path';
import { runGateRun, type GateRunEvent } from '../gate-run/gate-run.js';

const EVENTS: readonly string[] = ['subagent-start', 'subagent-stop', 'agent-post'];

/** The plugin root when CLAUDE_PLUGIN_ROOT is missing: three folders above dist/cli (the cjs bundle). */
function ownPluginRoot(): string {
  return typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..', '..') : '';
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const event = process.argv[2] ?? '';
  if (!EVENTS.includes(event)) {
    process.stderr.write('Usage: gate-run subagent-start|subagent-stop|agent-post < hook.json\n', () => process.exit(1));
    return;
  }
  const result = await runGateRun({
    event: event as GateRunEvent,
    input: await readStdin(),
    env: {
      HOME: process.env.HOME ?? '',
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || ownPluginRoot(),
      CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
    },
  });
  process.stdout.write(result.stdout, () => process.exit(result.exitCode));
}

void main();
