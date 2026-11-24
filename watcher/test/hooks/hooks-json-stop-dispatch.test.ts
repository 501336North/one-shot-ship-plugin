/**
 * @behavior When Claude tries to end a turn, the plugin's hooks.json (the file .claude-plugin/plugin.json
 *   loads) runs the R-257 Stop dispatcher, and only the dispatcher. The dispatcher blocks the stop while a
 *   started phase has no valid result, and otherwise runs the "Done" notification itself, so the
 *   notification is no longer registered on its own (it would run twice, or run on a blocked stop).
 * @business-rule R-257 US-004 (AC-004.1 to AC-004.3), ADR-1 "one Stop entry", DESIGN D9: the Stop entry
 *   is wired as a tracked task (T18) after R-266 merged. A block must be synchronous (never async), and a
 *   hung dispatcher must cost seconds, not Claude Code's 10 min default.
 * @boundary hooks.json at the repo root, as Claude Code reads it.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_JSON = path.join(__dirname, '../../../hooks.json');
const DISPATCHER = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-stop-dispatch.sh';
const NOTIFICATION = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-stop.sh';

/**
 * Why 15 s: the dispatcher's own bound on the node check is 5 s (_OSD_BOUND in oss-stop-dispatch.sh),
 * plus its bash fast path (git rev-parse, jq, git hash-object: well under 1 s) plus the notification it
 * runs afterwards (oss-stop.sh: one synchronous terminal-notifier or osascript call, the audio and sound
 * styles go to the background). 15 s leaves the dispatcher's 5 s bound, and its own fail-open markers,
 * to decide first, the same margin the tool gate's pre hook uses (4 s deadline, 15 s outer limit).
 */
const STOP_TIMEOUT_S = 15;

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

describe('hooks.json Stop entry (R-257 T18)', () => {
  it('should register exactly one Stop entry, the dispatcher, synchronous, with a 15 s timeout', () => {
    expect(readHooks().Stop).toEqual([
      { hooks: [{ type: 'command', command: DISPATCHER, timeout: STOP_TIMEOUT_S }] },
    ]);
  });

  it('should no longer register the notification (oss-stop.sh) directly under Stop', () => {
    const commands = (readHooks().Stop ?? []).flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).not.toContain(NOTIFICATION);
  });

  it('should not register the dispatcher under any other event (SubagentStop capture is T19)', () => {
    const elsewhere = Object.entries(readHooks())
      .filter(([event]) => event !== 'Stop')
      .flatMap(([event, entries]) =>
        entries.flatMap((e) => e.hooks.filter((h) => h.command.includes('oss-stop')).map(() => event)),
      );
    expect(elsewhere).toEqual([]);
  });
});
