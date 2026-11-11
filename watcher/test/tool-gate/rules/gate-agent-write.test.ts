/**
 * @behavior A review (gate) agent, named in gateAgents with or without one leading `oss:`, may not
 *   change the repo it judges: its Write, Edit, MultiEdit and NotebookEdit calls, and its Bash
 *   writes the command reader sees (a redirect, `tee`, `rm`, `mv`, `cp`, `sed -i`), are refused
 *   when they land inside the repo, also through a symlink or `..`. Writes outside the repo (the
 *   system temp folder, a `mktemp -d` folder) are allowed. Builders, the main agent and agents
 *   the gate doesn't know are never refused by this rule. The reason names the rule, says review
 *   agents review and report only, and that fixes go to the stack's builder agent.
 * @business-rule R-266 US-004 (AC-004.1 to AC-004.5, AC-004.7): a reviewer that fixes what it
 *   reviews is no longer an independent check.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../../../src/tool-gate/command-reader.js';
import { loadSettings, type GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { PathResolver } from '../../../src/tool-gate/path-resolver.js';
import { checkGateAgentBash, checkGateAgentEdit } from '../../../src/tool-gate/rules/gate-agent-write.js';

const ROOT = '/work/repo';
const HOME = '/home/dev';
const TMP = '/tmp';
const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The shipped base settings (config/tool-gates.json), with no repo file. */
const SETTINGS: GateSettings = loadSettings(
  (p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null),
  PLUGIN_ROOT,
  ROOT,
).settings;

/** A disk with symlinks only: a path under a link is resolved to the link's target. */
function linkedDisk(links: Record<string, string>): PathResolver {
  return {
    realpath(absPath: string): string {
      for (const [link, target] of Object.entries(links)) {
        if (absPath === link || absPath.startsWith(`${link}/`)) return target + absPath.slice(link.length);
      }
      return absPath;
    },
  };
}

const NO_LINKS = linkedDisk({});
const REVIEWER = 'oss:code-reviewer';

/** The agent making the call; `null` stands for the main agent, which has no name. */
type Caller = string | null;

function checkEdit(filePath: string, caller: Caller = REVIEWER, paths: PathResolver = NO_LINKS) {
  return checkGateAgentEdit({ filePath }, caller ?? undefined, SETTINGS, ROOT, paths);
}

function checkBash(cmd: string, caller: Caller = REVIEWER, paths: PathResolver = NO_LINKS) {
  const facts = readCommand(cmd, ROOT, HOME);
  if ('unreadable' in facts) throw new Error('expected a readable command');
  return facts.parts.map((part) => checkGateAgentBash(part, caller ?? undefined, SETTINGS, ROOT, paths)).find((r) => r !== null) ?? null;
}

describe('gate-agent-write: edit tools (AC-004.1)', () => {
  it.each(['oss:code-reviewer', 'code-reviewer', 'oss:security-auditor'])('should refuse %s writing a file inside the repo', (agent) => {
    const refusal = checkEdit(`${ROOT}/src/app.ts`, agent);

    expect(refusal?.rule).toBe('gate-agent-write');
  });

  it('should say the rule, that review agents review and report only, and that fixes go to a builder', () => {
    const reason = checkEdit(`${ROOT}/src/app.ts`)?.reason ?? '';

    expect(reason).toContain('gate-agent-write');
    expect(reason).toContain('review and report only');
    expect(reason).toContain('builder agent');
  });

  it('should refuse writing the repo folder itself', () => {
    expect(checkEdit(ROOT)?.rule).toBe('gate-agent-write');
  });
});

describe('gate-agent-write: Bash writes (AC-004.2)', () => {
  it.each([
    'echo x > notes.txt',
    'echo x >> src/app.ts',
    'echo x | tee src/app.ts',
    'rm src/app.ts',
    'rm -rf src',
    'mv src/a.ts src/b.ts',
    `cp ${TMP}/a.ts src/a.ts`,
    "sed -i '' s/a/b/ src/app.ts",
    'rm src/*.ts',
    'rm -rf ..',
    'rm -rf /work/*',
  ])('should refuse a review agent running `%s` in the repo', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it('should refuse a write whose folder the gate can only know when it runs', () => {
    expect(checkBash('echo x > "$OUT/f"')?.rule).toBe('gate-agent-write');
  });

  it('should allow a review agent reading the repo', () => {
    expect(checkBash('cat src/app.ts && grep -rn x src')).toBeNull();
  });
});

describe('gate-agent-write: outside the repo (AC-004.3)', () => {
  it('should allow writing the system temp folder', () => {
    expect(checkEdit(`${TMP}/review.md`)).toBeNull();
    expect(checkBash(`echo x > ${TMP}/review.md`)).toBeNull();
  });

  it('should allow writing a mktemp -d folder', () => {
    const scratch = '/var/folders/xy/T/oss-offload.Ab12Cd';
    expect(checkEdit(`${scratch}/prompt.md`)).toBeNull();
    expect(checkBash(`cd ${scratch} && echo x > prompt.md && rm prompt.md`)).toBeNull();
  });
});

describe('gate-agent-write: temp-looking paths that land in the repo (AC-004.7)', () => {
  const linkIntoRepo = linkedDisk({ [`${TMP}/scratch`]: `${ROOT}/src` });

  it('should refuse a temp path that is a symlink into the repo', () => {
    expect(checkEdit(`${TMP}/scratch/app.ts`, REVIEWER, linkIntoRepo)?.rule).toBe('gate-agent-write');
    expect(checkBash(`echo x > ${TMP}/scratch/app.ts`, REVIEWER, linkIntoRepo)?.rule).toBe('gate-agent-write');
  });

  it('should refuse a temp path that climbs into the repo with ..', () => {
    expect(checkEdit(`${TMP}/../work/repo/src/app.ts`)?.rule).toBe('gate-agent-write');
    expect(checkBash(`echo x > ${TMP}/../work/repo/src/app.ts`)?.rule).toBe('gate-agent-write');
  });
});

describe('gate-agent-write: other agents (AC-004.4, AC-004.5)', () => {
  it.each([
    ['a builder', 'oss:typescript-pro'],
    ['the main agent', null],
    ['an unknown agent', 'my-own-helper'],
    ['a doubled oss: prefix', 'oss:oss:code-reviewer'],
  ])('should never refuse %s', (_label, agent) => {
    expect(checkEdit(`${ROOT}/src/app.ts`, agent)).toBeNull();
    expect(checkBash('echo x > src/app.ts && rm -rf src', agent)).toBeNull();
  });
});
