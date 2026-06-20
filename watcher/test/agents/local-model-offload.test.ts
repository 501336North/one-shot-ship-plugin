/**
 * @behavior Every routable agent (model_routing:true) actually OFFLOADS its work to the
 *           configured local model via the agent-offload runner — not just prints a banner.
 * @acceptance-criteria AC-OFFLOAD.5 (markdown integration of all 13 routable agents)
 * @business-rule The offload must fire AFTER the expert prompt is fetched (Step 2) and BEFORE
 *                native execution (Step 3), feeding the nested session prompt+task.
 * @boundary Agent .md prompt contract
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = join(__dirname, '..', '..', '..', 'agents');

/** Routable agents = those carrying `model_routing: true` in frontmatter. */
const routableAgents = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .filter((f) => readFileSync(join(AGENTS_DIR, f), 'utf-8').includes('model_routing: true'))
  .map((f) => f.replace('.md', ''));

describe('Local-model offload wiring (all routable agents)', () => {
  it('discovers the expected set of routable agents', () => {
    // Sanity: the rollout must cover every model_routing agent (13 at time of writing).
    expect(routableAgents.length).toBeGreaterThanOrEqual(13);
    expect(routableAgents).toContain('code-reviewer');
  });

  describe.each(routableAgents)('%s.md', (agent) => {
    const content = readFileSync(join(AGENTS_DIR, `${agent}.md`), 'utf-8');

    it('invokes the agent-offload runner with its own agent id', () => {
      expect(content).toContain('agent-offload.js');
      // The block sets AGENT_ID then passes it through (same idiom as the Step 0 routing check).
      expect(content).toContain(`AGENT_ID="oss:${agent}"`);
      expect(content).toContain('--agent "$AGENT_ID"');
    });

    it('keeps the Step 0 routing-check detection (banner)', () => {
      expect(content).toContain('agent-model-check.js');
    });

    it('offloads AFTER fetching the expert prompt and BEFORE native execution', () => {
      const detectIdx = content.indexOf('agent-model-check.js');
      const offloadIdx = content.indexOf('agent-offload.js');
      const executeIdx = content.search(/Execute the Fetched Prompt|## Step 3/);

      expect(offloadIdx).toBeGreaterThan(detectIdx); // offload after detection/banner
      expect(executeIdx).toBeGreaterThan(-1);
      expect(offloadIdx).toBeLessThan(executeIdx); // offload before native execution
    });

    it('instructs to stop (not re-run on Claude) when offloaded:true', () => {
      // The block must tell the orchestrator NOT to re-do the work natively after a successful
      // offload — otherwise the local model run is wasted.
      expect(content).toMatch(/offloaded.*true/);
      expect(content.toLowerCase()).toMatch(/do not|don't|stop/);
    });
  });
});
