/**
 * @behavior The tool gate refuses a Bash command that names a protected path (the rule files,
 *   the gate's state, the OSS hooks, Claude's settings and plugins) or a folder holding one,
 *   unless the program only reads (`cat`, `ls`, `grep`, `git status` …). This catches writes the
 *   redirect and `rm`/`mv`/`cp` checks can't list: `ln`, `rsync`, `tar -C`, `curl -o`,
 *   `git rm`, `mkfifo`, and interpreter scripts (`python3 -c`, `node -e` …) whose string literals
 *   name a protected path, even one built from `$HOME`. Running a hook script (`bash
 *   ~/.oss/hooks/x.sh`, `source …`) is not a write and stays allowed, and so does a word whose
 *   value is only known when it runs, unless its known start is already inside a protected folder.
 * @business-rule US-006: an agent can't switch a law off by changing the gate's settings, its
 *   state, the hooks or Claude's settings, whatever program it uses to write them.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import { loadSettings, type GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { PathResolver } from '../../../src/tool-gate/path-resolver.js';
import { checkCallSize, checkProtectedPathMention } from '../../../src/tool-gate/rules/protected-path-mention.js';
import { withDeadline } from '../../../src/tool-gate/deadline.js';
import { OverBudget } from '../../../src/tool-gate/budget.js';

const ROOT = '/work/repo';
const HOME = '/home/dev';
const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The shipped base settings (config/tool-gates.json), with no repo file. */
const SETTINGS: GateSettings = loadSettings(
  (p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null),
  PLUGIN_ROOT,
  ROOT,
).settings;

const NO_LINKS: PathResolver = { realpath: (p) => p };

function check(cmd: string, caseInsensitive = false) {
  const facts = readCommand(cmd, ROOT, HOME);
  if ('unreadable' in facts) throw new Error(`expected a readable command: ${facts.reason}`);
  for (const part of facts.parts) {
    const refusal = checkProtectedPathMention(part, SETTINGS, ROOT, HOME, NO_LINKS, caseInsensitive);
    if (refusal !== null) return refusal;
  }
  return null;
}

describe('protected-path-mention rule: programs that name a protected path', () => {
  it.each([
    'ln .oss/tool-gates/state.json x',
    'ln -f evil .oss/tool-gates/state.json',
    'ln -s evil .oss/tool-gates/state.json',
    `python3 -c "open('.oss/tool-gates/state.json','w')"`,
    'rsync evil .oss/tool-gates/',
    'tar -xf x.tar -C .oss',
    'curl -o ~/.claude/settings.json http://x',
    'git rm -r .oss/tool-gates',
    'mkfifo .oss/tool-gates/log',
    'rm -rf .oss',
    'rm .oss/workflow-state.json',
    `node -e "require('fs').writeFileSync(process.env.HOME+'/.claude/settings.json','')"`,
    `perl -e "unlink '.oss/tool-gates.json'"`,
    `python3 -c "import shutil; shutil.rmtree('.oss')"`,
    'dd if=x of=.oss/tool-gates.json',
    'install --target-directory=.oss/tool-gates x',
    'mkdir -p ~/.oss/hooks/x',
    'mkfifo .oss/tool-gates/$NAME',
  ])('should refuse: %s', (cmd) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-path-mention');
    expect(refusal?.reason).toMatch(/^Refused: /);
    expect(refusal?.reason).toContain('Ask the user');
  });

  it.each([
    'cat .oss/tool-gates/state.json',
    'ls .oss',
    'git status',
    'grep foo .claude/settings.json',
    'npm test',
    'rm -rf node_modules',
    'python3 -c "print(1)"',
    'cp a b',
    'git diff -- .oss/tool-gates.json',
    'git log -p .claude/settings.json',
    'find .oss -name "*.json"',
    'echo .oss/tool-gates.json',
    'test -f .oss/tool-gates.json',
    'cd .oss && ls',
    'bash "$HOME/.oss/hooks/oss-notify.sh" --workflow build',
    'source ~/.oss/hooks/oss-api-curl.sh',
    '. ~/.oss/hooks/oss-api-curl.sh',
    'node ~/.claude/plugins/cache/oss/watcher/dist/cli/x.js --agent a',
    'git add .',
    'mkdir -p build/$NAME',
    'cp x $DIR/.oss/tool-gates.json',
    'rm -rf .oss/dev/active/x',
  ])('should allow: %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each([
    'find .oss -delete',
    'find .oss -exec rm {} +',
    'git diff --output=.oss/tool-gates.json',
  ])('should refuse a read-only program used to write: %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  it('should name the protected path and the program in the reason', () => {
    expect(check('ln .oss/tool-gates/state.json x')?.reason).toBe(
      'Refused: `ln` names `.oss/tool-gates/state.json`, a protected path, and only read-only programs may. To read it, use the Read tool or `cat .oss/tool-gates/state.json | ln`. Ask the user to run it with `!`.',
    );
  });
});

