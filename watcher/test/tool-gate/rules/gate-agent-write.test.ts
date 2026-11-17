/**
 * @behavior A review (gate) agent, named in gateAgents (matched after the last `:`, any letter case), may not
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
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../../../src/tool-gate/command-reader.js';
import { loadSettings, type GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { PathResolver } from '../../../src/tool-gate/path-resolver.js';
import { checkGateAgentBash, checkGateAgentCommand, checkGateAgentEdit, checkGateAgentUnreadable, isOwnSetupStep, ownAgentFile } from '../../../src/tool-gate/rules/gate-agent-write.js';

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

/** A disk where every path exists except those with `missing` in them. */
const exists = (absPath: string): boolean =>
  !absPath.includes('missing') &&
  (!absPath.includes('/node_modules/.bin/') || /\/node_modules\/\.bin\/(?:playwright|tsc|eslint)$/.test(absPath) || absPath === `${ROOT}/web/node_modules/.bin/prettier`);
/** The temp folders a review agent may write (the system's and the session's TMPDIR). */
const TEMP = [TMP, '/var/folders/xy/T', '/var/folders/ab/cd12/T'];
/** The review agent's own private folder: its Write/Edit tools' only place (round 10, D-R10-2). */
const OWN = '/var/folders/xy/T/oss-review/s1/agent-a1';
const SCOPE = { repos: [ROOT], home: HOME, exists, temp: TEMP, privateDir: OWN };
const REVIEWER = 'oss:code-reviewer';
/** The words every allowlist refusal carries. */
const OFF_LIST = 'review allowlist';

/** The agent making the call; `null` stands for the main agent, which has no name. */
type Caller = string | null;

function checkEdit(filePath: string, caller: Caller = REVIEWER, paths: PathResolver = NO_LINKS) {
  return checkGateAgentEdit({ filePath }, caller ?? undefined, SETTINGS, SCOPE, paths);
}

function checkBash(cmd: string, caller: Caller = REVIEWER, paths: PathResolver = NO_LINKS, background = false) {
  const facts = readCommand(cmd, ROOT, HOME);
  if ('unreadable' in facts) throw new Error('expected a readable command');
  return (
    facts.parts
      .map((part, i) => checkGateAgentBash(part, caller ?? undefined, SETTINGS, SCOPE, paths, false, { earlier: facts.parts.slice(0, i), background }))
      .find((r) => r !== null) ?? null
  );
}

