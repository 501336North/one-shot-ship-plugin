/**
 * @behavior When a subagent stops, Claude Code also runs the verdict capture (R-257 T19), which records a review
 *   agent's own verdict block for ship. R-266's review-run check on the same event stays exactly as it was.
 * @business-rule DESIGN.md D9: "The `hooks.json` entries (Stop to the dispatcher, SubagentStop capture) are added on
 *   a rebase after R-266 merges, as a tracked task." The capture is additive, synchronous (the row must exist before
 *   the main agent's ship assemble reads it) and bounded (the hook's own 5 s bound sits under a 10 s outer limit).
 * @boundary hooks.json at the repo root, as Claude Code reads it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_JSON = path.join(__dirname, '../../../hooks.json');
const CAPTURE = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-verdict-capture.sh';
const GATE_RUN_STOP = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-gate-run.sh subagent-stop';
const GATE_RUN_START = '${CLAUDE_PLUGIN_ROOT}/hooks/oss-gate-run.sh subagent-start';

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

function readHooks(): Record<string, HookEntry[]> {
  return (JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8')) as { hooks: Record<string, HookEntry[]> }).hooks;
}

describe('hooks.json SubagentStop verdict capture (R-257 T19)', () => {
  it('should register the capture under SubagentStop as its own entry, synchronous, with a 10 s timeout', () => {
    const entries = (readHooks().SubagentStop ?? []).filter((e) => e.hooks.some((h) => h.command === CAPTURE));
    expect(entries).toEqual([{ hooks: [{ type: 'command', command: CAPTURE, timeout: 10 }] }]);
  });

  it("should keep R-266's gate-run SubagentStop entry first and unchanged", () => {
    expect(readHooks().SubagentStop?.[0]).toEqual({ hooks: [{ type: 'command', command: GATE_RUN_STOP, timeout: 10 }] });
  });

  // ⚠ changes existing test: D45 dead code — nothing reads the start snapshot since D45, so SubagentStart keeps only
  //   R-266's gate-run entry (it was "should keep R-266's gate-run SubagentStart entry first and unchanged").
  it("should leave SubagentStart to R-266's gate-run entry alone", () => {
    expect(readHooks().SubagentStart).toEqual([{ hooks: [{ type: 'command', command: GATE_RUN_START, timeout: 10 }] }]);
  });

  // ⚠ changes existing test: D45 dead code — the capture no longer runs at SubagentStart (start mode removed).
  it('should register the capture under no other event', () => {
    const elsewhere = Object.entries(readHooks())
      .filter(([event]) => event !== 'SubagentStop')
      .filter(([, entries]) => entries.some((e) => e.hooks.some((h) => h.command.includes('oss-verdict-capture'))))
      .map(([event]) => event);
    expect(elsewhere).toEqual([]);
  });
});
