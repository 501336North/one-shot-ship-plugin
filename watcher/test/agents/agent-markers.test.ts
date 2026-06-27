/**
 * @behavior Every routable OSS agent carries a stable, INERT routing marker in its prompt
 *           so the proxy can identify it (`OSS-ROUTE-AGENT: oss:<id>`). The marker must be
 *           an HTML comment — non-instructional metadata that cannot alter agent behavior,
 *           so users on solely Anthropic models are unaffected by its presence.
 * @acceptance-criteria
 *   - Every agent .md that carries the model-routing/offload block has exactly one marker.
 *   - The marker id is `oss:<file-basename>` (matches the models.agents config key form).
 *   - The marker is inside an HTML comment (inert).
 * @boundary Agent prompt contract (load-bearing for proxy routing)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsDir = path.resolve(__dirname, '../../../agents');

/** Routable = the agent prompt wires the model-routing/offload mechanism. */
function routableAgentFiles(): string[] {
  return fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => {
      const body = fs.readFileSync(path.join(agentsDir, f), 'utf8');
      return /agent-offload|agent-model-check|model-routing/.test(body);
    });
}

const MARKER_COMMENT_RE = /<!--\s*OSS-ROUTE-AGENT:\s*([A-Za-z0-9:_-]+)\s*-->/g;

describe('routable agents carry an inert OSS-ROUTE-AGENT marker', () => {
  const files = routableAgentFiles();

  it('finds the routable agent set', () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
  });

  for (const file of files) {
    const id = `oss:${file.replace(/\.md$/, '')}`;
    it(`${file} carries exactly one inert marker for ${id}`, () => {
      const body = fs.readFileSync(path.join(agentsDir, file), 'utf8');
      const matches = [...body.matchAll(MARKER_COMMENT_RE)];
      // exactly one marker, in HTML-comment (inert) form, with the oss:<basename> id
      expect(matches.length).toBe(1);
      expect(matches[0][1]).toBe(id);
    });
  }
});