describe('gate-agent-write: edit tools (AC-004.1)', () => {
  it.each(['oss:code-reviewer', 'code-reviewer', 'oss:security-auditor', 'oss:oss:code-reviewer', 'OSS:Code-Reviewer'])('should refuse %s writing a file inside the repo', (agent) => {
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
  it('should allow Bash writes in the system temp folder, and edit tools only in the agent\'s own folder (round 10, D-R10-2)', () => {
    expect(checkBash(`echo x > ${TMP}/review.md`)).toBeNull();
    expect(checkEdit(`${OWN}/review.md`)).toBeNull();
    expect(checkEdit(`${TMP}/review.md`)?.reason).toContain(OWN);
  });

  it('should allow Bash writes in a mktemp -d folder', () => {
    const scratch = '/var/folders/xy/T/oss-offload.Ab12Cd';
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
  ])('should never refuse %s', (_label, agent) => {
    expect(checkEdit(`${ROOT}/src/app.ts`, agent)).toBeNull();
    expect(checkBash('echo x > src/app.ts && rm -rf src', agent)).toBeNull();
  });
});

/**
 * @behavior A review agent may read the repo it reviews with git but not change it: only read-only
 *   subcommands (and only the list forms of branch, tag, remote, config, stash, worktree, notes,
 *   reflog and submodule) run there; anything else, or a git call that can change what git runs or
 *   where it writes (`-c`, `--git-dir`, `--output` …), is refused. Git in a folder outside the
 *   reviewed repos (a pen tester's throwaway repo) is not restricted by this rule.
 * @business-rule R-266 ship-gate fix 2: a reviewer that commits, stages or switches branches in the
 *   repo it judges is no longer an independent check; an unknown subcommand is refused (fail closed).
 */
describe('gate-agent-write: read-only git in the reviewed repo', () => {
  const READ_ONLY = 'read-only git';

  it.each([
    'git status',
    'git diff HEAD~1 -- src',
    'git log --oneline -5',
    'git show HEAD:src/app.ts',
    'git blame src/app.ts',
    'git grep -n foo',
    'git ls-files',
    'git rev-parse --show-toplevel',
    'git merge-base HEAD origin/main',
    'git for-each-ref refs/heads',
    'git cat-file -p HEAD',
    'git -C src log',
    'git --no-pager diff',
    'git branch',
    'git branch -a',
    'git branch -vv',
    'git branch --show-current',
    'git branch --list "feat/*"',
    'git branch --contains HEAD',
    "git branch --format='%(refname)' --sort=-committerdate",
    'git tag',
    'git tag -l "v*"',
    'git tag --points-at HEAD',
    'git tag -n5',
    'git remote',
    'git remote -v',
    'git remote show origin',
    'git remote get-url origin',
    'git config --get user.name',
    'git config --list --show-origin',
    'git config -l',
    'git config --get-regexp ^remote',
    'git stash list',
    'git stash show -p',
    'git worktree list --porcelain',
    'git notes list',
    'git notes show HEAD',
    'git reflog',
    'git reflog show HEAD',
    'git submodule status',
    'git submodule summary',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each([
    'git commit -m x',
    'git add .',
    'git checkout -b fix',
    'git switch main',
    'git reset --hard',
    'git restore src/app.ts',
    'git stash',
    'git stash pop',
    'git merge feat/x',
    'git rebase main',
    'git cherry-pick abc',
    'git apply fix.patch',
    'git am fix.patch',
    'git fetch',
    'git pull',
    'git push',
    'git gc',
    'git update-ref refs/heads/x HEAD',
    'git my-alias',
    'git branch fix',
    'git branch -d fix',
    'git branch -a fix',
    'git branch -m old new',
    'git tag v1',
    'git tag -d v1',
    'git tag -a v1 -m x',
    'git remote add evil https://example.com/x',
    'git remote set-url origin https://example.com/x',
    'git config user.name x',
    'git config --unset user.name',
    'git config --global --get user.name',
    'git stash drop',
    'git worktree add ../wt',
    'git notes add -m x',
    'git reflog expire --all',
    'git submodule update',
    'git submodule foreach echo',
    'git submodule',
    'git -c core.pager=cat log',
    'git --config-env=core.pager=P log',
    'git --exec-path=/tmp/bin status',
    'git --git-dir=.git status',
    'git --work-tree=. status',
    'git --bogus status',
    'git diff --output=out.txt',
    'git log --output out.txt',
    'git grep -O"sh -c x" foo',
    'git grep --open-files-in-pager=vim foo',
    'git ls-remote --upload-pack=evil origin',
  ])('should refuse `%s`', (cmd) => {
    const refusal = checkBash(cmd);
    expect(refusal?.rule).toBe('gate-agent-write');
    expect(refusal?.reason).toContain(READ_ONLY);
    expect(refusal?.reason).toContain('review and report only');
  });

  it('should refuse git run in a folder only known when it runs', () => {
    expect(checkBash('git -C "$D" commit -m x')?.rule).toBe('gate-agent-write');
  });

  it('should refuse git run outside the repo but pointed into it with --git-dir or GIT_DIR', () => {
    expect(checkBash(`cd ${TMP} && git --git-dir=${ROOT}/.git commit -m x`)?.reason).toContain(READ_ONLY);
    expect(checkBash(`cd ${TMP} && GIT_DIR=${ROOT}/.git git commit -m x`)?.rule).toBe('gate-agent-write');
  });

  it('should leave git alone in a folder outside the reviewed repos', () => {
    const sandbox = `${TMP}/pentest-sandbox`;
    expect(checkBash(`git -C ${sandbox} init && git -C ${sandbox} commit --allow-empty -m x`)).toBeNull();
    expect(checkBash(`cd ${sandbox} && git add . && git commit -m x`)).toBeNull();
  });

  it('should never restrict git for a builder or the main agent', () => {
    expect(checkBash('git add . && git commit -m x', 'oss:typescript-pro')).toBeNull();
    expect(checkBash('git add . && git commit -m x', null)).toBeNull();
  });
});

/**
 * @behavior A review agent's writes are checked against every repo it reviews: the project root and
 *   the repo holding the folder the agent works in (a sibling worktree), not the project root only.
 * @business-rule R-266 ship-gate fix 1: a review run in a worktree may not change that worktree.
 */
describe('gate-agent-write: every reviewed repo', () => {
  const WORKTREE = '/work/repo-wt';
  const repos = { repos: [ROOT, WORKTREE], home: HOME, exists, temp: TEMP };

  it('should refuse writes into the second reviewed repo by edit tool and by shell', () => {
    expect(checkGateAgentEdit({ filePath: `${WORKTREE}/src/app.ts` }, REVIEWER, SETTINGS, repos, NO_LINKS)?.rule).toBe('gate-agent-write');
    const facts = readCommand('echo x > src/app.ts', WORKTREE, HOME);
    if ('unreadable' in facts) throw new Error('expected a readable command');
    expect(checkGateAgentBash(facts.parts[0], REVIEWER, SETTINGS, repos, NO_LINKS)?.rule).toBe('gate-agent-write');
  });

  it('should refuse a commit in the second reviewed repo', () => {
    const facts = readCommand('git commit -m x', WORKTREE, HOME);
    if ('unreadable' in facts) throw new Error('expected a readable command');
    expect(checkGateAgentBash(facts.parts[0], REVIEWER, SETTINGS, repos, NO_LINKS)?.reason).toContain('read-only git');
  });
});

/**
 * @behavior A review agent may not start work that keeps running after its run ends: a command sent
 *   to the background with `&`, or run under nohup, setsid, disown, at, batch, screen, tmux,
 *   daemonize, launchctl, crontab, systemd-run, or a nested `claude` session (which carries no agent
 *   name, so no review rule would apply inside it). This holds in any folder.
 * @business-rule R-266 ship-gate fix 3: what a reviewer leaves running is outside every later check.
 */
describe('gate-agent-write: work that outlives the review', () => {
  it.each([
    'sleep 60 &',
    `cd ${TMP} && make &`,
    '(sleep 60; touch x) &',
    'nohup make',
    'env A=1 nohup make',
    'setsid make',
    'sleep 60 & disown',
    'echo make | at now',
    'echo make | batch',
    'screen -dm make',
    'tmux new -d make',
    'daemonize /bin/make',
    'launchctl load x.plist',
    'crontab -l',
    'systemd-run make',
    'claude -p "fix it"',
    `bash -c 'sleep 60 &'`,
  ])('should refuse `%s`', (cmd) => {
    const refusal = checkBash(cmd);
    expect(refusal?.rule).toBe('gate-agent-write');
    expect(refusal?.reason).toContain('outlives its run');
  });

  it('should allow a builder running work in the background', () => {
    expect(checkBash('npm run dev &', 'oss:typescript-pro')).toBeNull();
  });
});

/**
 * @behavior A review agent may not run `ln` on a file or folder inside the repo it reviews: a hard
 *   link outside the repo would let a later write there change the repo file.
 * @business-rule R-266 ship-gate fix 4: hard links are not resolved by realpath, so they are refused at creation.
 */
describe('gate-agent-write: links to repo files', () => {
  it.each([
    `ln src/app.ts ${TMP}/app.ts`,
    `ln ${ROOT}/src/app.ts ${TMP}/app.ts`,
    `ln -f -- src/app.ts ${TMP}/app.ts`,
    `ln -s ${ROOT}/src ${TMP}/src`,
    `cd ${TMP} && ln ${ROOT}/src/app.ts x`,
    `ln "$F" ${TMP}/x`,
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it('should allow links made entirely outside the repo', () => {
    expect(checkBash(`cd ${TMP} && ln a.txt b.txt`)).toBeNull();
  });
});

/**
 * @behavior A review agent may not call the agent offloader under any name but a review agent's:
 *   the offloaded run would carry the other agent's tools and trust.
 * @business-rule R-266 ship-gate fix 6: a review agent may not offload under another agent's name.
 */
describe('gate-agent-write: offload identity', () => {
  const OFFLOADER = '/plugins/oss/watcher/dist/cli/agent-offload.js';

  it.each([
    `node ${OFFLOADER} --agent oss:typescript-pro --prompt-file /dev/stdin`,
    `node ${OFFLOADER} --agent=typescript-pro --prompt-file /dev/stdin`,
    `node ${OFFLOADER} --agent "$AGENT_ID" --prompt-file /dev/stdin`,
    `node ${OFFLOADER} --prompt-file /dev/stdin`,
  ])('should refuse `%s`', (cmd) => {
    const refusal = checkBash(cmd);
    expect(refusal?.rule).toBe('gate-agent-write');
    expect(refusal?.reason).toContain('another agent');
  });

  it('should not refuse a review agent offloading under its own name as another agent (the allowlist refuses the script outside the repo)', () => {
    const refusal = checkBash(`node ${OFFLOADER} --agent oss:code-reviewer --prompt-file /dev/stdin`);
    expect(refusal?.reason).not.toContain('another agent');
    expect(refusal?.reason).toContain(OFF_LIST);
  });
});

/**
 * @behavior A review agent may not change the installed dependencies of the repo it reviews
 *   (npm/pnpm/yarn/bun installs and removals, pip, uv, poetry, gem, bundle, cargo, go get …), when
 *   the command runs in the repo or points into it with --prefix / -C / --cwd / --dir. Running the
 *   repo's tests and builds stays allowed, and so do installs in a folder outside the repo.
 * @business-rule R-266 ship-gate batch 2, fix 1 (user decision): installing changes the code under
 *   review (lock files, node_modules, site-packages) and runs install scripts.
 */
describe('gate-agent-write: installed dependencies of the reviewed repo', () => {
  const DEPS = 'installed dependencies';

  it.each([
    'npm install', 'npm i lodash', 'npm ci', 'npm add x', 'npm update', 'npm up', 'npm uninstall x', 'npm rm x',
    'npm remove x', 'npm link', 'npm dedupe', 'npm rebuild', 'npm prune', 'npm --silent install',
    'pnpm install', 'pnpm i', 'pnpm add x', 'pnpm update', 'pnpm up', 'pnpm remove x', 'pnpm rm x', 'pnpm link',
    'pnpm rebuild', 'pnpm prune', 'pnpm import',
    'yarn', 'yarn --frozen-lockfile', 'yarn install', 'yarn add x', 'yarn upgrade', 'yarn up', 'yarn remove x', 'yarn link', 'yarn import',
    'bun install', 'bun i', 'bun add x', 'bun update', 'bun remove x', 'bun link',
    'pip install x', 'pip3 install -r requirements.txt', 'pip uninstall x', 'pip download x', 'python -m pip install x',
    'python3 -m pip install -e .',
    'uv pip install x', 'uv pip sync r.txt', 'uv add x', 'uv remove x', 'uv sync',
    'poetry install', 'poetry add x', 'poetry update', 'poetry remove x',
    'gem install x', 'bundle install', 'bundle update', 'bundle',
    'cargo install x', 'cargo add x', 'cargo update',
    'go get x', 'go mod download', 'go install x',
    `cd ${TMP} && npm install --prefix ${ROOT}`,
    `cd ${TMP} && npm --prefix=${ROOT} ci`,
    `cd ${TMP} && pnpm -C ${ROOT} install`,
    `cd ${TMP} && yarn --cwd ${ROOT} add x`,
    `cd ${TMP} && pnpm --dir ${ROOT} add x`,
  ])('should refuse `%s` for the reviewed repo', (cmd) => {
    const refusal = checkBash(cmd);
    expect(refusal?.rule).toBe('gate-agent-write');
    expect(refusal?.reason).toContain(DEPS);
  });

  it.each(['npm test', 'npm run build', 'npx vitest run', 'pnpm test', 'yarn test', 'bun test', 'cargo test', 'go test ./...', 'pip list', 'npm ls'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );

  it('should not refuse installs in a folder outside the reviewed repo as a dependency change (the allowlist refuses them)', () => {
    const refusal = checkBash(`cd ${TMP}/sandbox && npm install && pip install x`);
    expect(refusal?.reason).not.toContain('installed dependencies');
    expect(refusal?.rule).toBe('gate-agent-write');
  });

  it('should never refuse a builder installing', () => {
    expect(checkBash('npm install && pip install x', 'oss:typescript-pro')).toBeNull();
  });
});

/**
 * @behavior A git command a review agent runs is refused when a GIT_* variable is set for it or
 *   earlier in the same call (inline, through env, alone, or by export/declare/typeset/readonly/local),
 *   since such a variable can point git at the reviewed repo or change the config and programs it runs.
 * @business-rule R-266 ship-gate batch 2, fix 2a: git setup the gate can't follow is refused (fail closed).
 */
describe('gate-agent-write: git variables set in the call', () => {
  it.each([
    `export GIT_DIR=${ROOT}/.git; cd ${TMP} && git commit -m x`,
    `GIT_DIR=${ROOT}/.git; cd ${TMP}; git commit -m x`,
    'GIT_CONFIG_PARAMETERS="\'core.pager=sh\'" git log',
    'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=sh; git log',
    'declare -x GIT_CONFIG_PARAMETERS=x; git status',
    'typeset -x GIT_WORK_TREE=x; git status',
    'readonly GIT_DIR=x; git status',
    'env GIT_DIR=x git status',
    `cd ${TMP} && GIT_DIR=${ROOT}/.git git commit -m x`,
  ])('should refuse `%s`', (cmd) => {
    const refusal = checkBash(cmd);
    expect(refusal?.rule).toBe('gate-agent-write');
    expect(refusal?.reason).toContain('GIT_');
  });

  it('should allow a variable that is not git\'s, and git with none', () => {
    expect(checkBash('export PAGER=cat; git log')).toBeNull();
  });
});

describe('gate-agent-write: more launchers and links through the home folder', () => {
  it.each(['coproc make', 'start-stop-daemon --start --exec /bin/make', 'pm2 start app.js', 'forever start app.js', 'open x.html', 'osascript -e x', 'xdg-open x.html', 'launchd'])(
    'should refuse `%s` as work that outlives the run',
    (cmd) => {
      expect(checkBash(cmd)?.reason).toContain('outlives its run');
    },
  );

  it('should read an ln operand under ~ from the home folder', () => {
    expect(checkBash(`cd ${TMP} && ln ~/../../work/repo/src/app.ts x`)?.rule).toBe('gate-agent-write');
    expect(checkBash(`cd ${TMP} && ln ~other/x y`)?.rule).toBe('gate-agent-write');
    // round 6 (user choice 2): a link only in the temp folders
    expect(checkBash(`cd ${TMP} && ln ~/a ~/b`)?.rule).toBe('gate-agent-write');
    expect(checkBash(`cd ${TMP} && ln a b`)).toBeNull();
  });
});

/**
 * @behavior A command word that is also a name every JavaScript object carries (`constructor`,
 *   `__proto__`, `toString`, `hasOwnProperty`) is an ordinary word to the rule: the call is checked
 *   like any other, never crashing the gate (a crash allows the call unchecked).
 * @business-rule R-266 ship round 2, fix 1: no input may turn the review rule off.
 */
describe('gate-agent-write: object property names as command words', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('should still refuse a write after `%s`', (word) => {
    expect(checkBash(`${word}; printf x > f.txt`)?.rule).toBe('gate-agent-write');
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('should refuse `git %s` as not read-only', (word) => {
    expect(checkBash(`git ${word}`)?.reason).toContain('read-only git');
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('should check `npm %s` and `%s install` without crashing', (word) => {
    expect(() => checkBash(`npm ${word} && ${word} install`)).not.toThrow();
  });
});

/**
 * @behavior A review agent may only run programs written out in full: a program word that comes
 *   from a variable, `$( … )` or backticks, or that holds a wildcard, is refused, and so is a
 *   wildcard in the script an interpreter runs, since the gate can't tell what runs.
 * @business-rule R-266 ship round 2, fix 2: `G=git; $G commit` must not slip past the git check.
 */
describe('gate-agent-write: programs only known when the command runs', () => {
  it.each([
    'G=git; $G commit -m x',
    '$(echo git) commit -m x',
    '`echo git` commit -m x',
    'N=nohup; $N make',
    'B=bash; $B -c "make &"',
    '/usr/bin/gi* commit -m x',
    'node /plugins/oss/watcher/dist/cli/agent-off*.js --agent oss:typescript-pro',
    'python3 /tmp/scr?pt.py',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('named in full');
  });

  it('should allow a literal program with variable arguments', () => {
    expect(checkBash('cat "$F" && grep -n "$P" src')).toBeNull();
  });
});

/**
 * @behavior In a reviewed repo a review agent may not run git under another name (`git-commit`,
 *   any program in git's exec path, `hub`), and anywhere it may only run read-only `gh` commands:
 *   pr view/list/diff/checks/status, issue view/list, run view/list, and `gh api` reads (GET).
 * @business-rule R-266 ship round 2, fix 3: a reviewer may not change the repo or its remote.
 */
describe('gate-agent-write: git by other names, and gh', () => {
  it.each([
    'git-commit -m x',
    'git-update-ref refs/heads/x HEAD',
    'git-receive-pack .',
    '/usr/libexec/git-core/git-commit -m x',
    '/Library/Developer/CommandLineTools/usr/libexec/git-core/scalar register',
    'hub status',
    'hub commit -m x',
  ])('should refuse `%s` in the reviewed repo', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('read-only git');
  });

  it('should not refuse git-* outside the reviewed repos as repo git (the allowlist refuses it)', () => {
    const refusal = checkBash(`cd ${TMP}/sandbox && git-commit -m x`);
    expect(refusal?.reason).not.toContain('read-only git');
    expect(refusal?.reason).toContain(OFF_LIST);
  });

  it.each([
    'gh pr checkout 12',
    'gh pr merge 12 --squash',
    'gh pr create --fill',
    'gh pr comment 12 -b x',
    'gh repo sync',
    `gh repo clone o/r ${ROOT}/sub`,
    'gh release create v1',
    'gh api -X POST repos/o/r/issues',
    'gh api --method=DELETE repos/o/r',
    'gh api -XPATCH repos/o/r',
    'gh api repos/o/r/issues -f title=x',
    'gh workflow run ci.yml',
    'gh constructor',
    `cd ${TMP} && gh pr merge 12 -R o/r`,
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('read-only gh');
  });

  it.each([
    'gh pr view 12',
    'gh pr list',
    'gh pr diff 12',
    'gh pr checks 12',
    'gh pr status',
    'gh issue view 3',
    'gh issue list',
    'gh run view 9',
    'gh run list',
    'gh api repos/o/r/pulls',
    'gh api -X GET repos/o/r/pulls -f state=open',
    'gh -R o/r pr view 12',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

/**
 * @behavior A review agent may call the offloader only once-named, under its own name: two
 *   `--agent` options, or any name but the caller's own, are refused.
 * @business-rule R-266 ship round 2, fix 4: a review agent may not offload under another agent's name.
 */
describe('gate-agent-write: offload identity, strict', () => {
  const OFFLOADER = '/plugins/oss/watcher/dist/cli/agent-offload.js';

  it.each([
    `node ${OFFLOADER} --agent oss:code-reviewer --agent oss:typescript-pro`,
    `node ${OFFLOADER} --agent=oss:code-reviewer --agent oss:typescript-pro`,
    `node ${OFFLOADER} --agent=oss:security-auditor`,
    `node ${OFFLOADER} --agent oss:security-auditor`,
  ])('should refuse `%s` from code-reviewer', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('another agent');
  });

  it.each([`node ${OFFLOADER} --agent=oss:code-reviewer`, `node ${OFFLOADER} --agent code-reviewer`])('should not refuse `%s` from code-reviewer as another agent', (cmd) => {
    expect(checkBash(cmd)?.reason).not.toContain('another agent');
  });
});

/**
 * @behavior A review agent may not write the review check's state (`~/.oss/run`) or the user's git
 *   config (`~/.gitconfig`, `~/.config/git`), by edit tool or shell, nor run the review check's own
 *   entry points (gate-run.cjs, gate-run.js, oss-gate-run.sh).
 * @business-rule R-266 ship round 2, fixes 5 and 8: a reviewer may not record its own verdict or
 *   change how git behaves for the next command.
 */
describe('gate-agent-write: user-level files and the review check', () => {
  it.each([`${HOME}/.oss/run/r1/verdict.txt`, `${HOME}/.gitconfig`, `${HOME}/.config/git/config`, `${HOME}/.oss`])(
    'should refuse an edit tool writing %s',
    (file) => {
      expect(checkEdit(file)?.rule).toBe('gate-agent-write');
    },
  );

  it.each([
    'echo pass > ~/.oss/run/r1/verdict.txt',
    'rm -rf ~/.oss/run',
    'rm -rf ~/.oss',
    'echo x >> ~/.gitconfig',
    `cp ${TMP}/c ~/.config/git/config`,
    'rm -r ~/.config/git/*',
    `cd ${TMP} && git config --global user.name x`,
    `cd ${TMP} && git config --file ${HOME}/.gitconfig core.pager x`,
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each([
    'node /plugins/oss/watcher/dist/cli/gate-run.cjs record pass',
    'node /plugins/oss/watcher/dist/cli/gate-run.js verdict',
    'bash /plugins/oss/hooks/oss-gate-run.sh agent-post',
    '/plugins/oss/hooks/oss-gate-run.sh agent-post',
    `cd ${TMP} && sh ./oss-gate-run.sh`,
  ])('should refuse running the review check: `%s`', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('review check');
  });

  it('should allow reading the check and the git config', () => {
    expect(checkBash('cat /plugins/oss/hooks/oss-gate-run.sh ~/.gitconfig && ls ~/.oss/run')).toBeNull();
  });
});

/**
 * @behavior More ways to leave work running are refused: `ssh -f`, `sudo -b`, a detached
 *   `docker`/`podman` container (`run -d`, `start`, `compose up -d`), `emacs --daemon`.
 * @business-rule R-266 ship round 2, fix 6: what a reviewer leaves running is outside every later check.
 */
describe('gate-agent-write: detached launches', () => {
  it.each([
    'ssh -f host sleep 60',
    'ssh -fN -L 1:a:2 host',
    'ssh -Nf host',
    'sudo -b make',
    'sudo -u root -b make',
    'docker run -d nginx',
    'docker run --detach nginx',
    'docker run -itd nginx',
    'docker container run -d nginx',
    'podman start web',
    'docker start web',
    'docker compose up -d',
    'emacs --daemon',
    'emacs --bg-daemon=x',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('outlives its run');
  });

  it.each(['ssh host ls', 'sudo ls', 'docker run --rm alpine true', 'docker ps', 'emacs -nw x', 'make test'])('should not take `%s` for a launch', (cmd) => {
    expect(checkBash(cmd)?.reason ?? '').not.toContain('outlives its run');
  });
});

/**
 * @behavior npm's other spellings of installing (aliases and typos npm accepts), `npm audit fix`,
 *   `npm pkg set|delete`, `npm exec -p` and `npx -p`, and npm/pnpm/yarn run through `node <cli file>`
 *   count as changing the reviewed repo's installed dependencies.
 * @business-rule R-266 ship round 2, fix 7: an alias must not get round the dependency rule.
 */
describe('gate-agent-write: npm aliases and package managers run through node', () => {
  it.each([
    'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'it', 'cit', 'clean-install-test', 'sit',
    'install-test', 'install-ci-test', 'clean-install', 'ic', 'install-clean', 'isntall-clean', 'un', 'unlink', 'r',
    'upgrade', 'udpate', 'ln', 'rb', 'ddp', 'audit fix', 'pkg set a=b', 'pkg delete a', 'exec -p x y', 'exec --package=x y',
    'x -p x y',
  ])('should refuse `npm %s`', (sub) => {
    expect(checkBash(`npm ${sub}`)?.reason).toContain('installed dependencies');
  });

  it.each([
    'node /usr/lib/node_modules/npm/bin/npm-cli.js install',
    'node ~/.local/pnpm/pnpm.cjs add x',
    'node .yarn/releases/yarn.js add x',
    'npx -p typescript tsc',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.reason).toContain('installed dependencies');
  });

  it.each(['npm find-dupes', 'npm audit', 'npm pkg get name', 'npm exec vitest', 'npm x tsc --noEmit'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );

  it('should not refuse npm run through its cli file as a dependency change (the allowlist refuses a script outside the repo)', () => {
    const refusal = checkBash('node /usr/lib/node_modules/npm/bin/npm-cli.js test');
    expect(refusal?.reason).not.toContain('installed dependencies');
    expect(refusal?.rule).toBe('gate-agent-write');
  });
});

/**
 * @behavior The penetration tester may leave work running in a sandbox outside the reviewed repos
 *   (`cd /tmp/sandbox && node server.js &`, nohup, tmux, ssh -f, a detached container): it attacks a
 *   running copy. Inside the repos, or where the gate can't tell where the work runs, it stays
 *   refused, and the other review agents are refused everywhere. A Bash call sent with
 *   `run_in_background: true` counts as work sent to the background.
 * @business-rule R-266 user decision 2026-11-12 (items 9 and 10): background work is a pen-test tool,
 *   never a way to keep changing the reviewed repo after the review.
 */
describe('gate-agent-write: background work for the penetration tester', () => {
  const PEN = 'oss:penetration-tester';
  const SANDBOX = `${TMP}/sandbox`;

  it.each([
    `cd ${SANDBOX} && node server.js &`,
    `cd ${SANDBOX} && nohup python3 -m http.server 8000`,
    `cd ${SANDBOX} && tmux new -d ./run.sh`,
    `cd ${SANDBOX} && docker run -d nginx`,
  ])('should allow the pen tester `%s` outside the repos', (cmd) => {
    expect(checkBash(cmd, PEN)).toBeNull();
    expect(checkBash(cmd, 'OSS:Penetration-Tester ')).toBeNull();
  });

  it.each([
    'node server.js &',
    `cd ${SANDBOX} && node ${ROOT}/server.js &`,
    `cd ${SANDBOX} && sleep "$N" &`,
    `cd ${SANDBOX} && claude -p "x"`,
    `cd ${SANDBOX} && echo x | crontab -`,
    `node ${SANDBOX}/server.js &`,
  ])('should still refuse the pen tester `%s`', (cmd) => {
    expect(checkBash(cmd, PEN)?.reason).toContain('outlives its run');
  });

  it('should refuse the pen tester background work in a folder only known when it runs', () => {
    expect(checkBash('cd "$SANDBOX" && node server.js &', PEN)?.rule).toBe('gate-agent-write');
  });

  it.each(['oss:code-reviewer', 'oss:security-auditor', 'oss:performance-auditor'])('should refuse %s background work outside the repos', (agent) => {
    expect(checkBash(`cd ${SANDBOX} && node server.js &`, agent)?.reason).toContain('outlives its run');
  });

  it('should keep every other rule for the pen tester outside the repos', () => {
    expect(checkBash(`cd ${SANDBOX} && G=x; $G &`, PEN)?.reason).toContain('named in full');
    expect(checkBash(`cd ${SANDBOX} && echo x > ~/.oss/run/v.txt &`, PEN)?.rule).toBe('gate-agent-write');
  });

  it('should treat a call run in the background like `&`', () => {
    expect(checkBash('npm test', REVIEWER, NO_LINKS, true)?.reason).toContain('outlives its run');
    expect(checkBash(`cd ${SANDBOX} && node server.js`, REVIEWER, NO_LINKS, true)?.reason).toContain('outlives its run');
    expect(checkBash(`cd ${SANDBOX} && node server.js`, PEN, NO_LINKS, true)).toBeNull();
    expect(checkBash('node server.js', PEN, NO_LINKS, true)?.reason).toContain('outlives its run');
    expect(checkBash('npm test', 'oss:typescript-pro', NO_LINKS, true)).toBeNull();
  });
});

/**
 * @behavior Round 3 (user decision 2026-11-12, "allowlist"): a review agent's Bash runs only what the
 *   review allowlist names — the plugin's `reviewPrograms` (read, search and inspect tools), git and gh
 *   in their read forms, cd, the write tools on paths the write rules allow, the repo's test runs,
 *   builds, lint and type checks, interpreters on code the gate can see, and curl/wget that print.
 *   Anything else is refused, and so are shell constructs that hide what runs (eval, source, exec,
 *   trap, alias, xargs or find running a program off the allowlist …) and assignments of variables
 *   that change what runs or where (PATH, HOME, IFS, LD_*, NODE_OPTIONS, GIT_* …).
 * @business-rule R-266 round 3: a denylist missed `xargs rm`, `find -exec`, aliases and renamed
 *   programs; a reviewer gets a closed list instead, and a new tool is refused until the plugin adds it.
 */
describe('gate-agent-write: the review allowlist', () => {

  it.each([
    'rg -n foo src',
    'sed -n 1,5p src/app.ts',
    'jq .scripts package.json',
    'find src -name "*.ts" -type f',
    'find . -name "*.ts" -exec grep -n foo {} +',
    'ls src | xargs grep -n foo',
    'xargs cat < files.txt',
    'npm run build',
    'pnpm run lint',
    'yarn run typecheck',
    'bun run check',
    'yarn tsc --noEmit',
    'npx tsc --noEmit',
    'npx eslint src',
    'npx --no-install prettier --check .',
    'npx --no-install biome check src',
    'npx vitest run',
    'tsc --noEmit -p .',
    'eslint src',
    './node_modules/.bin/tsc --noEmit',
    'go vet ./...',
    'go build ./...',
    'cargo clippy',
    'cargo check',
    'swift build',
    'make test',
    'npm audit',
    'npm ls',
    'node -e "console.log(1)"',
    'python3 -c "print(1)"',
    `node ${ROOT}/scripts/check.js`,
    `python3 ${ROOT}/scripts/check.py`,
    `bash ${ROOT}/scripts/check.sh`,
    'bash -c "ls src && cat src/app.ts"',
    'curl -s https://example.com/x',
    'wget -qO- https://example.com/x',
    'timeout 60 npm test',
    'nice ls',
    'time npm test',
    'sleep 1',
    'export CI=1 && FOO=bar npm test',
    'set -euo pipefail',
    'unset FOO',
    '~/.oss/bin/oss-decrypt --type agents --name code-reviewer',
    '~/.oss/hooks/ensure-decrypt-cli.sh --long-step',
    'test -f "$HOME/.oss/config.json" && grep -qE x "$HOME/.oss/config.json" && echo ok',
    `mkdir -p ${TMP}/r && touch ${TMP}/r/x && cp src/a.ts ${TMP}/r/ && echo y | tee ${TMP}/r/y && mv ${TMP}/r/y ${TMP}/r/z && rm -rf ${TMP}/r`,
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each([
    "awk '{print $1}' src/app.ts",
    'perl -e 1',
    `ruby ${TMP}/x.rb`,
    'less src/app.ts',
    'vim src/app.ts',
    'nc -l 8080',
    `chmod +x ${TMP}/x.sh`,
    'npx prettier --write .',
    'npx eslint --fix src',
    'eslint src --fix',
    'npx biome check --write src',
    'npx cowsay hi',
    'npx vitest run -u',
    'npx jest --updateSnapshot',
    'npm exec vitest -- --update',
    'cargo clippy --fix',
    'node',
    `node ${TMP}/x.js`,
    `node ${ROOT}/missing.js`,
    `python3 ${TMP}/x.py`,
    `bash ${TMP}/x.sh`,
    'bash',
    'bash -s',
    'bash /dev/stdin',
    'sh -',
    'curl -o out.html https://example.com',
    'curl -sSLo out.html https://example.com',
    'curl --output=out.html https://example.com',
    'curl -O https://example.com/x',
    'wget https://example.com/x',
    'kill 123',
    'kill %1',
    `${TMP}/oss-decrypt --type agents`,
    'brew install jq',
    'zsh -c ls',
  ])('should refuse `%s` as off the allowlist', (cmd) => {
    const refusal = checkBash(cmd);
    expect(refusal?.rule).toBe('gate-agent-write');
    expect(refusal?.reason).toContain(OFF_LIST);
  });

  it.each([
    'eval ls',
    'source scripts/env.sh',
    '. ./scripts/env.sh',
    'exec ls',
    'trap "rm -rf src" EXIT',
    'alias ls=rm',
    'unalias ls',
    'shopt -s dotglob',
    'enable -n cd',
    'builtin cd /tmp',
    'coproc ls',
    'parallel rm ::: a b',
    'xargs rm < list.txt',
    'echo src | xargs rm -rf',
    'echo src | xargs -I{} sh -c "rm -rf {}"',
    'find . -exec rm {} \;',
    'find . -execdir mv {} x \;',
    'find . -exec sh -c "rm -rf src" \;',
    'find . -delete',
    'find . -fprint out.txt',
    'find . -fls out.txt',
    'find . -ok rm {} \;',
    'find . -okdir rm {} \;',
    'cd "$D" && ls',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each([
    'PATH=/tmp/evil:/usr/bin git status',
    'export PATH=/tmp/evil',
    'IFS=/ ls',
    'LD_PRELOAD=/tmp/x.so ls',
    'DYLD_INSERT_LIBRARIES=/tmp/x.dylib ls',
    'NODE_OPTIONS=--require=/tmp/x.js npm test',
    'PYTHONPATH=/tmp pytest',
    'PYTHONSTARTUP=/tmp/x.py python3 -c 1',
    'BASH_ENV=/tmp/x bash -c ls',
    'ENV=/tmp/x sh -c ls',
    'PROMPT_COMMAND=x ls',
    'SHELLOPTS=x ls',
    'BASHOPTS=x ls',
    'declare -x CDPATH=/tmp',
    'HOME=/tmp ls',
    'GIT_PAGER=cat git log',
    'readonly LD_LIBRARY_PATH=/tmp',
    'declare -n r=PATH; r=/tmp/evil; git status',
  ])('should refuse the variable in `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it('follows the setting, not a list in the code', () => {
    const facts = readCommand('rg foo src', ROOT, HOME);
    if ('unreadable' in facts) throw new Error('expected a readable command');
    const without = { ...SETTINGS, reviewPrograms: (SETTINGS.reviewPrograms ?? []).filter((p) => p !== 'rg') };
    expect(checkGateAgentBash(facts.parts[0], REVIEWER, without, SCOPE, NO_LINKS)?.reason).toContain(OFF_LIST);
    expect(checkGateAgentBash(facts.parts[0], REVIEWER, SETTINGS, SCOPE, NO_LINKS)).toBeNull();
  });

  it('never applies to a builder or the main agent', () => {
    expect(checkBash('awk 1 x && PATH=/x ls && eval ls', 'oss:typescript-pro')).toBeNull();
    expect(checkBash('awk 1 x && PATH=/x ls && eval ls', null)).toBeNull();
  });

  it('lets the pen tester stop its own background jobs only', () => {
    expect(checkBash('kill %1 && kill -TERM %2', 'oss:penetration-tester')).toBeNull();
    expect(checkBash('kill 123', 'oss:penetration-tester')?.reason).toContain(OFF_LIST);
  });
});

/**
 * @behavior The pen tester's sandbox is only a sandbox when the gate can see it is: a part runs
 *   entirely outside the reviewed repos only when its folder exists, every path it names — as an
 *   operand, an option's value (`--prefix=…`, `-C…`, the word after `--directory`), or a command string
 *   it hands to another program — is outside them, and nothing earlier in the call (HOME set, eval,
 *   source, ln) could have moved it. There it may run any program; anywhere else the allowlist holds.
 * @business-rule R-266 round 3 (A4): the round-3 pen-test commands that reached the repo stay refused.
 */
describe('gate-agent-write: the pen tester sandbox, round 3', () => {
  const PEN = 'oss:penetration-tester';
  const BOX = `cd ${TMP}/sandbox &&`;

  it.each([
    `${BOX} npm --prefix=${ROOT} run dev &`,
    `${BOX} make -C${ROOT} &`,
    `${BOX} make --directory=${ROOT} &`,
    `${BOX} pnpm -C${ROOT} dev &`,
    `${BOX} yarn --cwd=${ROOT} dev &`,
    `${BOX} npx --prefix=${ROOT} vite build --watch &`,
    `${BOX} tsc --project=${ROOT}/tsconfig.json --watch &`,
    `${BOX} tsc -p ${ROOT} --watch &`,
    `${BOX} python3 -m http.server --directory=${ROOT} &`,
    `${BOX} nohup bash -c "cd ${ROOT} && npm run dev" &`,
    `${BOX} eval cd ${ROOT}; npm run dev &`,
    `${BOX} HOME=${ROOT}; cd; npm run dev &`,
    `${BOX} ln -s ../rep? l; cd l; npm run dev &`,
    `${BOX} tmux new -d "cd ${ROOT} && npm run dev"`,
    `cd ${TMP}/missing-box && node server.js &`,
    `${BOX} brew services start postgresql`,
    `${BOX} brew services run redis`,
  ])('should refuse the pen tester `%s`', (cmd) => {
    expect(checkBash(cmd, PEN)?.rule).toBe('gate-agent-write');
  });

  it.each([
    `${BOX} node server.js &`,
    `${BOX} python3 -m http.server 8000 &`,
    `${BOX} nc -l 9999 &`,
    `${BOX} awk 1 notes.txt`,
  ])('should allow the pen tester `%s` in its sandbox', (cmd) => {
    expect(checkBash(cmd, PEN)).toBeNull();
  });

  it('should keep the allowlist for the pen tester inside the repo', () => {
    expect(checkBash('awk 1 src/app.ts', PEN)?.reason).toContain('review allowlist');
  });
});

/**
 * @behavior A review agent may not write any of `~/.oss` or `~/.claude` (the plugin's state, hooks and
 *   keys; Claude Code's settings, memory, agents and plugins), by edit tool, shell write, `ln`, or a
 *   git repo created there, and a wildcard in an `ln` operand is judged by its folder part.
 * @business-rule R-266 round 3 (B): a reviewer may not change the tools or memory of the next session.
 */
describe('gate-agent-write: the plugin and Claude Code user folders', () => {
  it.each([
    `${HOME}/.oss/config.json`,
    `${HOME}/.oss/hooks/ensure-decrypt-cli.sh`,
    `${HOME}/.claude/CLAUDE.md`,
    `${HOME}/.claude/projects/p/memory/MEMORY.md`,
    `${HOME}/.claude/agents/x.md`,
    `${HOME}/.claude/plugins/oss/hooks/x.sh`,
  ])('should refuse an edit tool writing %s', (file) => {
    expect(checkEdit(file)?.rule).toBe('gate-agent-write');
  });

  it.each([
    'echo x >> ~/.claude/CLAUDE.md',
    'cp /tmp/x ~/.oss/bin/oss-decrypt',
    `cd ${TMP} && ln -s ~/.claude/settings.json x`,
    `cd ${TMP} && ln -s ${TMP}/x ~/.oss/hooks/h`,
    `cd ${TMP} && ln -s /work/re* l`,
    `cd ${TMP} && git init ~/.claude/x`,
    `cd ${TMP} && git clone https://example.com/r.git ~/.oss/r`,
    `cd ~/.claude && git clone https://example.com/r.git`,
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it('should allow a git repo made in the temp folder', () => {
    expect(checkBash(`cd ${TMP} && git init ${TMP}/sbx`)).toBeNull();
  });
});

/**
 * @behavior `git config` with a shortened --global, --system or --file (git accepts any unique
 *   prefix), or the newer `git config set --global`, is refused like the full option.
 * @business-rule R-266 round 3 (D): a review agent may not change the user's git config.
 */
describe('gate-agent-write: shortened git config options', () => {
  it.each([
    'git config --glob user.name x',
    'git config --globa core.pager x',
    'git config --sys core.pager x',
    'git config --fil=/tmp/c core.pager x',
    'git config set --global core.pager x',
  ])('should refuse `cd /tmp && %s`', (cmd) => {
    expect(checkBash(`cd ${TMP} && ${cmd}`)?.rule).toBe('gate-agent-write');
  });
});

/**
 * @behavior a review agent's call must be read in full, and a loop may not set a risky variable.
 * @business-rule the gate judges what a reviewer runs; what it can't read, it can't judge.
 */
describe('gate-agent-write: the whole call', () => {
  it('refuses a review agent a call the gate could not read, and only a review agent', () => {
    expect(checkGateAgentUnreadable(REVIEWER, SETTINGS, 'bash runs a script only known when it runs')?.rule).toBe('gate-agent-write');
    expect(checkGateAgentUnreadable('oss:typescript-pro', SETTINGS, 'bash runs a script only known when it runs')).toBeNull();
    expect(checkGateAgentUnreadable(undefined, SETTINGS, 'bash runs a script only known when it runs')).toBeNull();
  });

  it.each(['for HOME in /tmp; do ls ~; done', 'for PATH in /tmp/evil; do ls; done', 'select GIT_DIR in a b; do git log; done'])(
    'refuses a review agent a loop setting a risky variable: %s',
    (command) => {
      expect(checkGateAgentCommand(REVIEWER, SETTINGS, command)?.rule).toBe('gate-agent-write');
      expect(checkGateAgentCommand('oss:typescript-pro', SETTINGS, command)).toBeNull();
    },
  );

  it('allows a review agent an ordinary loop', () => {
    expect(checkGateAgentCommand(REVIEWER, SETTINGS, 'for f in src/*.ts; do wc -l "$f"; done')).toBeNull();
  });
});

/**
 * @behavior A review agent can run each stack's usual checks in the repo it reviews (tests, type
 *   checks, linters in check mode, security scanners, read-only infra commands), and the write forms
 *   of the same tools (fix, write, autocorrect, installs, report files) stay refused.
 * @business-rule a reviewer checks the change with the stack's own tools but never rewrites it.
 */
describe('gate-agent-write: every stack\'s checks', () => {
  it.each([
    // Python
    'python3 -m pytest -q', 'python -m unittest', 'python3 -m mypy src', 'python3 -m ruff check .', 'python3 -m black --check .',
    'pytest tests', 'mypy src', 'ruff check src', 'ruff format --check src', 'pyright', 'black --check src', 'flake8 src',
    'pylint src', 'bandit -r src', 'pip-audit', 'pip list', 'pip show requests', 'uv run --frozen pytest', 'uv run --no-sync mypy src', 'poetry run pytest', 'tox',
    // Java / Kotlin
    'mvn test', 'mvn verify', 'mvn compile', 'mvn dependency:tree', './mvnw test', './gradlew test', './gradlew check',
    './gradlew build', './gradlew dependencies', 'gradle test', 'gradle check', 'javac -d /tmp/out Main.java', 'ktlint', 'detekt',
    // Ruby
    'ruby script/check.rb', 'bundle exec rspec', 'bundle exec rubocop', 'bundle exec rake test', 'rspec', 'rubocop', 'rake test', 'brakeman', 'bundler-audit',
    // PHP
    'php bin/check.php', 'php -l src/a.php', 'phpunit', 'vendor/bin/phpunit', 'vendor/bin/phpstan analyse', 'vendor/bin/psalm',
    'vendor/bin/php-cs-fixer fix --dry-run', 'composer validate', 'composer audit', 'composer show',
    // Go
    'go test ./...', 'go vet ./...', 'go build ./...', 'go list ./...', 'go mod verify', 'golangci-lint run', 'staticcheck ./...', 'govulncheck ./...',
    // Rust
    'cargo test', 'cargo check', 'cargo clippy', 'cargo build', 'cargo audit', 'cargo tree', 'rustc --version',
    // Swift / iOS
    'swift build', 'swift test', 'xcodebuild test -scheme App', 'xcodebuild build', 'xcodebuild -list', 'swiftlint', 'swiftformat --lint .',
    // Flutter / Dart
    'flutter test', 'flutter analyze', 'dart analyze', 'dart test', 'dart format --output=none .',
    // .NET
    'dotnet test', 'dotnet build', 'dotnet list package',
    // JS / TS
    'npm test', 'npm run lint', 'pnpm test', 'yarn test', 'bun test', 'npx tsc --noEmit', 'npx eslint src', 'npx vitest run',
    'npx jest', 'npx --no-install prettier --check .', 'npx --no-install biome check src', 'npx playwright test', 'npm audit', 'npm ls', 'npm outdated', 'node scripts/check.js',
    // security and static tools
    'semgrep --config auto', 'gitleaks detect', 'trivy fs .', 'osv-scanner -r .', 'shellcheck hooks/x.sh', 'hadolint Dockerfile',
    // infra, read only
    'docker ps', 'docker images', 'docker inspect web', 'docker logs web', 'docker compose ps', 'docker compose config',
    'kubectl get pods', 'kubectl describe pod web', 'kubectl logs web', 'terraform validate', 'terraform plan', 'terraform fmt -check',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each([
    'ruff check --fix src', 'ruff format src', 'black src', 'python3 -m black src', 'uv run black src', 'uv pip install x', 'pip install x', 'poetry add x',
    'mvn deploy', './gradlew publish', 'ktlint -F', 'ktlint --format', 'detekt --auto-correct',
    'rubocop -a', 'rubocop -A', 'rubocop --autocorrect-all', 'bundle install', 'bundle exec rubocop -a',
    'vendor/bin/php-cs-fixer fix', 'vendor/bin/psalm --alter', 'composer install', 'composer require x',
    'go mod tidy', 'go get x', 'golangci-lint run --fix', 'cargo fix', 'cargo clippy --fix', 'cargo add x',
    'swiftlint --fix', 'swiftlint autocorrect', 'swiftformat .', 'dart format .', 'dart fix --apply', 'flutter pub get',
    'dotnet add package x', 'dotnet format',
    'npx prettier --write .', 'npx eslint --fix src', 'npm install', 'npx playwright install',
    'semgrep --config auto --autofix', 'semgrep --config auto -o report.json', 'gitleaks detect --report-path report.json', 'trivy fs -o out.json .',
    'docker run alpine true', 'docker rm web', 'docker compose up', 'kubectl apply -f x.yaml', 'kubectl delete pod web',
    'terraform apply', 'terraform fmt', 'terraform plan -out=plan.bin',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it('should say where a user can add a program', () => {
    expect(checkBash('perl -e 1')?.reason).toContain('toolGates.reviewPrograms in ~/.oss/config.json');
  });
});

/**
 * @behavior a review agent's own setup step is recognised only when it is, line for line, a bash
 *   block of its own agent file, the offload prompt path filled in with a mktemp-made path.
 * @business-rule the exception for setup steps can't be stretched to run anything else.
 */
describe('gate-agent-write: a review agent\'s own setup steps', () => {
  const FILE = [
    'Step 0:',
    '```bash',
    'AGENT_ID="oss:code-reviewer"',
    '# a comment',
    'node "$MODEL_CHECK" --agent "$AGENT_ID"',
    '```',
    '   ```bash',
    "   PROMPT_FILE='<path printed in step 1>'",
    '   rm -f -- "$PROMPT_FILE"',
    '   ```',
  ].join('\n');

  it('should know the calling agent\'s own agent file, any agent (round 4, L)', () => {
    expect(ownAgentFile('oss:code-reviewer')).toBe('code-reviewer.md');
    expect(ownAgentFile('oss:typescript-pro')).toBe('typescript-pro.md');
    expect(ownAgentFile('oss:../x')).toBeNull();
    expect(ownAgentFile(undefined)).toBeNull();
  });

  it.each([
    'AGENT_ID="oss:code-reviewer"\nnode "$MODEL_CHECK" --agent "$AGENT_ID"',
    '  AGENT_ID="oss:code-reviewer"\n\n  node "$MODEL_CHECK" --agent "$AGENT_ID"  ',
    "PROMPT_FILE='/var/folders/ab/cd12/T/oss-offload.Xy12Ab/prompt.md'\nrm -f -- \"$PROMPT_FILE\"",
  ])('should recognise %j', (command) => {
    expect(isOwnSetupStep(command, FILE, TEMP)).toBe(true);
  });

  it.each([
    'AGENT_ID="oss:typescript-pro"\nnode "$MODEL_CHECK" --agent "$AGENT_ID"',
    'AGENT_ID="oss:code-reviewer"\nnode "$MODEL_CHECK" --agent "$AGENT_ID"; rm -rf src',
    'AGENT_ID="oss:code-reviewer"\nnode "$MODEL_CHECK" --agent "$AGENT_ID"\nrm -rf src',
    "PROMPT_FILE='/tmp/oss-offload.x/../../work/repo/prompt.md'\nrm -f -- \"$PROMPT_FILE\"",
    "PROMPT_FILE='/tmp/../work/repo/oss-offload.x/prompt.md'\nrm -f -- \"$PROMPT_FILE\"",
    "PROMPT_FILE='/work/repo/src/app.ts'\nrm -f -- \"$PROMPT_FILE\"",
    "PROMPT_FILE='/tmp/oss-offload.x/prompt.md'; rm -rf src; ''\nrm -f -- \"$PROMPT_FILE\"",
  ])('should not recognise %j', (command) => {
    expect(isOwnSetupStep(command, FILE, TEMP)).toBe(false);
  });
});

/**
 * @behavior a reviewPrograms entry with a subcommand matches the call's subcommand wherever the
 *   call's options put it, and an entry's option (`--check`) anywhere in the call.
 * @business-rule options such as `-q` don't change what a check does, so they don't take it off the list.
 */
describe('gate-agent-write: entries with options before or between their words', () => {
  it.each([
    'mvn -q test', 'mvn -B -q verify', 'mvn -pl core test', 'mvn -Dskip=true -P ci verify', './gradlew --offline test',
    'black src --check', 'black --check src', 'ruff --quiet check src', 'cargo -q test',
    'terraform -chdir=infra validate', 'npm --silent run lint', 'pytest -q tests', 'dotnet --nologo test',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each(['black src', 'ruff check --fix src', 'mvn -q deploy', 'cargo -q fix', 'terraform -chdir=infra apply', 'mvn -pl test deploy', `php ${TMP}/evil.php -l`])(
    'should refuse `%s`',
    (cmd) => {
      expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
    },
  );
});

/**
 * Round 4 (ship gates): a program on the review allowlist is never a way to write a file or run
 * another program. @behavior each attack the gates found is refused; the read forms stay allowed.
 * @business-rule a reviewer may not change the repo it judges or the review's own files, whatever
 *   program it goes through.
 */
describe('gate-agent-write: round 4, runners run what they name (A)', () => {
  it.each([
    `uv run --frozen cp /tmp/x ${ROOT}/f`,
    'yarn cp /tmp/x src/f',
    `npx tee ${ROOT}/f`,
    'npx rm -rf ~/.oss/gate-state/s1',
    'poetry run rm src/app.ts',
    'bundle exec tee ~/.oss/config.json',
    'npx cp /tmp/x ~/.oss/config.json',
    'npx env tee src/f',
    'uv run --frozen env sort -o ~/.oss/config.json x',
    'pnpm exec tee src/f',
    'npm exec -- tee src/f',
    'bunx tee src/f',
    'pipenv run tee src/f',
    'npx timeout 5 tee src/f',
    'npx xargs rm',
    'npx gh pr merge 1',
    'yarn git commit -m x',
    'env tee src/f', 'timeout 5 tee src/f', 'nice tee src/f', 'command tee src/f', 'echo x | xargs tee src/f', 'time sort -o src/f x',
    'env -C src touch f', 'env sort -o ~/.oss/config.json x', 'timeout 5 sort -o src/f x',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });
});

describe('gate-agent-write: round 4, allowed programs that write or run (B)', () => {
  it.each([
    'sort -o ~/.oss/config.json x', 'sort --output=src/a x', 'sort -osrc/a x', 'sort -no src/a x', `sort -o ${TMP}/out x`,
    'sort --compress-program=sh x', 'sort -T /tmp x', 'uniq a src/b', `uniq ${TMP}/a ${TMP}/b`, 'xxd -r a src/b', 'xxd a src/b',
    'tree -o src/t', 'time -o src/t ls', 'time --output=src/t ls', 'command time -o src/t ls', 'yq -i .a=1 x.yml', 'yq --inplace .a=1 x.yml',
    'file -C -m x', 'sed -f s.sed x', 'sed --file=s.sed x', 'rg --pre ./x foo', 'rg --pre-glob "*.ts" --pre cat foo', 'go test -exec /tmp/x ./...',
    'date -s 2020-01-01',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['sort -n x', 'sort -k2 -u x', 'uniq -c x', 'xxd x', 'tree -L 2', 'sed -n 1,5p x', 'rg -n foo src', 'go test ./...', 'yq .a x.yml', 'file x', 'time ls'])(
    'should still allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );
});

describe('gate-agent-write: round 4, every goal of a build tool (C)', () => {
  it.each([
    'mvn test deploy', 'mvn -pl core test deploy', 'mvn test install', 'mvn test versions:set -DnewVersion=9', 'gradle test publish',
    './gradlew test publish', './gradlew build wrapper', 'gradle dependencies --write-locks', 'gradle build --update-locks a:b', 'cargo audit fix',
    'xcodebuild test install', 'rake test release', 'mvn deploy test',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['./gradlew :app:test', './gradlew :app:core:check build', 'mvn clean verify', 'mvn compile test-compile', 'gradle check dependencies', 'mvn dependency:tree', 'xcodebuild build-for-testing'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );
});

describe('gate-agent-write: round 4, more write options (D)', () => {
  it.each([
    'ruff check --add-noqa src', 'ruff check -o out.txt src', 'ruff check --output-file=out.txt src', 'flake8 --output-file out.txt', 'pip-audit -o out.json',
    'mypy --junit-xml out.xml src', 'mypy --html-report r src', 'mypy --install-types', 'pytest --basetemp=src/t', 'pytest --debug=out.log', 'npx eslint -o out.txt src',
    'npx eslint --output-file out.txt src', 'go build -o bin/x ./...', 'go test -fuzz=Fuzz ./...', 'mvn -l out.log test', 'rspec --out out.txt', 'rspec -o out.txt',
    'brakeman -o out.json', 'rubocop --auto-gen-config', 'vendor/bin/phpstan analyse --generate-baseline', 'vendor/bin/psalm --set-baseline=b.xml',
    'flutter test --update-goldens', 'golangci-lint run --out-format=json:out.json', 'swiftformat --lint --output out .',
    `xcodebuild test -resultBundlePath ${ROOT}/r`, `xcodebuild build -derivedDataPath ${ROOT}/dd`, 'javac -processorpath p.jar -d /tmp/out A.java', 'javac A.java',
    'javac -d src/out A.java', 'tsc', 'npx tsc', 'tsc --init', 'tsc --outDir out', 'npx tsc --outFile out.js', 'tsc -b', 'tsc --noEmit --incremental',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each([
    'tsc --noEmit', 'npx tsc --noEmit -p tsconfig.json', 'tsc -b --dry', 'tsc --showConfig', 'tsc --noEmit --listFiles', 'javac -d /tmp/out A.java',
    `xcodebuild test -scheme App -derivedDataPath ${TMP}/dd`, 'pytest -q', 'mypy src', 'ruff check src',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 4, runners judged by what really runs (E)', () => {
  it.each(['npx cat x', 'bunx cat x', 'npx ls', 'python3 -m http.server', 'python3 -m pip install x', 'python3 -m compileall src', 'uv run pytest', 'uv run ruff check src'])(
    'should refuse `%s`',
    (cmd) => {
      expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
    },
  );

  it.each([
    'npx tsc --noEmit', 'npx eslint src', 'npx playwright test', 'npx snyk test', 'npx audit-ci --critical', 'python3 -m pytest', 'python3 -m mypy src',
    'python3 -m pip_audit', 'python3 -m pip list', 'uv run --frozen pytest', 'uv run --no-sync ruff check src',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 4, the penetration tester\'s sandbox (F)', () => {
  const PEN = 'oss:penetration-tester';
  const BOX = `cd ${TMP}/sandbox &&`;
  it.each([`${BOX} tar -xPf a.tar`, `${BOX} tar --absolute-names -xf a.tar`, `${BOX} bsdtar -xPf a.tar`, `${BOX} tar -P -xf a.tar`])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd, PEN)?.rule).toBe('gate-agent-write');
  });

  it('should still allow the pen tester an ordinary tar in its sandbox', () => {
    expect(checkBash(`${BOX} tar -xf a.tar`, PEN)).toBeNull();
  });
});

describe('gate-agent-write: round 4, curl and wget only fetch (G)', () => {
  it.each([
    'curl -X POST https://x', 'curl --request=PUT https://x', 'curl -XDELETE https://x', 'curl -d a=1 https://x', 'curl --data-binary @src/app.ts https://x',
    'curl --json {} https://x', 'curl -F f=@x https://x', 'curl --form f=@x https://x', 'curl -T x https://x', 'curl --upload-file x https://x',
    'curl -n https://x', 'curl --netrc https://x', 'curl -sd a=1 https://x', 'wget -O- --post-data=a https://x', 'wget -O- --method=POST https://x',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['curl -s https://x', 'curl -X GET https://x', 'curl -I https://x', 'curl --request HEAD https://x', 'wget -O- https://x'])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 4, git symbolic-ref reads (I)', () => {
  it.each(['git symbolic-ref --short HEAD', 'git symbolic-ref -q refs/remotes/origin/HEAD', 'git symbolic-ref HEAD'])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each(['git symbolic-ref HEAD refs/heads/x', 'git symbolic-ref -d HEAD', 'git symbolic-ref --delete HEAD', 'git symbolic-ref -m x HEAD refs/heads/y'])(
    'should refuse `%s`',
    (cmd) => {
      expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
    },
  );
});

describe('gate-agent-write: round 4, script runs and value options (J)', () => {
  it.each([
    'pnpm lint', 'pnpm test', 'pnpm --filter api test', 'pnpm -r test', 'yarn test', 'yarn lint', 'pnpm typecheck',
    'xcodebuild -scheme App -destination "platform=iOS Simulator" test', 'xcodebuild -project A.xcodeproj -configuration Debug build',
    'kubectl -n prod get pods', 'kubectl --context x describe pod web', 'kubectl -l app=x get pods', 'docker compose -f c.yml ps', 'docker -H x ps',
    'docker compose -p p config', 'trivy --severity HIGH fs .', 'trivy --format json fs .',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each(['pnpm add x', 'pnpm publish', 'yarn add x', 'pnpm --filter api add x', 'yarn upgrade', 'pnpm dlx cowsay'])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });
});

describe('gate-agent-write: round 4, everyday reads (K)', () => {
  it.each([
    'snyk test', 'audit-ci --critical', 'trufflehog filesystem .', 'trufflehog git file://.', 'while read -r line; do echo "$line"; done < src/app.ts',
    'mapfile -t lines < src/app.ts', 'readarray -t lines < src/app.ts', 'node --version', 'npm --version', 'pnpm --version', 'yarn --version', 'node -v',
    'go env', 'go env GOPATH', 'gofmt -l .', 'cargo fmt --check', 'rustfmt --check src/main.rs', 'dotnet format --verify-no-changes', 'mktemp', 'mktemp -d',
    `mktemp -p ${TMP}`, 'printenv', 'printenv PATH',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each([
    'read -r line > src/f', 'read -r PATH', 'mapfile -t HOME < x', 'go env -w GOFLAGS=x', 'gofmt -w .', 'gofmt -l -w .', 'cargo fmt', 'rustfmt src/main.rs',
    'dotnet format', 'mktemp src/x.XXXX', `mktemp -p ${ROOT}`, 'mktemp --tmpdir=~/.oss', 'awk 1 x', 'snyk monitor', 'trufflehog filesystem . --json > src/x',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });
});

/**
 * Round 5 (ship gates): the holes the security, code-review and performance gates confirmed.
 * @behavior each confirmed attack is refused for a review agent; the everyday read and check forms
 *   stay allowed.
 * @business-rule a program on the review allowlist is never a way to write the repo or the user's
 *   own files, or to run another program the gate has not checked.
 */
describe('gate-agent-write: round 5, long options shortened (sec H2)', () => {
  it.each([
    'sort --out=src/a x', 'sort --outp src/a x', 'sort --compress-prog=sh x', 'sort --temp=/tmp x', 'file --comp -m x', 'file --compile -m x',
    'pytest --basete=src/t', 'mypy --install-t', 'ruff check --output-f=x src', 'eslint --output-fi x src', 'black --check --wri .',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['sort --numeric-sort x', 'sort -n x', 'pytest --cov', 'pytest --co -q', 'semgrep --json --config auto', 'snyk test --json'])('should still allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, go flags (sec H3, CR M5)', () => {
  it.each([
    'go test --exec=/tmp/x ./...', 'go test -toolexec /tmp/x ./...', 'go vet -vettool=/tmp/x ./...', 'go build -overlay o.json ./...',
    'go test -modfile=/tmp/go.mod ./...', 'go build -pgo=/tmp/p ./...', 'go -C /tmp test ./...', 'go test --toolexec=/tmp/x ./...', 'go build --o=bin/x ./...',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['go test -race ./...', 'go vet ./...', 'go test -run TestX ./...'])('should still allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, what find -exec and xargs run (CR H3)', () => {
  it.each([
    'find src -exec sort -o ~/.oss/config.json {} \;',
    'find src -exec env tee x {} \;',
    'find src -exec rm {} \;',
    'find src -exec tee {} +',
    'find src -execdir sed -i s/a/b/ {} \;',
    'find src -exec uniq {} src/out \;',
    'find src -exec timeout 5 cat {} \;',
    'find src -exec xargs rm \;',
    'find src -exec find . -delete \;',
    'ls | xargs uniq',
    'ls | xargs xxd',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['find src -name "*.ts" -exec wc -l {} \;', 'find src -exec grep -n foo {} +', 'find src -type f -exec ls -lh {} \;', 'ls | xargs wc -l'])(
    'should still allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );
});

describe('gate-agent-write: round 5, setters with names only known when they run (sec H1)', () => {
  it.each([
    'printf -v "$(echo X)" %s y', 'printf -v"$N" %s y', 'declare "$(echo X)=1"', 'export "$N=1"', 'local "$N"', 'typeset "$N"=1', 'readonly "$N"',
    'read -r "$N"', 'read -a "$N"', 'mapfile -t "$N" < src/app.ts', 'readarray "$N" < src/app.ts', 'unset "$N"',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['read -r line', 'declare x=1', 'unset x', 'printf -v out %s y', 'export X=1'])('should still allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, the penetration tester\'s sandbox (sec H5, H6)', () => {
  const PEN = 'oss:penetration-tester';
  const BOX = `cd ${TMP}/sandbox &&`;
  it.each([
    `${BOX} curl -o ~/.oss/config.json https://x`,
    `${BOX} curl -o ${HOME}/.claude/settings.json https://x &`,
    `${BOX} tar --absolute-paths -xf a.tar`,
    `${BOX} tar --absolute-n -xf a.tar`,
    `${BOX} tar --abs -xf a.tar`,
    `${BOX} bsdtar --insecure -xf a.tar`,
    `${BOX} bsdtar --insec -xf a.tar`,
    `${BOX} bsdtar -xf a.tar -s ",^,/,"`,
    `${BOX} tar -xf a.tar --transform "s,^,/,"`,
    `${BOX} tar -xf a.tar --xform=s,^,/,`,
  ])('should refuse the pen tester `%s`', (cmd) => {
    expect(checkBash(cmd, PEN)?.rule).toBe('gate-agent-write');
  });

  it.each([`${BOX} tar -xf a.tar`, `${BOX} curl -o out.html https://x`, `${BOX} tar -czf out.tgz -s ",^,x/," dir`])('should still allow the pen tester `%s`', (cmd) => {
    expect(checkBash(cmd, PEN)).toBeNull();
  });
});

describe('gate-agent-write: round 5, test runs and python -m stay in the repo (sec H4, CR M5)', () => {
  it.each([
    'pytest -c /tmp/evil.ini', 'pytest --rootdir=/tmp/x', 'pytest /tmp/t.py', 'pytest -p /tmp/plugin', 'npx vitest --config /tmp/v.ts',
    'npx vitest -c=/tmp/v.ts', 'jest -c ~/x.js', 'cargo test --manifest-path /tmp/x/Cargo.toml', 'go test /tmp/x', 'make -f /tmp/Makefile test',
    'make -C /tmp test', 'npm --prefix /tmp test', `cd ${TMP} && pytest`, `cd ${TMP} && bash run-test.sh`, `bash ${TMP}/run-test.sh`,
    `cd ${TMP} && python3 -m pytest`, `cd ${TMP} && python3 -m mypy x`, 'python3 -m pytest ../other', 'npm test --script-shell=/tmp/sh',
    'npm test --script-sh /tmp/sh', 'cargo test --config build.rustc-wrapper=/tmp/x', 'mvn -Dexec.executable=/tmp/x test', 'mvn test -D exec.args=x',
    'node -r ./x.js -e 1', 'node --require=./x.js -e 1', 'node --import ./x.mjs -e 1', 'npm_config_script_shell=/tmp/x npm test',
    'NPM_CONFIG_PREFIX=/tmp npm test', 'export npm_config_userconfig=/tmp/x', 'pytest "$DIR"',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each([
    'pytest tests/test_a.py::test_x', 'pytest -k "not slow"', 'go test ./...', 'make test', 'cargo test', 'npm test', `pytest -c ${ROOT}/pytest.ini`,
    'bash scripts/run-test.sh', 'python3 -m pytest -q', 'npx vitest run src', 'node -e 1',
  ])('should still allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, npx runs only what the repo installed (CR H2)', () => {
  it.each(['npx gitleaks detect --source .', 'npx trufflehog git file://.', 'npx prettier --check .', 'npx biome check .', 'bunx prettier --check .', 'npm exec biome check .'])(
    'should refuse `%s`',
    (cmd) => {
      expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
    },
  );

  it.each(['npx --no-install prettier --check .', 'npx tsc --noEmit', 'npx eslint src', 'pnpm exec prettier --check .', 'gitleaks git .', 'gitleaks dir .', 'trivy config .', 'snyk code test'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );
});

describe('gate-agent-write: round 5, runners inside runners (perf F3)', () => {
  it('should refuse more than four runners deep', () => {
    expect(checkBash('poetry run poetry run poetry run poetry run poetry run pytest')?.rule).toBe('gate-agent-write');
  });

  it('should allow a runner that runs a check', () => {
    expect(checkBash('poetry run pytest')).toBeNull();
  });
});

describe('gate-agent-write: round 5, option values in the user\'s own files (sec M1, CR M6)', () => {
  it.each([
    'pytest -o cache_dir=~/.oss/x', 'mypy --cache-dir=~/.oss/x src', 'eslint --cache --cache-location ~/.claude/x src', `ruff check --cache-dir ${HOME}/.oss/c src`,
    'echo x > ~/.zshrc', 'echo x >> ~/.bashrc', 'cp x ~/.npmrc', 'echo k | tee -a ~/.ssh/authorized_keys', 'mkdir ~/.config/x', 'echo x > ~/.profile',
    'echo x > ~/.zshenv', 'echo x > ~/.bash_profile', 'touch ~/.zprofile',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['cat ~/.oss/config.json', 'ls ~/.claude', 'grep -rn x ~/.config/git', 'cat ~/.zshrc', 'mypy --cache-dir=/tmp/m src'])('should still allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, sed runs nothing (sec M2)', () => {
  it.each(["sed '1e touch x' src/app.ts", "sed -n '1e date' src/app.ts", "sed -e p -e '$e ls' src/app.ts"])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it("should still allow `sed -n '1,5p'`", () => {
    expect(checkBash("sed -n '1,5p' src/app.ts")).toBeNull();
  });
});

describe('gate-agent-write: round 5, Java and Xcode checks (CR M2)', () => {
  it.each([
    './gradlew test --tests "a.B"', 'gradle test --max-workers 2', 'mvn -T 4 test', 'mvn -rf :core test', 'xcodebuild test -enableCodeCoverage YES -scheme App',
    'mvn checkstyle:check', 'mvn jacoco:report', 'mvn spotless:check', './gradlew ktlintCheck', './gradlew detekt', './gradlew spotlessCheck',
    './gradlew jacocoTestReport', './gradlew integrationTest', 'xcodebuild -showBuildSettings', 'xcodebuild -version',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each(['mvn spotless:apply', './gradlew spotlessApply', './gradlew updateCheck publish', 'mvn release:report deploy'])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });
});

describe('gate-agent-write: round 5, script names that change things (CR M3)', () => {
  it.each([
    'npm run deploy', 'npm run lint:fix', 'pnpm format', 'pnpm run db:migrate', 'yarn run release', 'yarn prepare', 'npm run seed', 'pnpm check:write',
    'npm run test:update', 'pnpm run build:publish', 'npm run-script update',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['npm run lint', 'npm run test:unit', 'pnpm build', 'yarn test', 'pnpm run typecheck'])('should still allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, curl and wget (CR M4, LOW)', () => {
  it.each([
    "curl -w '%output{/tmp/x}' https://x", 'curl --write-out=%output{src/x} https://x', 'wget -O- -e robots=off https://x', 'wget -O- --execute=x https://x',
    'wget -O- --config=x https://x', 'wget -O- --save-cookies=c https://x', 'wget -O- --warc-file=w https://x', 'wget -O- --rejected-log=r https://x',
    'wget -O- --hsts-file=h https://x', 'curl -o src/x https://x', 'curl -o /dev/nullx https://x',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(["curl -o /dev/null -s -w '%{http_code}' https://x", 'curl -so /dev/null https://x', 'curl --output /dev/null https://x', 'curl -o/dev/null https://x'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );
});

describe('gate-agent-write: round 5, shell state builtins (LOW)', () => {
  it.each([': noop', 'ls; exit 0', 'return 0', 'true && exit'])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 5, the offload prompt path macOS makes (CR M1)', () => {
  const FILE = ['```bash', "PROMPT_FILE='<path printed in step 1>'", 'rm -f -- "$PROMPT_FILE"', '```'].join('\n');

  it('should recognise a prompt path in a real `mktemp -d -t oss-offload.XXXXXX` folder', () => {
    const dir = execFileSync('mktemp', ['-d', '-t', 'oss-offload.XXXXXX'], { encoding: 'utf8' }).trim();
    try {
      const temp = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
      expect(isOwnSetupStep(`PROMPT_FILE='${dir}/prompt.md'\nrm -f -- "$PROMPT_FILE"`, FILE, temp)).toBe(true);
    } finally {
      fs.rmdirSync(dir);
    }
  });

  it.each([
    "PROMPT_FILE='/var/folders/ab/cd12/T/oss-offload.XXXXXX.Ab12/prompt.md'",
    "PROMPT_FILE='/tmp/oss-offload.Ab12/prompt.md'",
  ])('should recognise %s', (line) => {
    expect(isOwnSetupStep(`${line}\nrm -f -- "$PROMPT_FILE"`, FILE, TEMP)).toBe(true);
  });

  it.each([
    "PROMPT_FILE='/var/folders/ab/../../work/repo/oss-offload.X/prompt.md'",
    "PROMPT_FILE='oss-offload.X/prompt.md'",
    "PROMPT_FILE='/tmp/oss-offload.X/other.md'",
    "PROMPT_FILE='/tmp/oss-offload.X/prompt.md' x",
    // round 6 (CR I3): only inside the temp folders
    "PROMPT_FILE='/custom/tmp/oss-offload.Ab12/prompt.md'",
    "PROMPT_FILE='/work/repo/oss-offload.Ab12/prompt.md'",
  ])('should not recognise %s', (line) => {
    expect(isOwnSetupStep(`${line}\nrm -f -- "$PROMPT_FILE"`, FILE, TEMP)).toBe(false);
  });

  it('should not recognise a prompt folder in a reviewed repo or the home folder that sits in a temp folder', () => {
    const step = (dir: string) => `PROMPT_FILE='${dir}/oss-offload.Ab12/prompt.md'\nrm -f -- "$PROMPT_FILE"`;
    expect(isOwnSetupStep(step('/tmp/repo'), FILE, TEMP, ['/tmp/repo', '/tmp/home'])).toBe(false);
    expect(isOwnSetupStep(step('/tmp/home'), FILE, TEMP, ['/tmp/repo', '/tmp/home'])).toBe(false);
    expect(isOwnSetupStep(step('/tmp'), FILE, TEMP, ['/tmp/repo', '/tmp/home'])).toBe(true);
  });
});

/**
 * Round 6 (user choice 2): a review agent writes only to the temp folders (/tmp, /private/tmp, the
 * session's TMPDIR) and the /dev sinks; the penetration tester's sandbox sits inside them.
 * @behavior every write route the gate reads (redirects, write tools, edit tools, output option
 *   values, path-like variable values, runner and find -exec commands, mktemp, git clone) lands in
 *   a temp folder, or the call is refused.
 * @business-rule a reviewer may not change anything that outlives its run: not the repo, not the
 *   home folder, not the programs on PATH.
 */
describe('gate-agent-write: round 6, writes only to the temp folders (user choice 2)', () => {
  it.each([
    'ln -s /usr/bin/true ~/bin/node', `cp ${TMP}/x ~/.local/bin/node`, 'echo x | tee ~/bin/node', `cp ${TMP}/x ~/.gradle/init.d/a.gradle`,
    'echo x > ~/.cargo/config.toml', `cp ${TMP}/x ~/Library/LaunchAgents/x.plist`, 'echo x >> ~/.bash_aliases', 'echo x > ~/.yarnrc.yml',
    'echo x > /opt/homebrew/bin/node', `cp ${TMP}/x /usr/local/bin/node`, 'mkdir ~/newdir', 'touch /var/tmp/x', 'mktemp -p ~/x', 'mktemp ~/x.XXXX',
    'git clone https://example.invalid/r ~/c', 'find src -exec cp {} ~/bin/ \;', 'ls | xargs -I{} cp {} ~/bin/x', `ln -s ${TMP}/a ${TMP}/b; ln /etc/hosts ${TMP}/c`,
    `echo x > ${TMP}/../Users/x`,
    // the node the hooks run, written at SessionStart: plain writes and writes through allowed programs
    'echo /tmp/evil > ~/.oss/node-path', `cp ${TMP}/x ~/.oss/node-path`, 'echo x | tee ~/.oss/node-path', 'sort -o ~/.oss/node-path a.txt',
    'sort --o=~/.oss/node-path a.txt', `ln -sf ${TMP}/x ~/.oss/node-path`, "sed -n 'w ~/.oss/node-path' a.txt", 'tree -o ~/.oss/node-path',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each([
    `echo x > ${TMP}/r.md`, `mkdir -p ${TMP}/r/x`, `cp src/app.ts ${TMP}/app.ts`, 'ls 2>/dev/null', 'echo x > /dev/stderr', 'echo x > /dev/fd/2',
    'mktemp', 'mktemp -d', `mktemp -p ${TMP}`, 'echo x > /var/folders/xy/T/oss-offload.Ab12/prompt.md', `cd ${TMP} && git clone https://example.invalid/r ${TMP}/c`,
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it('should refuse an edit outside the temp folders and allow one inside', () => {
    expect(checkEdit(`${HOME}/bin/node`)?.rule).toBe('gate-agent-write');
    expect(checkEdit('/usr/local/bin/node')?.rule).toBe('gate-agent-write');
    expect(checkEdit(`${HOME}/.oss/node-path`)?.rule).toBe('gate-agent-write');
    expect(checkEdit(`${OWN}/review.md`)).toBeNull();
  });

  it('should never count the home folder as a temp folder, even when TMPDIR holds it', () => {
    const wide = { ...SCOPE, temp: [...TEMP, '/home'] };
    const write = (cmd: string) => {
      const facts = readCommand(cmd, ROOT, HOME);
      if ('unreadable' in facts) throw new Error('expected a readable command');
      return checkGateAgentBash(facts.parts[0], REVIEWER, SETTINGS, wide, NO_LINKS);
    };
    expect(write('echo x > ~/x')?.rule).toBe('gate-agent-write');
    expect(write('echo x > /home')?.rule).toBe('gate-agent-write');
    expect(checkGateAgentEdit({ filePath: `${HOME}/.oss/node-path` }, REVIEWER, SETTINGS, wide, NO_LINKS)?.rule).toBe('gate-agent-write');
    expect(write('echo x > /home/other/x')).toBeNull();
  });

  it('should refuse a temp path that is a link out of the temp folders', () => {
    const out = linkedDisk({ [`${TMP}/link`]: `${HOME}/bin` });
    expect(checkBash(`echo x > ${TMP}/link/node`, REVIEWER, out)?.rule).toBe('gate-agent-write');
  });

  it.each([
    `pytest -o cache_dir=${HOME}/.cache/x`, `mypy --cache-dir=${HOME}/c src`, `npx eslint --cache --cache-location ${HOME}/c src`, `trivy fs . --output ${HOME}/x.json`,
    'RUFF_CACHE_DIR=~/c ruff check src', 'env MYPY_CACHE_DIR=~/c mypy src', 'GOCACHE=~/gc go test ./...', 'PYLINTHOME=~/p pylint src', 'export RUFF_CACHE_DIR=~/c',
  ])('should refuse the output or cache path in `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['RUFF_CACHE_DIR=/tmp/c ruff check src', 'NODE_ENV=test npm test', 'kubectl get pods -o json', 'pytest -o addopts=-q', `mypy --cache-dir=${TMP}/m src`, 'dart format --output=none .'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );

  it.each([`cd ${HOME}/box && node server.js &`, `cd ${TMP}/sandbox && cp x ~/bin/node`, `cd ${TMP}/sandbox && node s.js ${HOME}/bin/node &`])(
    'should refuse the pen tester `%s` (its sandbox sits in the temp folders)',
    (cmd) => {
      expect(checkBash(cmd, 'oss:penetration-tester')?.rule).toBe('gate-agent-write');
    },
  );

  it('should still allow the pen tester its temp sandbox', () => {
    expect(checkBash(`cd ${TMP}/sandbox && node server.js &`, 'oss:penetration-tester')).toBeNull();
  });
});

describe('gate-agent-write: round 6, variables that change what runs (sec L-A, M-B)', () => {
  it.each([
    'GOFLAGS=-toolexec=x go test ./...', 'RUSTC_WRAPPER=x cargo test', 'RUSTFLAGS=x cargo test', 'CARGO_TARGET_DIR=/tmp/t cargo test', 'JAVA_TOOL_OPTIONS=x mvn test',
    'MAVEN_OPTS=x mvn test', 'BUNDLE_GEMFILE=x rspec', 'PYTEST_ADDOPTS=x pytest', 'MAKEFLAGS=x make test', 'PIP_CONFIG_FILE=x pip list', 'RUFF_CONFIG=x ruff check src',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['echo ${CDPATH:=/x}', 'echo ${PATH=/x}', ': ${HOME::=/x}', 'echo $((IFS=1))', '(( CDPATH = 1 ))', 'echo ${GIT_DIR:=x}'])('should refuse `%s` as setting a risky variable', (cmd) => {
    expect(checkGateAgentCommand(REVIEWER, SETTINGS, cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['echo ${X:-y}', 'echo $((a == b))', 'echo ${X:=y}'])('should allow `%s`', (cmd) => {
    expect(checkGateAgentCommand(REVIEWER, SETTINGS, cmd)).toBeNull();
  });

  it.each(['echo ${CDPATH:=/x}; cd sub && ls', 'echo $((CDPATH=1)); cd sub && ls', ': ${cdpath::=/x}; pushd sub; ls'])(
    'should read every relative cd after `%s` as going somewhere only known when it runs (any agent)',
    (cmd) => {
      const facts = readCommand(cmd, ROOT, HOME);
      if ('unreadable' in facts) throw new Error('expected a readable command');
      expect(facts.parts[facts.parts.length - 1]?.lostDir).not.toBeNull();
    },
  );
});

describe('gate-agent-write: round 6, sort and other readers that can write (CR M1, M2)', () => {
  it.each([
    'sort --o=src/x a.txt', 'sort --ou src/x a.txt', 'sort --t=/tmp a.txt', 'sort --c=sh a.txt', 'find src -exec sort --o={} {} \;', 'ls | xargs -I{} sort --o={} {}',
    'curl -w @fmt.txt https://example.invalid', 'curl --write-out=@/tmp/f https://example.invalid',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['sort -u a.txt', 'pytest --co -q', "curl -s -w '%{http_code}' https://example.invalid"])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 6, script names by their parts (CR M4)', () => {
  it.each([
    'npm run format:check', 'npm run check-format', 'pnpm format:check', 'npm run test:fixtures', 'npm run lint:prefixes', 'npm run test:preparedness', 'yarn prettier:check',
    'pnpm run lint:fix:dry-run',
  ])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });

  it.each(['npm run format', 'npm run lint:fix', 'npm run db-migrate', 'pnpm release_notes', 'yarn prettier:write'])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });
});

describe('gate-agent-write: round 6, checks that run the repo\'s code stay in it (sec L-A, CR L2)', () => {
  it.each([
    'tox -c /tmp/tox.ini', `cd ${TMP} && tox`, 'dotnet test /tmp/x.csproj', 'flutter test /tmp/x', 'dart test /tmp/x', 'npx playwright test -c /tmp/pw.ts',
    'rubocop -c /tmp/r.yml', 'npx eslint -c /tmp/e.js src', 'npx --no-install prettier --check --config /tmp/p.json .', 'pylint --load-plugins=/tmp/p src',
    'xcodebuild test -project /tmp/A.xcodeproj -scheme A', 'rspec -r /tmp/x.rb', "make --eval='x:=1' test", "make -E 'x' test", 'npm test --node-options=--require=x',
  ])('should refuse `%s`', (cmd) => {
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
  });

  it.each(['tox', 'dotnet test', 'flutter test', 'pylint src', `xcodebuild test -scheme A -derivedDataPath ${TMP}/dd`, 'rspec spec/a_spec.rb', 'npx eslint src'])(
    'should allow `%s`',
    (cmd) => {
      expect(checkBash(cmd)).toBeNull();
    },
  );
});

describe('gate-agent-write: round 6, npx finds the repo\'s own tools (CR L3) and more test forms (CR L5)', () => {
  it('should find a tool in node_modules/.bin from the working folder up to the repo top', () => {
    expect(checkBash('cd web && npx prettier --check .')).toBeNull();
  });

  it('should name npx --no-install when it refuses a JS tool the repo has not installed', () => {
    expect(checkBash('npx prettier --check .')?.reason).toContain('npx --no-install');
  });

  it.each(['deno test', 'mix test', 'cargo nextest run', 'composer test', 'php artisan test', 'bin/rails test', 'npx turbo run test'])('should allow `%s`', (cmd) => {
    expect(checkBash(cmd)).toBeNull();
  });
});

describe('gate-agent-write: round 6, large words stay fast (perf C1)', () => {
  it.each([
    ['a word with 20,000 `=`', `pytest ${'a='.repeat(20_000)}`],
    ['a 5,000-character operand', `mypy ${'a'.repeat(5_000)}`],
    ['a 5,000-character option value', `ruff check --cache-dir=${'a'.repeat(5_000)} src`],
  ])('should refuse %s quickly', (_what, cmd) => {
    const started = performance.now();
    expect(checkBash(cmd)?.rule).toBe('gate-agent-write');
    expect(performance.now() - started).toBeLessThan(500);
  });
});
