/**
 * Gate-run check (R-266, US-008, ADR-007, ADR-009): a review (gate) agent's run is checked for any
 * repo change. Called by hooks/oss-gate-run.sh (through dist/cli/gate-run.cjs) with the hook JSON:
 *   subagent-start  SubagentStart: snapshot the repo for a gate agent; says nothing.
 *   subagent-stop   SubagentStop: compare; a change voids the review and the user is told
 *                   (`systemMessage`), since a background run has no `Agent` result to carry it.
 *   agent-post      the `Agent` PostToolUse: a void kept for `tool_response.agentId` is told to the
 *                   main agent (`additionalContext`), once.
 * Always exit 0. Any error: allow, log one `gate-error` line in the tool gate's event log, tell.
 *
 * The repo is CLAUDE_PROJECT_DIR when it is an existing absolute folder, else the repo holding the
 * hook's `cwd` (git finds its top), as the tool gate does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileStateStore } from '../tool-gate/state-store.js';
import { readGateAgents } from '../utils/gate-agents.js';
import { compareOnStop, takePendingVoid, voidMessage } from './compare.js';
import { git, snapshotOnStart } from './snapshot.js';

export type GateRunEvent = 'subagent-start' | 'subagent-stop' | 'agent-post';

export interface GateRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GateRunRequest {
  event: GateRunEvent;
  input: string;
  env: { HOME: string; CLAUDE_PLUGIN_ROOT: string; CLAUDE_PROJECT_DIR?: string };
}

/** What the user is told when the check itself fails: the review stands, but unverified. */
export const CHECK_FAILED =
  'OSS review check could not run, so this review run is unverified: the repo may have changed while it ran.';

const SILENT: GateRunResult = { exitCode: 0, stdout: '', stderr: '' };

function say(output: object): GateRunResult {
  return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: '' };
}

/** The folder to check: CLAUDE_PROJECT_DIR when it is an existing absolute folder, else the hook's cwd. */
function folderOf(projectDir: string | undefined, cwd: unknown): string {
  const usable =
    projectDir !== undefined &&
    path.isAbsolute(projectDir) &&
    fs.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory() === true;
  return usable ? projectDir : String(cwd);
}

/** Logs `gate-error` in the repo's tool-gate event log where it can (best effort). */
function logError(folder: string): void {
  try {
    const top = git(folder, ['rev-parse', '--show-toplevel']);
    fileStateStore(top).appendEvent({ ts: new Date().toISOString(), tool: 'gate-run', kind: 'gate-error', result: 'allowed' });
  } catch {
    // Nowhere to log: the user is still told.
  }
}

function check(req: GateRunRequest, hook: Record<string, unknown>, folder: string): GateRunResult {
  const input = { ...hook, cwd: folder };
  switch (req.event) {
    case 'subagent-start': {
      // An unreadable gate list fails open (allow + tell) rather than snapshotting every subagent
      // run: a snapshot per builder run would cost every session, and the user is told either way.
      const gateAgents = readGateAgents(req.env.CLAUDE_PLUGIN_ROOT, git(folder, ['rev-parse', '--show-toplevel']));
      snapshotOnStart(input, gateAgents);
      return SILENT;
    }
    case 'subagent-stop': {
      const result = compareOnStop(input);
      if (result.kind === 'error') throw new Error(result.error);
      return result.kind === 'void' ? say({ systemMessage: voidMessage(result.files) }) : SILENT;
    }
    case 'agent-post': {
      const files = takePendingVoid(input);
      if (files === null) return SILENT;
      return say({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: voidMessage(files) } });
    }
  }
}

export async function runGateRun(req: GateRunRequest): Promise<GateRunResult> {
  let folder = '';
  try {
    const hook = JSON.parse(req.input) as Record<string, unknown>;
    folder = folderOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    return check(req, hook, folder);
  } catch {
    if (folder !== '') logError(folder);
    return say({ systemMessage: CHECK_FAILED });
  }
}
