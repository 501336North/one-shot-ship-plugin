/**
 * @behavior The launcher/proxy runtime needs Node new enough for the dist's web-streams + ESM.
 *           The floor is Node 20 (LTS) — the dist uses Readable.fromWeb + web ReadableStream +
 *           fetch. A missing or too-old Node must be reported so the launcher can warn LOUDLY
 *           (never a silent all-cloud degrade).
 * @acceptance-criteria
 *   - default floor is 20: v18 → not ok, v20 → ok.
 *   - missing version → not ok, with an actionable message.
 *   - an explicit minMajor override is still honored.
 * @boundary Pure version check (no process probing)
 */
import { describe, it, expect } from 'vitest';
import { checkNode, decidePreflight } from '../../src/services/node-guard.js';

describe('checkNode: Node version preflight (default floor 20)', () => {
  it('rejects Node 18 by default (floor is now 20)', () => {
    const r = checkNode('v18.20.0');
    expect(r.ok).toBe(false);
    expect(r.major).toBe(18);
    expect(r.message).toMatch(/20/);
  });

  it('accepts Node 20 and 22 by default', () => {
    expect(checkNode('v20.0.0').ok).toBe(true);
    expect(checkNode('v22.11.0').ok).toBe(true);
  });

  it('rejects a missing Node with an actionable message', () => {
    const r = checkNode(undefined);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found/i);
    expect(r.message).toMatch(/20/);
  });

  it('rejects an unparseable version string', () => {
    expect(checkNode('garbage').ok).toBe(false);
  });

  it('still honors an explicit minMajor override', () => {
    expect(checkNode('v18.0.0', 18).ok).toBe(true);
    expect(checkNode('v18.0.0', 22).ok).toBe(false);
  });
});

describe('decidePreflight: route-or-warn decision', () => {
  it('routing configured + Node bad → do NOT route, loud all-cloud banner', () => {
    const d = decidePreflight({ nodeCheck: checkNode(undefined), routingConfigured: true });
    expect(d.route).toBe(false);
    expect(d.banner).toBeTruthy();
    expect(d.banner).toMatch(/all-cloud/i);
    expect(d.banner).toMatch(/not found/i); // carries the underlying node-check reason
  });

  it('routing configured + Node ok → route, no banner', () => {
    const d = decidePreflight({ nodeCheck: checkNode('v20.0.0'), routingConfigured: true });
    expect(d.route).toBe(true);
    expect(d.banner).toBeUndefined();
  });

  it('routing NOT configured → always route, no banner (no-impact guarantee, even if Node is bad)', () => {
    const d = decidePreflight({ nodeCheck: checkNode(undefined), routingConfigured: false });
    expect(d.route).toBe(true);
    expect(d.banner).toBeUndefined();
  });
});
