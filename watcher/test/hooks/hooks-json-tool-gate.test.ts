/**
 * @behavior The plugin's hooks.json (the file .claude-plugin/plugin.json loads) sends every Bash, edit,
 *   Read, Grep and Glob call through the tool gate before it runs (15 s outer time limit), and every
 *   finished Bash call (success or failure) through it afterwards (5 s). The hooks that were already
 *   registered keep working exactly as before.
 * @business-rule The tool gate only enforces anything when Claude Code calls it; a hung gate must
 *   cost seconds, not the 10 min default. Adding the gate must not change any other hook.
 * @boundary hooks.json at the repo root, as Claude Code reads it.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_JSON = path.join(__dirname, '../../../hooks.json');
const GATE = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-tool-gate.sh';
const GATE_RUN = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-gate-run.sh';

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
  async?: boolean;
}
interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}
type HookMap = Record<string, HookEntry[]>;

function readHooks(): HookMap {
  return (JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8')) as { hooks: HookMap }).hooks;
}

function isGateEntry(entry: HookEntry): boolean {
  return entry.hooks.some((h) => h.command.startsWith(GATE));
}

/** R-266 (US-005, US-008): the entries that record a review agent's run for the gate. */
function isGateRunEntry(entry: HookEntry): boolean {
  return entry.hooks.some((h) => h.command.startsWith(GATE_RUN));
}

/** R-266 (security C1): SessionStart records the node the gate hooks run (~/.oss/node-path). */
function isNodePathEntry(entry: HookEntry): boolean {
  return entry.hooks.some((h) => h.command === '${CLAUDE_PLUGIN_ROOT}/hooks/oss-node-path.sh');
}

const command = (script: string): HookEntry => ({
  hooks: [{ type: 'command', command: `\${CLAUDE_PLUGIN_ROOT}/hooks/${script}` }],
});

// Every entry registered before the tool gate, as it was.
const EXISTING: HookMap = {
  UserPromptSubmit: [command('oss-precommand.sh'), command('oss-iron-law-check.sh'), command('oss-context-inject.sh')],
  SessionStart: [command('oss-session-start.sh')],
  PreCompact: [command('oss-session-end.sh')],
  SessionEnd: [command('oss-session-end.sh')],
  Notification: [command('oss-notification.sh')],
  // R-257 T18 (DESIGN D9): the Stop dispatcher replaces oss-stop.sh and runs the notification itself.
  // Its timeout is explained in hooks-json-stop-dispatch.test.ts.
  Stop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/oss-stop-dispatch.sh', timeout: 15 }] }],
  WorktreeCreate: [command('oss-worktree-create.sh')],
  WorktreeRemove: [command('oss-worktree-remove.sh')],
  ConfigChange: [command('oss-config-change.sh')],
  PostToolUse: [
    {
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/oss-decision-record.sh', async: true }],
    },
    {
      matcher: 'Agent|Task',
      hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/oss-timeline.sh', async: true }],
    },
  ],
  // R-257 T19 (DESIGN D9): the SubagentStop verdict capture, additive to the gate-run entry above.
  // Its timeout is explained in hooks-json-verdict-capture.test.ts.
  SubagentStop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/oss-verdict-capture.sh', timeout: 10 }] }],
  // ⚠ changes existing test: D45 dead code — the capture's SubagentStart start snapshot entry is gone (nothing reads it).
};

describe('hooks.json tool-gate entries', () => {
  /**
   * Round 9: @behavior Read, Grep and Glob go through the gate too (D-R9-2: a review agent can't read
   * credential files with them), and the pre hook's outer limit is 15 s, so the hook's own 4 s
   * deadline, counted from its start, always decides first (SEC LOW-1).
   * @business-rule a timed-out pre call is refused by the gate, never let through by Claude Code's
   * own hook timeout.
   */
  it('should register PreToolUse Bash|Edit|Write|MultiEdit|NotebookEdit|Monitor|Read|Grep|Glob → oss-tool-gate.sh pre (Monitor is refused for review agents) with a 15 s timeout, and PostToolUse / PostToolUseFailure Bash → post, with a timeout', () => {
    const hooks = readHooks();
    const gateEntries = (event: string): HookEntry[] => (hooks[event] ?? []).filter(isGateEntry);

    expect(gateEntries('PreToolUse')).toEqual([
      { matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit|Monitor|Read|Grep|Glob', hooks: [{ type: 'command', command: `${GATE} pre`, timeout: 15 }] },
    ]);
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      expect(gateEntries(event), event).toEqual([
        { matcher: 'Bash', hooks: [{ type: 'command', command: `${GATE} post`, timeout: 5 }] },
      ]);
    }
  });

  it('should register SubagentStart, SubagentStop, PostToolUse Agent|Task (agent-post) and PostToolUse for every tool (main-post) → oss-gate-run.sh with its event, a 10 s timeout and not async', () => {
    const hooks = readHooks();
    const gateRunEntries: HookMap = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const kept = entries.filter(isGateRunEntry);
      if (kept.length > 0) gateRunEntries[event] = kept;
    }
    expect(gateRunEntries).toEqual({
      PostToolUse: [
        { matcher: 'Agent|Task', hooks: [{ type: 'command', command: `${GATE_RUN} agent-post`, timeout: 10 }] },
        { hooks: [{ type: 'command', command: `${GATE_RUN} main-post`, timeout: 10 }] },
      ],
      SubagentStart: [{ hooks: [{ type: 'command', command: `${GATE_RUN} subagent-start`, timeout: 10 }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: `${GATE_RUN} subagent-stop`, timeout: 10 }] }],
    });
  });

  it('should record the node the gate hooks run at SessionStart, once, with a short timeout', () => {
    const entries = (readHooks().SessionStart ?? []).filter(isNodePathEntry);
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks[0].timeout).toBe(5);
  });

  it('should keep every existing hooks.json entry unchanged', () => {
    const withoutGate: HookMap = {};
    for (const [event, entries] of Object.entries(readHooks())) {
      const kept = entries.filter((e) => !isGateEntry(e) && !isGateRunEntry(e) && !isNodePathEntry(e));
      if (kept.length > 0) withoutGate[event] = kept;
    }
    expect(withoutGate).toEqual(EXISTING);
  });
});