describe('protected-path-mention rule: letter case', () => {
  it('should refuse .OSS/… on a case-insensitive file system and allow it on a case-sensitive one', () => {
    expect(check('ln .OSS/Tool-Gates/state.json x', true)?.rule).toBe('protected-path-mention');
    expect(check('ln .OSS/Tool-Gates/state.json x', false)).toBeNull();
  });

  it('should match a script literal in any case on a case-insensitive file system', () => {
    expect(check(`python3 -c "open('.OSS/tool-gates.json','w')"`, true)?.rule).toBe('protected-path-mention');
  });
});

function partsOf(cmd: string): CommandPart[] {
  const facts = readCommand(cmd, ROOT, HOME);
  if ('unreadable' in facts) throw new Error(`expected a readable command: ${facts.reason}`);
  return facts.parts;
}

describe('call size: what one Bash call may hold', () => {
  it('should refuse a call of more than 2048 parts even when the parts hold no words', () => {
    const empty: CommandPart = { ...partsOf('x=1')[0], words: [], program: null };
    expect(checkCallSize(Array.from({ length: 2048 }, () => empty))).toBeNull();
    expect(checkCallSize(Array.from({ length: 2049 }, () => empty))).toMatchObject({ reason: expect.stringContaining('too many words') });
  });

  it("should count each string literal of an interpreter's script toward the call's words", () => {
    expect(checkCallSize(partsOf(`python3 -c "${"'a' ".repeat(2000)}"`))).toBeNull();
    expect(checkCallSize(partsOf(`python3 -c "${"'a' ".repeat(2100)}"`))).toMatchObject({ reason: expect.stringContaining('too many words') });
  });

  it("should count an interpreter's heredoc script toward the call's text, but not a heredoc another program writes (fix part K11)", () => {
    expect(checkCallSize(partsOf(`python3 - <<'EOF'\n${'x'.repeat(70_000)}\nEOF`))).toMatchObject({ reason: expect.stringContaining('too complex') });
    expect(checkCallSize(partsOf(`python3 - <<'EOF'\n${'x'.repeat(60_000)}\nEOF`))).toBeNull();
    expect(checkCallSize(partsOf(`cat > notes.txt <<'EOF'\n${'x'.repeat(70_000)}\nEOF`))).toBeNull();
  });

  it('should scan a never-closed string literal within the call deadline (fix part K11)', () => {
    // Given: a 40 KB script `"\"\"…` that never closes, read before the deadline starts
    const parts = partsOf(`python3 - <<'EOF'\n"${'\\"'.repeat(20_000)}\nEOF`);
    let t = 0;
    const slowClock = (): number => (t += 100);

    // Then: on a slow machine the scan stops at the deadline instead of running on
    expect(() => withDeadline(1500, slowClock, () => checkCallSize(parts))).toThrow(OverBudget);
  });
});

describe('protected-path-mention rule: script literals', () => {
  it('should look up a literal repeated in a script only once', () => {
    let lookups = 0;
    const counting: PathResolver = { realpath: (p) => (lookups++, p) };
    const [part] = partsOf(`python3 -c "open('x/a'); open('x/a'); open('x/a')"`);
    checkProtectedPathMention(part, SETTINGS, ROOT, HOME, counting);
    const repeated = lookups;
    lookups = 0;
    checkProtectedPathMention(partsOf(`python3 -c "open('x/a')"`)[0], SETTINGS, ROOT, HOME, counting);
    expect(repeated).toBe(lookups);
  });

  it('should refuse a script literal too long to check, before looking it up', () => {
    let lookups = 0;
    const counting: PathResolver = { realpath: (p) => (lookups++, p) };
    const placesLookups = (checkProtectedPathMention(partsOf('python3 -c "1"')[0], SETTINGS, ROOT, HOME, counting), lookups);
    lookups = 0;
    const refusal = checkProtectedPathMention(partsOf(`python3 -c "open('${'a/'.repeat(3000)}x')"`)[0], SETTINGS, ROOT, HOME, counting);
    expect(refusal?.reason).toContain('too long for the gate to check');
    expect(lookups).toBe(placesLookups);
  });
});

