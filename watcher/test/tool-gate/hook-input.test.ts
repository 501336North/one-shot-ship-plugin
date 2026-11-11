/**
 * Behavior: the tool gate knows which agent made a tool call. A subagent's call carries its name
 * in `agent_type` (plugin agents as `oss:<name>`, project agents as `<name>`); the main agent's
 * call carries none. Business rule: only the review agents named in the plugin's gateAgents list
 * (with or without one leading `oss:`) count as gate agents.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callingAgentOf } from '../../src/tool-gate/calling-agent.js';
import { isGateAgent } from '../../src/utils/gate-agents.js';
import { loadSettings } from '../../src/tool-gate/rule-file.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readFile = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const { gateAgents } = loadSettings(readFile, PLUGIN_ROOT, '/nonexistent-repo').settings;

describe('calling agent from hook input', () => {
  it('should read the calling agent name from agent_type', () => {
    expect(callingAgentOf({ agent_type: 'oss:code-reviewer', agent_id: 'a1' })).toBe('oss:code-reviewer');
  });

  it.each([
    ['missing', {}],
    ['empty', { agent_type: '' }],
    ['non-string', { agent_type: 42 }],
  ])('should treat a %s agent_type as the main agent', (_label, record) => {
    expect(callingAgentOf(record)).toBeUndefined();
  });
});

describe('gate agents', () => {
  it.each(['oss:code-reviewer', 'code-reviewer'])('should count %s as a gate agent', (name) => {
    expect(isGateAgent(name, gateAgents)).toBe(true);
  });

  it.each([
    ['a non-review plugin agent', 'oss:typescript-pro'],
    ['the main agent', undefined],
    ['an unknown agent', 'nobody'],
    ['a doubled oss: prefix', 'oss:oss:code-reviewer'],
    ['another plugin prefix', 'other:code-reviewer'],
  ])('should not count %s as a gate agent', (_label, name) => {
    expect(isGateAgent(name, gateAgents)).toBe(false);
  });
});
