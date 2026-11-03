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
    expect(offloadAgents.length).toBe(13);
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

  it('is identical across agents apart from the agent id', () => {
    const normalized = offloadAgents.map((agent) => offloadStep(agent).split(`oss:${agent}`).join('oss:<agent>'));
    for (const text of normalized) expect(text).toBe(normalized[0]);
  });
});