describe('protected-path-mention rule: words written as shell wildcards', () => {
  it.each([
    'mkfifo .oss/tool-gate?/x',
    'ln -s x .o*',
    'chmod 000 ~/.claude/plugi*',
    'cd .oss/tool-gate? && mkfifo cycle.json',
  ])('should refuse %s, which the shell could expand to a protected path', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  it.each(['git add src/*.ts', 'ls .oss/*', "echo '*'", "git add '.oss/*'", 'cd src/* && touch x'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('protected-path-mention rule: programs that write into a folder the gate cannot follow', () => {
  it.each(['cd "$D" && curl -sO http://x/y', 'cd - && tar xf /tmp/x.tar', 'cd "$D" && unzip -o x.zip', 'cd "$D" && wget http://x/y'])(
    'should refuse %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('protected-path-mention');
    },
  );

  it.each(['cd "$D" && curl -s http://x/health', 'cd "$D" && npm test', 'cd "$D" && touch x'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('protected-path-mention rule: programs that run inside a protected folder', () => {
  it.each([
    'cd .oss && tar xf /tmp/x.tar',
    'cd .oss && unzip -o x.zip',
    'cd ~/.claude && curl -sO http://x/y',
    'cd .oss/tool-gates && touch x',
    'git -C .oss/tool-gates apply x.patch',
  ])('should refuse %s, which writes inside a folder holding protected paths without naming them', (cmd) => {
    expect(check(cmd)?.reason).toContain('only read-only programs may');
  });

  it.each(['cd .oss/dev && touch notes.md', 'cd .oss && ls', 'cd .oss && cat tool-gates.json', 'cd ~/.claude && ls', 'cd src && touch x'])(
    'should allow %s',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe('protected-path-mention rule: git settings and variable values', () => {
  it.each([
    'git -c core.fsmonitor=.oss/tool-gates/x status',
    'GIT_PAGER=.oss/tool-gates/x git log',
    'X=.oss/tool-gates.json foo',
    'env X=~/.claude/settings.json foo',
  ])('should refuse %s, which names a protected path in a setting or variable', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  it.each(['git -c color.ui=never log', 'GIT_PAGER=cat git log', 'git diff', 'NODE_ENV=test npm test', 'F=.oss/tool-gates.json cat x'])(
    'should allow %s',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe('protected-path-mention rule: find with an action that writes or runs a command', () => {
  it.each([
    'find . -name tool-gates.json -delete',
    "find . -path '*tool-gates*' -exec rm -rf {} +",
    'find -name x -delete',
    'find -L . -name x -execdir rm {} ;',
    'find ~ -name settings.json -delete',
    'find src . -name x -ok rm {} ;',
    'find . -fprint out.txt',
  ])('should refuse %s, whose start folder holds protected paths', (cmd) => {
    expect(check(cmd)?.reason).toContain('find');
  });

  it.each(["find src -name '*.tmp' -delete", 'find . -name x -print', 'find /tmp/x -delete', 'find .oss/dev -name x -delete'])(
    'should allow %s',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe('protected-path-mention rule: interpreter scripts fed on stdin', () => {
  it.each([
    "python3 - <<'EOF'\nopen('.oss/tool-gates.json','w')\nEOF",
    `node <<< "require('fs').rmSync('.oss/tool-gates',{recursive:true})"`,
    "perl <<EOF\nunlink '.oss/tool-gates.json';\nEOF",
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  // `python3 < script.py` is now unreadable (fix round 4, K2, item 14): the unreadable rule refuses it
  it.each(["python3 - <<'EOF'\nprint(1)\nEOF"])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('protected-path-mention rule: programs that only read, added in ship round 2 (R2c)', () => {
  it.each([
    'jq .phase .oss/workflow-state.json',
    'sed -n 1,5p .oss/tool-gates.json',
    "sed -e 's/a/b/' .oss/tool-gates.json",
    "awk '{print $1}' .oss/workflow-state.json",
    "gawk -F, '{print}' .oss/tool-gates.json",
    '[[ -f .oss/tool-gates.json ]]',
    'git ls-files .oss',
  ])('should allow %s, which only reads', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each([
    "sed -I '' s/a/b/ .oss/tool-gates.json",
    'sed -ni s/a/b/ .oss/tool-gates.json',
    'sed --in-place=.bak s/a/b/ .oss/tool-gates.json',
    "gawk -i inplace '{print}' .oss/tool-gates.json",
    "awk --include=inplace '{print}' .oss/tool-gates.json",
  ])('should refuse %s, which edits the file in place', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });
});

describe('protected-path-mention rule: git add (R2c)', () => {
  it.each(['cd .oss && git add dev/active/x/NOTES.md', 'git add .oss/dev/active/x/NOTES.md'])(
    'should allow %s, since git add writes only the index',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );

  it.each(['cd .oss && git add tool-gates.json', 'git add .oss/tool-gates.json', 'cd .oss && git rm tool-gates.json', 'cd .oss && git apply x.patch'])(
    'should still refuse %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('protected-path-mention');
    },
  );
});

describe('protected-path-mention rule: creating folders (R2c)', () => {
  it.each(['mkdir -p ~/.oss', 'mkdir -p .oss', 'mkdir -p ./.oss/dev/active', 'cd .oss && mkdir x', 'mkdir -p .oss/tool-gates', 'cd .oss && mkdir -p dev/active/x'])(
    'should allow %s, which can not overwrite a file',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );

  it.each(['mkdir -p .oss/workflow-state.json', 'mkdir ~/.oss/hooks/x', 'cd .oss && mkdir tool-gates.json', 'mkdir .oss/tool-gates/cycle.json'])(
    'should refuse %s, which puts a folder at a protected path',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('protected-path-mention');
    },
  );
});

describe('protected-path-mention rule: echo and printf only print (R2c)', () => {
  it.each(['echo ".oss/tool-gates/" >> .gitignore', "printf '%s\\n' .oss/tool-gates.json > notes.txt"])(
    'should allow %s, whose words are text and whose redirect the write check reads',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe("protected-path-mention rule: the repo's protected paths are matched only under the project root (R2c)", () => {
  it.each([
    `node -e "require('fs').readFileSync(process.env.HOME + '/.oss/workflow-state.json')"`,
    `python3 -c "open('${HOME}/.oss/workflow-state.json')"`,
  ])("should allow %s, which names the home folder's workflow state", (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each([
    `python3 -c "open('.oss/workflow-state.json','w')"`,
    `python3 -c "open('${ROOT}/.oss/workflow-state.json','w')"`,
    `node -e "require('fs').writeFileSync(process.env.HOME + '/.claude/settings.json','')"`,
  ])('should still refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });
});

describe('protected-path-mention rule: a refused mention says how to read instead (R2c)', () => {
  it('should suggest the Read tool or cat … | for a program that may write', () => {
    expect(check('xxd .oss/tool-gates.json')?.reason).toBe(
      'Refused: `xxd` names `.oss/tool-gates.json`, a protected path, and only read-only programs may. To read it, use the Read tool or `cat .oss/tool-gates.json | xxd`. Ask the user to run it with `!`.',
    );
  });
});

describe('protected-path-mention rule: cp reads its sources (R2c)', () => {
  it.each(['cp ~/.oss/hooks/oss-statusline.sh "$HOME/.oss/"', 'cp .oss/tool-gates.json /tmp/x'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each(['cp --suffix=.oss/tool-gates.json x y'])('should still check the values of its options: %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });
});

describe('protected-path-mention rule: sed and awk can write from their script, so they stay out of protected folders (R2c)', () => {
  it.each([
    "cd .oss && sed -n 'w tool-gates.json' /tmp/x",
    `cd .oss/tool-gates && awk '{print > "cycle.json"}' /tmp/x`,
    "cd .oss/tool-gate? && sed -n 'w cycle.json' /tmp/x",
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  it.each(["cd .oss && jq . tool-gates.json", "cd .oss && git ls-files", "cd src && sed -n 1p x.ts"])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('protected-path-mention rule: a name used after a cd the gate cannot follow (fix round 4, K2)', () => {
  const fromSrc = (cmd: string) => {
    const facts = readCommand(cmd, `${ROOT}/src`, HOME);
    return facts.parts.map((part) => checkProtectedPathMention(part, SETTINGS, ROOT, HOME, NO_LINKS)).find((r) => r !== null) ?? null;
  };

  it.each([
    'cd "$X" && curl -so workflow-state.json https://example.com/x',
    `cd "$X" && python3 -c "open('tool-gates.json', 'w')"`,
    'cd "$X" && ln -sf x .claude/settings.json',
  ])('should refuse %s', (cmd) => {
    expect(fromSrc(cmd)?.rule).toBe('protected-path-mention');
  });

  it.each(['cd "$X" && curl -so out.json https://example.com/x', 'cd "$X" && npm run build', `cd "$X" && python3 -c "print('x')"`])(
    'should allow %s',
    (cmd) => {
      expect(fromSrc(cmd)).toBeNull();
    },
  );
});

describe('protected-path-mention rule: ordinary words after a cd the gate cannot follow stay allowed (fix round 4, K2)', () => {
  it.each(['cd "$X" && git config user.name x', 'cd "$X" && git reset HEAD', 'cd "$X" && make config', 'cd "$X" && git add settings.json'])(
    'should allow %s',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe('protected-path-mention rule: patterns that also match dot entries (fix round 4, K2)', () => {
  it.each(['shopt -s dotglob; chmod -R 000 *', 'setopt globdots; ln -sf x *', 'chown -R x *(D)'])(
    'should refuse %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('protected-path-mention');
    },
  );

  it.each(['chmod -R 000 *', 'ln -sf x *', 'shopt -s dotglob; chmod 644 src/*.ts', 'cd "$X" && ln -sf x lib/settings.json'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('protected-path-mention rule: awk and sed script files run on a protected file (fix round 4, K8, item 15)', () => {
  it.each([
    'gawk -f x.awk .oss/workflow-state.json',
    'awk -E x.awk .oss/workflow-state.json',
    'gawk --exec x.awk .oss/workflow-state.json',
    'gawk --file=x.awk .oss/tool-gates.json',
    'sed -f s.sed .oss/workflow-state.json',
    'sed -nf s.sed .oss/workflow-state.json',
    'sed --file s.sed .oss/workflow-state.json',
  ])('should refuse %s: a script file can edit its operand in place (@include "inplace")', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  it.each(['gawk -f x.awk data.csv', 'sed -f s.sed data.csv', "awk '{print}' .oss/workflow-state.json", 'sed -n 1p .oss/workflow-state.json'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('protected-path-mention rule: a quote with no closing match (fix part K12, item 2)', () => {
  it.each([
    `python3 - <<'EOF'\n# don't worry\nopen(".git/config", "a").write("x")\nEOF`,
    `node <<'EOF'\n// it's fine\nrequire("fs").writeFileSync(".claude/settings.local.json","{}")\nEOF`,
    `python3 -c '# dont\`t\nopen(".git/hooks/pre-commit","w")'`,
  ])('should still read the literals after it: refuses %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-path-mention');
  });

  it.each([
    `python3 - <<'EOF'\n# it's done\n${'print("line")\n'.repeat(400)}EOF`,
    `node <<'EOF'\n// we won't write\nconsole.log("a \`b");\nEOF`,
  ])('should allow an ordinary script with one apostrophe or backquote (%#)', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it('should look for a quote of a kind found unclosed only once, so the scan stays linear', () => {
    // Given: the round-5 shape, a 40 KB `"\"\"…` whose first quote never closes (nor does any later one)
    const parts = partsOf(`python3 - <<'EOF'\n"${'\\"'.repeat(20_000)}\nEOF`);
    let looks = 0;
    const counting = (): number => (looks++, 0);
    withDeadline(1000, counting, () => checkCallSize(parts));
    // Then: a few steps a character in all (one look every 256 steps), not one pass per quote
    expect(looks * 256).toBeLessThan(40_000 * 4);
  });
});
