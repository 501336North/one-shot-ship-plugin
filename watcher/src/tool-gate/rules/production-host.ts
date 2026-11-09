/**
 * Production-host rule (US-007): refuses a Bash call that talks to a host listed in
 * `productionHosts`. Entries are exact hostnames: no wildcards, and no suffix matching, so
 * `notapi.example.com` does not match `api.example.com`. Both sides are lowercased and lose
 * one trailing dot before comparing.
 */

import type { CommandPart } from '../command-reader.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';

function normalise(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

export function checkProductionHost(part: CommandPart, settings: GateSettings): Refusal | null {
  const listed = new Set(settings.productionHosts.map(normalise));
  const host = part.hosts.map(normalise).find((h) => listed.has(h));
  if (host === undefined) return null;
  return {
    rule: 'production-host',
    reason: `Refused: \`${part.program}\` to \`${host}\`, a production host listed in .oss/tool-gates.json. Use a staging or mock endpoint.`,
  };
}
