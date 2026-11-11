/**
 * @behavior The plugin's hooks.json (the file .claude-plugin/plugin.json loads) sends every Bash and
 *   edit call through the tool gate before it runs, and every finished Bash call (success or
 *   failure) through it afterwards, each with a 5 s outer time limit. The hooks that were already
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
  Stop: [command('oss-stop.sh')],
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
};

describe('hooks.json tool-gate entries', () => {
  it('should register PreToolUse Bash|Edit|Write|MultiEdit|NotebookEdit → oss-tool-gate.sh pre, and PostToolUse / PostToolUseFailure Bash → post, with a timeout', () => {
    const hooks = readHooks();
    const gateEntries = (event: string): HookEntry[] => (hooks[event] ?? []).filter(isGateEntry);

    expect(gateEntries('PreToolUse')).toEqual([
      { matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: `${GATE} pre`, timeout: 5 }] },
    ]);
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      expect(gateEntries(event), event).toEqual([
        { matcher: 'Bash', hooks: [{ type: 'command', command: `${GATE} post`, timeout: 5 }] },
      ]);
    }
  });

  it('should register SubagentStart, SubagentStop and PostToolUse Agent|Task → oss-gate-run.sh with its event, a 10 s timeout and not async', () => {
    const hooks = readHooks();
    const gateRunEntries: HookMap = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const kept = entries.filter(isGateRunEntry);
      if (kept.length > 0) gateRunEntries[event] = kept;
    }
    expect(gateRunEntries).toEqual({
      PostToolUse: [
        { matcher: 'Agent|Task', hooks: [{ type: 'command', command: `${GATE_RUN} agent-post`, timeout: 10 }] },
      ],
      SubagentStart: [{ hooks: [{ type: 'command', command: `${GATE_RUN} subagent-start`, timeout: 10 }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: `${GATE_RUN} subagent-stop`, timeout: 10 }] }],
    });
  });

  it('should keep every existing hooks.json entry unchanged', () => {
    const withoutGate: HookMap = {};
    for (const [event, entries] of Object.entries(readHooks())) {
      const kept = entries.filter((e) => !isGateEntry(e) && !isGateRunEntry(e));
      if (kept.length > 0) withoutGate[event] = kept;
    }
    expect(withoutGate).toEqual(EXISTING);
  });
});
