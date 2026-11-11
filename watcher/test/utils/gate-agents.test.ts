/**
 * @behavior The offloader learns which agents are review agents from the plugin's config/tool-gates.json
 *           gateAgents, plus any names a repo's .oss/tool-gates.json adds. A repo file can only add names:
 *           a missing, broken or wrongly shaped repo file is ignored. A missing or broken plugin list throws,
 *           so the caller can fail closed. (Task 13)
 * @business-rule A review agent must not edit what it judges; the plugin's list is the single source of
 *           who reviews, and a repo may widen it but never shrink it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readGateAgents } from '../../src/utils/gate-agents';

let plugin: string;
let repo: string;

const write = (root: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const base = (agents: unknown): void => write(plugin, 'config/tool-gates.json', JSON.stringify({ version: 1, gateAgents: agents }));
const repoFile = (text: string): void => write(repo, '.oss/tool-gates.json', text);

beforeEach(() => {
  plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-agents-plugin-'));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-agents-repo-'));
});
afterEach(() => {
  fs.rmSync(plugin, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('readGateAgents', () => {
  it('reads the plugin list when the repo has no file', () => {
    base(['code-reviewer', 'security-auditor']);
    expect(readGateAgents(plugin, repo)).toEqual(['code-reviewer', 'security-auditor']);
  });

  it('adds the names a repo file lists, keeping every plugin name', () => {
    base(['code-reviewer']);
    repoFile(JSON.stringify({ version: 1, gateAgents: ['code-reviewer', 'docs-architect'] }));
    expect(readGateAgents(plugin, repo)).toEqual(['code-reviewer', 'docs-architect']);
  });

  it('a repo file cannot remove a plugin name', () => {
    base(['code-reviewer', 'security-auditor']);
    repoFile(JSON.stringify({ version: 1, gateAgents: [] }));
    expect(readGateAgents(plugin, repo)).toEqual(['code-reviewer', 'security-auditor']);
  });

  it.each(['not json', JSON.stringify({ gateAgents: 'code-reviewer' }), JSON.stringify({ gateAgents: [1, ''] }), '[]'])(
    'ignores a broken repo file: %s',
    (text) => {
      base(['code-reviewer']);
      repoFile(text);
      expect(readGateAgents(plugin, repo)).toEqual(['code-reviewer']);
    },
  );

  it('throws when the plugin file is missing', () => {
    expect(() => readGateAgents(plugin, repo)).toThrow();
  });

  it.each([undefined, 'code-reviewer', ['code-reviewer', ''], [3]])('throws when the plugin list is %j', (agents) => {
    base(agents);
    expect(() => readGateAgents(plugin, repo)).toThrow();
  });
});
