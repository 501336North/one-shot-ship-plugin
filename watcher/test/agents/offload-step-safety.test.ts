/**
 * @behavior The "Local-Model Offload" step in every routable agent keeps the customer's secrets and
 *           our expert prompts off their disk and out of the chat (T71, pen-test M2).
 * @business-rule The step is decided by Step 0's result alone; it never sends the agent to the file
 *                that holds the API key. The prompt is written only into a private directory and is
 *                deleted before the offloader runs, so no path leaves it behind.
 * @business-rule All routable agents carry the same step, word for word, apart from their own id.
 * @boundary Agent .md prompt contract
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = join(__dirname, '..', '..', '..', 'agents');
const TOOL_GATES = join(__dirname, '..', '..', '..', 'config', 'tool-gates.json');

/** Review agents (R-266 gateAgents): their offloaded model has no edit tools (US-004). */
const gateAgents = new Set(
  (JSON.parse(readFileSync(TOOL_GATES, 'utf-8')) as { gateAgents: string[] }).gateAgents,
);

// The one sentence that differs: what the offloaded model may do with the repo.
const READ_ONLY =
  'it can read files in the current repo but has no edit tools, and\n   cannot run commands, use the web or use MCP tools.';
const READ_EDIT =
  'it can read and edit files in the current repo, but cannot run\n   commands, use the web or use MCP tools.';
const TOOLS_PLACEHOLDER = '<offload-tools>';

const offloadAgents = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith('.md'))
  .filter((f) => readFileSync(join(AGENTS_DIR, f), 'utf-8').includes('## Step 2.5'))
  .map((f) => f.replace(/\.md$/, ''));

/** The Step 2.5 section of an agent, up to the next step heading. */
function offloadStep(agent: string): string {
  const content = readFileSync(join(AGENTS_DIR, `${agent}.md`), 'utf-8');
  const start = content.indexOf('## Step 2.5');
  const end = content.indexOf('## Step 3', start);
  return content.slice(start, end === -1 ? undefined : end);
}

describe('Local-model offload step safety (T71)', () => {
  it('covers every agent that offloads', () => {
    expect(offloadAgents.length).toBe(14);
  });

  describe.each(offloadAgents)('%s.md', (agent) => {
    const step = offloadStep(agent);

    it('never points the agent at the config file that holds the API key', () => {
      expect(step).not.toContain('config.json');
    });

    it('decides from Step 0 only', () => {
      expect(step).toContain('USE_PROXY');
    });

    it('never writes the prompt to a shared temp path', () => {
      expect(step).not.toContain('/tmp/oss-offload');
      expect(step).not.toMatch(/mktemp\s+\/tmp/);
      expect(step).toContain('mktemp -d');
    });

    it('deletes the prompt and its directory before the offloader runs', () => {
      const rm = step.indexOf('rm -f -- "$PROMPT_FILE"');
      const rmdir = step.indexOf('rmdir -- "${PROMPT_FILE%/prompt.md}"');
      const run = step.indexOf('node "$OFFLOAD"');
      expect(rm).toBeGreaterThan(-1);
      expect(rmdir).toBeGreaterThan(rm);
      expect(run).toBeGreaterThan(rmdir);
      // The offloader reads the already-deleted file through stdin, opened before the delete.
      expect(step).toContain('} < "$PROMPT_FILE"');
      expect(step).toContain('--prompt-file /dev/stdin');
    });

    it('does not promise tools the offloaded session no longer has', () => {
      expect(step).not.toMatch(/full tools/i);
    });
  });

  it('tells review agents their offloaded model is read-only, and builders it can read and edit', () => {
    const reviewers = offloadAgents.filter((agent) => gateAgents.has(agent));
    expect(reviewers.length).toBeGreaterThan(0);
    for (const agent of offloadAgents) {
      const step = offloadStep(agent);
      if (gateAgents.has(agent)) {
        expect(step, agent).toContain(READ_ONLY);
        expect(step, agent).not.toContain(READ_EDIT);
      } else {
        expect(step, agent).toContain(READ_EDIT);
        expect(step, agent).not.toContain(READ_ONLY);
      }
    }
  });

  it('is identical across agents apart from the agent id and the read-only sentence', () => {
    const normalized = offloadAgents.map((agent) =>
      offloadStep(agent)
        .split(`oss:${agent}`)
        .join('oss:<agent>')
        .split(gateAgents.has(agent) ? READ_ONLY : READ_EDIT)
        .join(TOOLS_PLACEHOLDER),
    );
    for (const text of normalized) expect(text).toContain(TOOLS_PLACEHOLDER);
    for (const text of normalized) expect(text).toBe(normalized[0]);
  });
});
