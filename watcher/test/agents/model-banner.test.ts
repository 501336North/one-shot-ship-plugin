import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * @behavior Every routable agent surfaces its model in its output
 * @user-story As an OSS user (terminal OR VS Code OR web), I want each routed agent to print which
 *             model it is running on, so model routing is never invisible.
 */

const AGENTS_DIR = join(__dirname, '..', '..', '..', 'agents');

function routableAgents(): string[] {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => readFileSync(join(AGENTS_DIR, f), 'utf-8').includes('model_routing: true'));
}

describe('Routed-agent model banner (acceptance)', () => {
  it('finds the routable agents', () => {
    expect(routableAgents().length).toBeGreaterThanOrEqual(13);
  });

  it.each(routableAgents())(
    '%s reads .banner from the routing check and echoes it at the top of output',
    (file) => {
      const content = readFileSync(join(AGENTS_DIR, file), 'utf-8');
      // Reads the banner the agent-model-check CLI emits...
      expect(content).toMatch(/jq -r '\.banner/);
      // ...and prints it (when non-empty)...
      expect(content).toContain('echo "$BANNER"');
      // ...UNCONDITIONALLY — i.e. the echo comes BEFORE the routed-only `if USE_PROXY` block,
      // so native (default-Claude) agents surface their model too, not only routed ones.
      const echoIdx = content.indexOf('echo "$BANNER"');
      const proxyIfIdx = content.indexOf('if [[ "$USE_PROXY" == "true" ]]');
      expect(echoIdx).toBeGreaterThan(-1);
      expect(proxyIfIdx).toBeGreaterThan(-1);
      expect(echoIdx).toBeLessThan(proxyIfIdx);
    }
  );
});
