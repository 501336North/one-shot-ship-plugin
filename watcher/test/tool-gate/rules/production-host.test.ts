/**
 * @behavior When a repo lists production hosts, the tool gate refuses an agent's shell call that
 *   talks to one of them: by URL (any case, any port), as `user@host`, or as a bare host word,
 *   also when wrapped in `sudo` or run through `bash -c`. The reason names the program and the
 *   host. Hosts that are not listed, or that only share a suffix with a listed host, are allowed,
 *   and so is a commit message that merely mentions a listed host. With the default empty list
 *   nothing is refused.
 * @business-rule US-007: gate and performance agents never hit production. Matching is on the
 *   exact hostname, so a look-alike host is neither refused nor able to slip past.
 */

import { describe, it, expect } from 'vitest';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import type { GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { Refusal } from '../../../src/tool-gate/rules/refusal.js';
import { checkProductionHost } from '../../../src/tool-gate/rules/production-host.js';

const CWD = '/work/repo';
const HOME = '/home/dev';

function settings(productionHosts: string[]): GateSettings {
  return {
    version: 1,
    protectedBranches: ['main', 'master'],
    testFilePatterns: [],
    testCommandPatterns: [],
    sourceExtensions: [],
    protectedPaths: [],
    productionHosts,
    gateAgents: [],
    tagsAllowed: true,
  };
}

const LISTED = settings(['api.example.com']);

function partsOf(cmd: string): CommandPart[] {
  const result = readCommand(cmd, CWD, HOME);
  if ('unreadable' in result) throw new Error(`expected a readable command: ${result.reason}`);
  return result.parts;
}

function check(cmd: string, gateSettings: GateSettings = LISTED): Refusal | null {
  return partsOf(cmd).map((part) => checkProductionHost(part, gateSettings)).find((r) => r !== null) ?? null;
}

describe('production-host rule: calls to a listed production host', () => {
  it('should refuse curl https://api.example.com/x when listed, naming the host', () => {
    expect(check('curl https://api.example.com/x')).toEqual({
      rule: 'production-host',
      reason:
        'Refused: `curl` to `api.example.com`, a production host listed in .oss/tool-gates.json. Use a staging or mock endpoint.',
    });
  });

  it.each([
    'wget http://API.example.com:8443/p',
    'ssh deploy@api.example.com',
    'http POST api.example.com/x',
    'sudo curl https://api.example.com/x',
    "bash -c 'curl https://api.example.com'",
    'curl https://api.example.com./x',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('production-host');
  });

  it('should match a listed entry written in uppercase with a trailing dot', () => {
    expect(check('curl https://api.example.com/x', settings(['API.Example.com.']))?.rule).toBe('production-host');
  });
});

describe('production-host rule: hosts that are not listed', () => {
  it('should allow an unlisted host and a host that only shares a suffix (notapi.example.com)', () => {
    expect(check('curl https://api.staging.example.com/x')).toBeNull();
    expect(check('curl https://notapi.example.com/x')).toBeNull();
    expect(check('curl https://api.example.com.evil.net/x')).toBeNull();
  });

  it('should allow a commit message that only mentions a listed host', () => {
    expect(check('git commit -m "fix api.example.com timeout"')).toBeNull();
  });

  it('should refuse nothing with the default empty list', () => {
    expect(check('curl https://api.example.com/x', settings([]))).toBeNull();
  });
});
