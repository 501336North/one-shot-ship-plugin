/**
 * @behavior The tool gate refuses any agent write to a protected path: the rule files, the
 *   gate's own state in `.oss/tool-gates/`, the OSS hook copies in `~/.oss/hooks/`, and the
 *   project's and the user's Claude settings and installed plugins. Edit, Write, MultiEdit and
 *   NotebookEdit are refused, and so is a Bash redirect, `rm`, `mv` or `cp` onto such a path, or
 *   removing a folder that holds one. The path is checked as written (after `~`, relative paths
 *   and `..` are resolved) and as it really is on disk (after following symlinks), so a link
 *   can't hide a protected file. Reading a protected file, and copying it elsewhere, is allowed.
 *   The reason names the path and tells the agent to ask the user, who can run it with `!`.
 * @business-rule US-006: an agent can't switch a law off by changing the gate's settings, its
 *   state, the hooks or Claude's settings.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import { readEditCall, type EditCall } from '../../../src/tool-gate/edit-call.js';
import { loadSettings, type GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { PathResolver } from '../../../src/tool-gate/path-resolver.js';
import { checkProtectedPathBash, checkProtectedPathEdit } from '../../../src/tool-gate/rules/protected-path.js';

const ROOT = '/work/repo';
const HOME = '/home/dev';
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

function editCall(tool: string, filePath: string, cwd = ROOT): EditCall {
  const inputs: Record<string, unknown> = {
    Edit: { file_path: filePath, old_string: 'a', new_string: 'b' },
    Write: { file_path: filePath, content: 'b' },
    MultiEdit: { file_path: filePath, edits: [{ old_string: 'a', new_string: 'b' }] },
    NotebookEdit: { notebook_path: filePath, new_source: 'b' },
  };
  const call = readEditCall(tool, inputs[tool], cwd, HOME, () => null);
  if (call === null) throw new Error('expected an edit call');
  return call;
}

function checkEdit(tool: string, filePath: string, paths: PathResolver = NO_LINKS, root = ROOT) {
  return checkProtectedPathEdit(editCall(tool, filePath, root), SETTINGS, root, HOME, paths);
}

function checkBash(cmd: string, paths: PathResolver = NO_LINKS) {
  const facts = readCommand(cmd, ROOT, HOME);
  if ('unreadable' in facts) throw new Error('expected a readable command');
  return facts.parts
    .map((part: CommandPart) => checkProtectedPathBash(part, SETTINGS, ROOT, HOME, paths))
    .find((refusal) => refusal !== null) ?? null;
}

const PROTECTED_FILES = [
  `${ROOT}/.oss/tool-gates.json`,
  `${ROOT}/.oss/tool-gates/cycle.json`,
  `${ROOT}/.oss/tool-gates/events.ndjson`,
  `${HOME}/.oss/hooks/x.sh`,
  `${ROOT}/.claude/settings.local.json`,
  `${HOME}/.claude/settings.json`,
  `${HOME}/.claude/plugins/cache/x/hooks.json`,
];

describe('protected-path rule: edit tools', () => {
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    for (const file of PROTECTED_FILES) {
      it(`should refuse ${tool} on ${file}`, () => {
        expect(checkEdit(tool, file)?.rule).toBe('protected-path');
      });
    }
  }

  it('should refuse a path that climbs back into a protected file with ..', () => {
    expect(checkEdit('Edit', `${ROOT}/sub/../.oss/tool-gates.json`)?.rule).toBe('protected-path');
  });

  it('should refuse a relative path from the repo root', () => {
    expect(checkEdit('Write', '.oss/tool-gates.json')?.rule).toBe('protected-path');
  });

  it('should refuse a ~ path to the user Claude settings', () => {
    expect(checkEdit('Edit', '~/.claude/settings.json')?.rule).toBe('protected-path');
  });

  it('should refuse a write through a symlinked folder that points into a protected folder', () => {
    const paths = linkedDisk({ [`${ROOT}/link`]: `${ROOT}/.oss/tool-gates` });
    expect(checkEdit('Write', 'link/x.json', paths)?.rule).toBe('protected-path');
  });

  it('should refuse a file outside the repo that is a symlink to the user Claude settings', () => {
    const paths = linkedDisk({ '/tmp/evil.json': `${HOME}/.claude/settings.json` });
    expect(checkEdit('Write', '/tmp/evil.json', paths)?.rule).toBe('protected-path');
  });

  it('should refuse a protected file in a repo reached through a symlinked folder', () => {
    const paths = linkedDisk({ '/var/w': '/private/var/w' });
    const refusal = checkEdit('Edit', '/private/var/w/repo/.oss/tool-gates.json', paths, '/var/w/repo');
    expect(refusal?.rule).toBe('protected-path');
  });

  for (const file of [
    'src/app.ts',
    '.oss/dev/active/x/PROGRESS.md',
    '.claude/agents/foo.md',
    `${HOME}/.claude/projects/x/memory/a.md`,
  ]) {
    it(`should allow editing the ordinary file ${file}`, () => {
      expect(checkEdit('Edit', file)).toBeNull();
    });
  }

  it('should name the file relative to the repo and say to ask the user', () => {
    expect(checkEdit('Edit', `${ROOT}/.oss/tool-gates.json`)?.reason).toBe(
      'Refused: writes `.oss/tool-gates.json`, a protected file. Ask the user to change it with `!`.',
    );
  });

  it('should name a file in the home folder with ~', () => {
    expect(checkEdit('Write', `${HOME}/.claude/settings.json`)?.reason).toBe(
      'Refused: writes `~/.claude/settings.json`, a protected file. Ask the user to change it with `!`.',
    );
  });
});

describe('protected-path rule: Bash', () => {
  for (const cmd of [
    'echo x > .oss/tool-gates.json',
    'echo x >> .oss/tool-gates/cycle.json',
    'cat <<EOF > .oss/tool-gates.json\n{"version": 1}\nEOF',
    'rm ~/.oss/hooks/x.sh',
    'rm -rf .oss/tool-gates',
    'rm -rf .oss',
    'rm -rf ~/.claude',
    'mv .oss/tool-gates.json x',
    'mv x .oss/tool-gates.json',
    'cp x ~/.claude/settings.json',
    'cd sub && echo x > ../.claude/settings.local.json',
  ]) {
    it(`should refuse: ${cmd.split('\n')[0]}`, () => {
      expect(checkBash(cmd)?.rule).toBe('protected-path');
    });
  }

  it('should refuse a redirect through a symlinked folder that points into a protected folder', () => {
    const paths = linkedDisk({ [`${ROOT}/link`]: `${ROOT}/.oss/tool-gates` });
    expect(checkBash('echo x > link/cycle.json', paths)?.rule).toBe('protected-path');
  });

  for (const cmd of [
    'cat .oss/tool-gates.json',
    'cp .oss/tool-gates.json /tmp/x',
    'echo x > src/app.ts',
    'rm -rf .oss/dev/active/x',
    'echo x > ~/.claude/projects/x/memory/a.md',
  ]) {
    it(`should allow: ${cmd}`, () => {
      expect(checkBash(cmd)).toBeNull();
    });
  }

  it('should name the protected path and say to ask the user', () => {
    expect(checkBash('rm ~/.oss/hooks/x.sh')?.reason).toBe(
      'Refused: writes `~/.oss/hooks/x.sh`, a protected file. Ask the user to change it with `!`.',
    );
  });

  it('should say a removed folder holds protected files', () => {
    expect(checkBash('rm -rf .oss')?.reason).toBe(
      'Refused: writes `.oss`, which holds protected files. Ask the user to change it with `!`.',
    );
  });
});

describe('protected-path rule: path display', () => {
  it('should show a path outside the repo and home in full', () => {
    const paths = linkedDisk({ '/tmp/evil.json': `${HOME}/.claude/settings.json` });
    expect(checkEdit('Write', '/tmp/evil.json', paths)?.reason).toContain('`/tmp/evil.json`');
  });

  it('should show a relative path for files under the repo even when the repo sits in home', () => {
    const root = `${HOME}/repo`;
    expect(checkEdit('Edit', `${root}/.oss/tool-gates.json`, NO_LINKS, root)?.reason).toContain(
      '`.oss/tool-gates.json`',
    );
  });
});

describe('protected-path rule: .. after a symlinked folder', () => {
  // `link` → `.oss/tool-gates`, so on disk `link/../tool-gates.json` is `.oss/tool-gates.json`.
  const throughLink: PathResolver = {
    realpath: (p) => (p === `${ROOT}/link/../tool-gates.json` ? `${ROOT}/.oss/tool-gates.json` : p),
  };

  for (const tool of ['Edit', 'Write']) {
    it(`should refuse ${tool} on link/../tool-gates.json when the disk puts it at a protected file`, () => {
      expect(checkEdit(tool, 'link/../tool-gates.json', throughLink)?.rule).toBe('protected-path');
    });
  }

  it('should refuse a redirect to link/../tool-gates.json when the disk puts it at a protected file', () => {
    expect(checkBash('echo x > link/../tool-gates.json', throughLink)?.rule).toBe('protected-path');
  });

  it('should name the path as the agent wrote it', () => {
    expect(checkEdit('Write', 'link/../tool-gates.json', throughLink)?.reason).toContain('`link/../tool-gates.json`');
  });

  it('should allow an ordinary path that climbs with .. to an ordinary file', () => {
    expect(checkEdit('Edit', 'sub/../src/app.ts')).toBeNull();
    expect(checkBash('echo x > sub/../src/app.ts')).toBeNull();
  });
});

describe('protected-path rule: Bash programs that write in place', () => {
  for (const cmd of [
    "sed -i 's/x/y/' .claude/settings.local.json",
    'tee ~/.claude/settings.json',
    'echo x | sudo tee -a .oss/tool-gates.json',
    'git checkout -- .oss/tool-gates.json',
  ]) {
    it(`should refuse: ${cmd}`, () => {
      expect(checkBash(cmd)?.rule).toBe('protected-path');
    });
  }

  it('should allow sed -i on an ordinary source file', () => {
    expect(checkBash('sed -i s/a/b/ src/app.ts')).toBeNull();
  });
});
