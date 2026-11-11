/**
 * @behavior The tool gate refuses a `git push` it can't check: one that runs after the same
 *   command line switched branches (`git checkout`, `git switch` …) or changed where pushes go
 *   (`git config push.default …`, `remote.origin.pushurl`, `branch.x.merge`, `url.….insteadOf`),
 *   and one that carries its own config or repository (`git -c …`, `--config-env`, `--git-dir`,
 *   `--work-tree`, `GIT_DIR=…`, `GIT_CONFIG_*=…`, also through `env`). The reason tells the agent
 *   to push as a separate plain `git push`. A `git config` that sets one of those push keys on
 *   its own is refused too, so the change can't be split across two calls.
 * @business-rule IRON LAW #4: the branch the gate reads before a command runs must be the
 *   branch the push really pushes, and its destination must be the one the gate sees.
 */

import { describe, it, expect } from 'vitest';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import { branchCreatedBefore, checkPushSetup } from '../../../src/tool-gate/rules/push-setup.js';

const CWD = '/work/repo';
const HOME = '/home/dev';

function partsOf(cmd: string): CommandPart[] {
  const result = readCommand(cmd, CWD, HOME);
  if ('unreadable' in result) throw new Error(`expected a readable command: ${result.reason}`);
  return result.parts;
}

function check(cmd: string) {
  const parts = partsOf(cmd);
  for (const [i, part] of parts.entries()) {
    const refusal = checkPushSetup(part, parts.slice(0, i));
    if (refusal !== null) return refusal;
  }
  return null;
}

describe('push-setup rule: a push after the same command switched branches or changed push setup', () => {
  it.each([
    'git checkout main && git push',
    'git checkout -q feat/y; git push origin feat/y',
    'git switch main && git push',
    'git branch -m main && git push',
    'git branch -u origin/main && git push',
    'git symbolic-ref HEAD refs/heads/main && git push',
    'git worktree add ../w main && cd ../w && git push',
    'git remote set-url origin ../other && git push',
    'GIT_DIR=../other/.git; git push',
    'export GIT_CONFIG_PARAMETERS="\'push.default\'=\'upstream\'" && git push',
  ])('should refuse: %s', (cmd) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toMatch(/^Refused: /);
    expect(refusal?.reason).toContain("can't be checked");
    expect(refusal?.reason).toContain('separate plain `git push`');
  });

  it.each([
    'git config push.default upstream && git push',
    'git config remote.origin.push refs/heads/feat:refs/heads/main; git push',
    'git config --local remote.origin.pushurl ../other && git push',
    'git config url.../other.pushInsteadOf origin && git push',
    'git config set Push.Default upstream && git push',
  ])('should refuse the git config that changes where the push goes: %s', (cmd) => {
    expect(check(cmd)?.reason).toContain('changes where pushes go');
  });

  it.each([
    'git add . && git commit -m "x" && git push',
    'git fetch && git pull --rebase && git push',
    'git config user.name x && git push',
    'git config --get remote.origin.url && git push',
    'git status; git push origin feat/x',
    'git checkout -- src/app.ts',
    'git push && git checkout main',
  ])('should allow: %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a push that carries its own config or repository', () => {
  it.each([
    'git -c push.default=upstream push',
    'git -c remote.origin.url=../other push origin feat/x',
    'git --config-env=push.default=MODE push',
    'git --git-dir=../other/.git push',
    'git --git-dir ../other/.git push',
    'git --work-tree=../other push',
    'GIT_DIR=../other/.git git push',
    'GIT_WORK_TREE=../other git push',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.default GIT_CONFIG_VALUE_0=upstream git push',
    'GIT_CONFIG_GLOBAL=/tmp/evil git push',
    'env GIT_DIR=../other/.git git push',
    'env -i GIT_CONFIG_PARAMETERS=x git push',
    'sudo GIT_DIR=../other/.git git push',
    'GIT_DIR=../other/.git bash -c "git push"',
  ])('should refuse: %s', (cmd) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain("can't be checked");
    expect(refusal?.reason).toContain('separate plain `git push`');
  });

  it.each(['git push', 'git -C sub push', 'git -c color.ui=never log'])('should allow: %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: git config that changes where pushes go, on its own', () => {
  it.each([
    'git config push.default upstream',
    'git config --global remote.origin.pushurl ../other',
    'git config --replace-all remote.origin.push refs/heads/x:refs/heads/main',
    'git config set branch.feat.merge refs/heads/main',
    'git config --unset branch.feat.remote',
    'git config branch.feat.pushRemote other',
    'git config remote.pushDefault other',
    'git config --rename-section remote.origin remote.old',
    'git config url.../other.insteadOf origin',
    'git config REMOTE.origin.URL ../other',
    // git reads options only before the first key: this sets the URL to x (`--get` is a value pattern)
    'git config remote.origin.url x --get',
    'git config set --append remote.origin.push refs/heads/a:refs/heads/main',
  ])('should refuse: %s', (cmd) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain('changes where pushes go');
  });

  it.each([
    'git config user.email dev@example.com',
    'git config --get remote.origin.url',
    'git config remote.origin.url',
    'git config get push.default',
    'git config --list',
    'git config -l',
    'git config --get-regexp ^remote',
  ])('should allow: %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: config that changes what a push sends or makes git run a command', () => {
  it.each([
    'git config remote.origin.mirror true',
    'git config include.path /tmp/x',
    'git config includeIf.gitdir:/x/.path /tmp/x',
    'git config remote.origin.fetch +refs/heads/*:refs/remotes/origin/*',
    "git config alias.p '!git push -f'",
    'git config core.hooksPath /tmp/hooks',
    'git config core.sshCommand x',
    'git config core.fsmonitor x',
    'git config diff.external x',
    'git config --global --add include.path /tmp/x',
    'git config --remove-section alias',
    'git config set core.pager x',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.reason).toContain('changes where pushes go');
  });

  it.each(['git config user.name x', 'git config credential.helper store', 'git config --get alias.st', 'git config user.email a@b.c'])(
    'should allow %s',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );

  it.each(['git remote add --mirror=push x https://x', 'git remote add --mirror x https://x'])('should refuse %s, a remote every push mirrors to', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });

  it('should allow adding an ordinary remote', () => {
    expect(check('git remote add upstream https://x')).toBeNull();
  });
});

describe('push-setup rule: variables that point git at other config, for a push or a commit', () => {
  it.each([
    'HOME=/tmp/h git push',
    'XDG_CONFIG_HOME=/tmp/h git push',
    'GIT_SSH_COMMAND=x git push',
    'env HOME=/tmp/h git push',
    'export HOME=/tmp/h; git push',
    'export XDG_CONFIG_HOME=/tmp/h && git push',
    'GIT_DIR=../other/.git git commit -m x',
    'HOME=/tmp/h git commit -m x',
    'export GIT_DIR=../other/.git; git commit -m x',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });

  it.each(['git checkout -b feat/y && git commit -m x', 'GIT_PAGER=cat git log', 'HOME=/tmp/h npm test'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a push or commit in a folder the gate cannot follow', () => {
  it.each(['cd - && git push', 'D=x; cd "$D" && git push', 'cd "$D" && git commit -m x', 'pushd +1 && git push', 'popd; git commit -m x', 'git -C "$D" push'])(
    'should refuse %s',
    (cmd) => {
      expect(check(cmd)?.reason).toContain("can't be checked");
    },
  );

  it.each(['cd sub && git push', 'pushd sub && git commit -m x', 'cd "$D" && npm test'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: author, committer and trace variables only label or trace the commit (R2c)', () => {
  it.each([
    'GIT_AUTHOR_NAME=x GIT_AUTHOR_EMAIL=x@example.com git commit -m x',
    'GIT_AUTHOR_DATE=now GIT_COMMITTER_NAME=x GIT_COMMITTER_EMAIL=x@example.com GIT_COMMITTER_DATE=now git commit -m x',
    'GIT_TRACE=1 git push',
    'GIT_TRACE_PACKET=1 GIT_TRACE_CURL=1 git push origin feat/x',
    'env GIT_COMMITTER_NAME=x git push',
    'export GIT_AUTHOR_NAME=x; git commit -m x',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each(['GIT_AUTHOR_NAME=x GIT_DIR=/tmp/x git commit -m x', 'GIT_EDITOR=vim git commit', 'GIT_SSH=x git push', 'GIT_SSH_COMMAND=x GIT_TRACE=1 git push', 'export GIT_EDITOR=vim; git commit'])(
    'should still refuse %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('protected-branch');
    },
  );
});

describe('push-setup rule: a push after the same command created a new branch (R2c)', () => {
  it.each([
    'git checkout -b feat/y && git push -u origin feat/y',
    'git switch -c feat/y && git push -u origin feat/y',
    'git checkout -q -b feat/y origin/main && git push -u origin feat/y',
  ])('should allow %s, which the protected-branch rule checks on the new branch', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each([
    'git checkout -b feat/y -t origin/main && git push',
    'git checkout -b feat/y --track origin/main && git push',
    'git checkout -b "$B" && git push',
    'git checkout -b feat/y && git checkout main && git push',
    'cd sub && git checkout -b feat/y; cd .. && git push',
    'git checkout -B feat/y && git push',
    // fix round 4, K2: the new branch counts only when `&&` joins it to the push all the way
    'git switch --create feat/y; git push',
  ])('should still refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });

  it.each([
    ['git checkout -b feat/y && git push -u origin feat/y', 'feat/y'],
    ['git switch -c main && git commit -m x', 'main'],
    ['git checkout -b feat/y && git checkout main && git push', null],
    ['git push', null],
    ['git commit -m x', null],
  ])('should read %s as running on branch %s', (cmd, branch) => {
    const parts = partsOf(cmd);
    expect(branchCreatedBefore(parts, parts.length - 1)).toBe(branch);
  });
});

describe('push-setup rule: the new branch counts only when && joins it to the commit or push (fix round 4, K2)', () => {
  it.each([
    ['git checkout -b feat/y; git commit -m x', null],
    ['git checkout -b feat/y || git commit -m x', null],
    ['git checkout -b feat/y && echo x; git commit -m x', null],
    ['git checkout -b feat/y && echo x && git commit -m x', 'feat/y'],
    // a start point that may be a remote branch sets an upstream a bare push could use
    ['git checkout -b feat/y origin/main && git push', null],
    ['git checkout -b feat/y origin/main && git push origin HEAD', null],
    ['git checkout -b feat/y origin/main && git push -u origin feat/y', 'feat/y'],
    ['git checkout -b feat/y origin/main && git push origin HEAD:feat/y', 'feat/y'],
    ['git checkout -b feat/y HEAD~1 && git push', 'feat/y'],
    ['git checkout -b feat/y origin/main && git commit -m x', 'feat/y'],
  ])('should read %s as running on branch %s', (cmd, branch) => {
    const parts = partsOf(cmd);
    expect(branchCreatedBefore(parts, parts.length - 1)).toBe(branch);
  });

  it.each(['git checkout -b feat/y origin/main && git push', 'git checkout -b feat/y; git push origin feat/y'])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });
});

describe('push-setup rule: a git trace file only known when the command runs (fix round 4, K2)', () => {
  it.each([
    'GIT_TRACE=$F git push origin feat/x',
    'GIT_TRACE_PACKET="$F" git commit -m x',
    'env GIT_TRACE_SETUP=$F git push origin feat/x',
    'export GIT_TRACE=$F; git push origin feat/x',
    'GIT_TRACE="$(mktemp)"; export GIT_TRACE; git commit -m x',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });

  it.each([
    'GIT_TRACE=1 git push origin feat/x',
    'GIT_TRACE=true git commit -m x',
    'GIT_TRACE=2 GIT_TRACE_PACKET=1 git push origin feat/x',
    'GIT_TRACE=/tmp/trace.log git push origin feat/x',
    'GIT_AUTHOR_DATE="$(date -R)" git commit -m x',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: config planted into a cloned or new nested repo (fix round 4, K3)', () => {
  it.each([
    ['git clone -c core.fsmonitor=./x https://example.com/r.git r', 'core.fsmonitor'],
    ['git clone --config core.hooksPath=h https://example.com/r.git', 'core.hooksPath'],
    ['git clone --config=remote.origin.pushurl=x https://example.com/r.git', 'remote.origin.pushurl'],
    ['git clone --conf push.default=upstream https://example.com/r.git', 'push.default'],
    ['git clone -ccore.sshCommand=x https://example.com/r.git', 'core.sshCommand'],
    ['git clone --template=t https://example.com/r.git', '--template'],
    ['git clone --template t https://example.com/r.git', '--template'],
    ['git clone --templ=t https://example.com/r.git', '--templ'],
    ['git init --template=t r', '--template'],
    ['git init --template t', '--template'],
    ['git -c core.hooksPath=h clone https://example.com/r.git r', 'core.hooksPath'],
    ['git -c init.templateDir=t init r', 'init.templateDir'],
    ['git --config-env=core.fsmonitor=V clone https://example.com/r.git', '--config-env'],
    ['GIT_TEMPLATE_DIR=t git init r', 'GIT_TEMPLATE_DIR'],
    ['GIT_CONFIG_PARAMETERS=x git clone https://example.com/r.git r', 'GIT_CONFIG_PARAMETERS'],
    ['env GIT_CONFIG_COUNT=1 git init', 'GIT_CONFIG_COUNT'],
  ])('should refuse %s, naming what plants the config', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'git init',
    'git init r',
    'git init -q --initial-branch=main r',
    'git clone https://example.com/r.git',
    'git clone --depth 1 https://example.com/r.git',
    'git clone -c user.name=x https://example.com/r.git r',
    'git clone --no-tags -b feat https://example.com/r.git',
    'git -c http.sslVerify=false clone https://example.com/r.git',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a template or config variable set earlier in the call for a later clone or init (fix round 4, K3)', () => {
  it.each(['export GIT_TEMPLATE_DIR=t; git init r', 'GIT_TEMPLATE_DIR=t; git clone https://example.com/r.git', 'export GIT_CONFIG_COUNT=1 && git init'])(
    'should refuse %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('protected-branch');
    },
  );

  it.each(['export FOO=1; git init r', 'GIT_AUTHOR_NAME=x; git init r'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: config that makes any git subcommand run a hook folder or program (fix round 4, K4)', () => {
  it.each([
    ['git -c core.hooksPath=h commit -m x', 'core.hooksPath'],
    ['git -c core.hooksPath=/dev/null checkout feat/y', 'core.hooksPath'],
    ['git -c core.fsmonitor=./x status', 'core.fsmonitor'],
    ['git -c CORE.FSMONITOR=./x diff', 'CORE.FSMONITOR'],
    ['git -c core.sshCommand=./ssh.sh fetch', 'core.sshCommand'],
    ['git -c core.editor=./ed.sh commit', 'core.editor'],
    ['git -c sequence.editor=./ed.sh rebase -i HEAD~2', 'sequence.editor'],
    ['git -c diff.external=./d.sh diff', 'diff.external'],
    ['git -c diff.bin.textconv=./t.sh diff', 'diff.bin.textconv'],
    ['git -c filter.x.clean=./c.sh add a.txt', 'filter.x.clean'],
    ['git -c filter.x.smudge=./s.sh checkout a.txt', 'filter.x.smudge'],
    ['git -c filter.x.process=./p.sh status', 'filter.x.process'],
    ['git -c gpg.program=./g.sh tag -s v1 -m x', 'gpg.program'],
    ['git -c alias.st=!./x.sh st', 'alias.st'],
    ['git -c alias.p=push p origin main', 'alias.p'],
    ['git -c uploadpack.packObjectsHook=./h.sh fetch ../other', 'uploadpack.packObjectsHook'],
    ['git -c protocol.ext.allow=always fetch ext::./x', 'protocol.ext.allow'],
    ['git -c core.alternateRefsCommand=./a.sh fetch', 'core.alternateRefsCommand'],
    ['git -c include.path=./my.cfg status', 'include.path'],
    ['git --config-env=core.hooksPath=VAR commit -m x', 'core.hooksPath'],
    ['git --config-env core.fsmonitor=VAR status', 'core.fsmonitor'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=h git commit -m x', 'GIT_CONFIG_KEY_0'],
    ['env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=./x git status', 'GIT_CONFIG_KEY_0'],
    ['export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=./x; git status', 'GIT_CONFIG_KEY_0'],
    ['GIT_CONFIG_KEY_0=core.hooksPath; git checkout feat/y', 'GIT_CONFIG_KEY_0'],
    ['GIT_CONFIG_PARAMETERS="\'core.fsmonitor\'=\'./x\'" git status', 'GIT_CONFIG_PARAMETERS'],
  ])('should refuse %s, naming the setting', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'git commit -m x',
    'git status',
    'git -c user.name=x commit -m x',
    'git -c core.pager=cat log',
    'git -c pager.log=false log',
    'git -c http.sslVerify=false fetch',
    'git -c core.editor=true commit --amend',
    'git -c sequence.editor=: rebase -i HEAD~2',
    'git -c core.fsmonitor=false status',
    'git -c protocol.file.allow=always submodule update',
    'git -c color.ui=always diff',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=x git status',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a config key or command only known when git runs (fix round 4, K4)', () => {
  /** The gate checks the parts it read even when a piece of the call is unreadable (ADR-010). */
  function checkReadPast(cmd: string) {
    const parts = readCommand(cmd, CWD, HOME).parts;
    for (const [i, part] of parts.entries()) {
      const refusal = checkPushSetup(part, parts.slice(0, i));
      if (refusal !== null) return refusal;
    }
    return null;
  }

  it.each([
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$K" GIT_CONFIG_VALUE_0=x git status',
    'git -c "$K"=x status',
    'git -c core.editor="$E" commit',
  ])('should refuse %s', (cmd) => {
    expect(checkReadPast(cmd)?.rule).toBe('protected-branch');
  });

  it.each(['git -c user.name="$N" commit -m x', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0="$N" git status'])(
    'should allow %s',
    (cmd) => {
      expect(checkReadPast(cmd)).toBeNull();
    },
  );
});

describe('push-setup rule: credential helpers the agent may have written (fix round 4, K5, item 31)', () => {
  it.each([
    ['git -c credential.helper=!./helper.sh fetch', 'credential.helper'],
    ['git -c "credential.helper=!../h get" fetch', 'credential.helper'],
    ['git -c "credential.helper=!tools/h get" pull', 'credential.helper'],
    ['git -c credential.helper=./git-credential-x fetch', 'credential.helper'],
    ['git -c credential.helper=/tmp/h ls-remote origin', 'credential.helper'],
    ['git -c credential.https://example.com.helper=!./h fetch', 'credential.https://example.com.helper'],
    ['git --config-env=credential.helper=H fetch', 'credential.helper'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=!./h git fetch', 'GIT_CONFIG_KEY_0'],
  ])('should refuse %s, naming the setting', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'git -c "credential.helper=!gh auth git-credential" fetch',
    'git -c credential.helper=store fetch',
    'git -c credential.helper=cache pull',
    'git -c credential.helper=osxkeychain fetch',
    'git -c credential.helper= fetch',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=store git fetch',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: variables that make git run a program (fix round 4, K5, item 32)', () => {
  it.each([
    ['GIT_SSH_COMMAND=./ssh.sh git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH=./ssh git clone https://example.com/r.git', 'GIT_SSH'],
    ['GIT_EDITOR=./ed.sh git rebase -i HEAD~2', 'GIT_EDITOR'],
    ['GIT_SEQUENCE_EDITOR=./ed.sh git rebase -i HEAD~2', 'GIT_SEQUENCE_EDITOR'],
    ['env GIT_EXTERNAL_DIFF=./d.sh git diff', 'GIT_EXTERNAL_DIFF'],
    ['GIT_ASKPASS=./p.sh git fetch', 'GIT_ASKPASS'],
    ['SSH_ASKPASS=./p.sh git push origin feat/x', 'SSH_ASKPASS'],
    ['GIT_PAGER=./p.sh git log', 'GIT_PAGER'],
    ['GIT_PROXY_COMMAND=./p.sh git fetch', 'GIT_PROXY_COMMAND'],
    ['EDITOR=./ed.sh git commit', 'EDITOR'],
    ['VISUAL=./ed.sh git tag -a v1', 'VISUAL'],
    ['export GIT_SSH_COMMAND=./ssh.sh; git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_EDITOR=./ed.sh; git merge feat/y', 'GIT_EDITOR'],
  ])('should refuse %s, naming the variable', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'GIT_PAGER=cat git log',
    'PAGER=cat git log',
    'GIT_TERMINAL_PROMPT=0 git fetch',
    'GIT_EDITOR=true git rebase --continue',
    'GIT_SEQUENCE_EDITOR=: git rebase -i HEAD~2',
    'EDITOR=true git merge --continue',
    'GIT_SSH_COMMAND=./ssh.sh ls',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: config files the agent points git at (fix round 4, K5, item 33)', () => {
  it.each([
    ['GIT_CONFIG_GLOBAL=./my.cfg git status', 'GIT_CONFIG_GLOBAL'],
    ['GIT_CONFIG_SYSTEM=./my.cfg git diff', 'GIT_CONFIG_SYSTEM'],
    ['GIT_CONFIG=./my.cfg git log', 'GIT_CONFIG'],
    ['HOME=/tmp/h git status', 'HOME'],
    ['XDG_CONFIG_HOME=./c git checkout feat/y', 'XDG_CONFIG_HOME'],
    ['export HOME=/tmp/h; git status', 'HOME'],
    ['env GIT_CONFIG_GLOBAL=./my.cfg git fetch', 'GIT_CONFIG_GLOBAL'],
  ])('should refuse %s, naming the variable', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'GIT_CONFIG_GLOBAL=/dev/null git status',
    'GIT_CONFIG_SYSTEM=/dev/null git log',
    'GIT_CONFIG_NOSYSTEM=1 git status',
    'HOME=/tmp/h ls',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: upload and receive programs (fix round 4, K5, item 34)', () => {
  it.each([
    ['git fetch --upload-pack=./u origin', '--upload-pack'],
    ['git fetch --upload-pack ./u origin', '--upload-pack'],
    ['git pull --upload-pack=./u origin feat/x', '--upload-pack'],
    ['git ls-remote --upload-pack=./u origin', '--upload-pack'],
    ['git ls-remote --exec=./u origin', '--exec'],
    ['git clone --upload-pack ./u ../other r', '--upload-pack'],
    ['git clone -u ./u ../other r', '-u'],
    ['git clone -u./u ../other r', '-u'],
    ['git fetch --upl=./u origin', '--upl'],
    ['git -c remote.origin.uploadpack=./u fetch', 'remote.origin.uploadpack'],
    ['git -c remote.origin.receivepack=./r fetch', 'remote.origin.receivepack'],
  ])('should refuse %s, naming the option', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'git fetch -u origin',
    'git fetch origin',
    'git pull origin feat/x',
    'git branch -u origin/feat/x',
    'git ls-remote origin',
    'git clone https://example.com/r.git',
    'git -c remote.origin.uploadpack=git-upload-pack fetch',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a pager under a wrapper that gives git a terminal (fix round 4, K5, item 35)', () => {
  it.each([
    ['script -q /dev/null git -c core.pager=./p log', 'core.pager'],
    ['script -q /dev/null git -c pager.log=./p log', 'pager.log'],
    ['script -q /dev/null env GIT_PAGER=./p git log', 'GIT_PAGER'],
    ['PAGER=./p script -q /dev/null git log', 'PAGER'],
    ['export GIT_PAGER=./p; unbuffer git log', 'GIT_PAGER'],
    ["expect -c 'spawn git -c core.pager=./p log'", 'core.pager'],
    ['unbuffer git --config-env=core.pager=V log', 'core.pager'],
    ['unbuffer git --config-env pager.log=V log', 'pager.log'],
  ])('should refuse %s, naming the setting', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(named);
  });

  it.each([
    'script -q /dev/null git log',
    'script -q /dev/null git -c core.pager=cat log',
    'GIT_PAGER=cat script -q /dev/null git log',
    'git -c core.pager=./p log',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a push naming the receive program its local remote runs (fix round 4, K5, item 34)', () => {
  it.each(['git push --receive-pack=./r ../other feat/x', 'git push --exec=./r ../other feat/x'])('should refuse %s', (cmd) => {
    expect(check(cmd)?.reason).toContain('hook folder or program');
  });

  it.each(['git push -u origin feat/x', 'git push --repo=origin'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: ssh commands git runs (fix round 4, K6, item 36)', () => {
  it.each([
    ['GIT_SSH_COMMAND="ssh -o ProxyCommand=./p" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o proxycommand ./p" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -vo ProxyCommand=./p" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o PermitLocalCommand=yes" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o KnownHostsCommand=./k" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o \'Match exec ./m\'" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -F ./cfg" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -Fcfg" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND=./ssh.sh git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh; ./x" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH=./ssh git clone https://example.com/r.git', 'GIT_SSH'],
    ['git -c "core.sshCommand=ssh -o ProxyCommand=./p" fetch', 'core.sshCommand'],
    ['git --config-env=core.sshCommand=S fetch', 'core.sshCommand'],
  ])('should refuse %s, naming the setting', (cmd, named) => {
    expect(check(cmd)?.reason).toContain(named);
  });

  it.each([
    'GIT_SSH_COMMAND="ssh -i ~/.ssh/k -o StrictHostKeyChecking=no" git fetch',
    'GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes" git fetch',
    'GIT_SSH_COMMAND="/usr/bin/ssh -oIdentitiesOnly=yes -p 2222" git fetch',
    'GIT_SSH_COMMAND="ssh -i id_ed25519_F" git ls-remote origin',
    'GIT_SSH=/usr/bin/ssh git fetch',
    'GIT_SSH=ssh git fetch',
    'git -c "core.sshCommand=ssh -i ~/.ssh/k" fetch',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0=ssh git fetch',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: ! credential helpers running a shell, a function or an unknown program (fix round 4, K6, item 37)', () => {
  it.each([
    'git -c "credential.helper=!sh ./x.sh" fetch',
    'git -c "credential.helper=!/bin/bash -c ./x" fetch',
    'git -c "credential.helper=!env ./x" fetch',
    'git -c "credential.helper=!python3.12 x.py" fetch',
    'git -c "credential.helper=!node x.js" fetch',
    'git -c "credential.helper=!eval ./x" fetch',
    'git -c "credential.helper=!. ./x" fetch',
    'git -c "credential.helper=!f() { ./x; }; f" fetch',
    'git -c "credential.helper=!f(){ ./x; }; f" fetch',
    'git -c "credential.helper=!function f { ./x; }; f" fetch',
    'git -c "credential.helper=!/tmp/evil get" fetch',
    'git -c "credential.helper=!/usr/bin/../../tmp/evil" fetch',
    'git -c "credential.helper=!gh auth git-credential; ./x" fetch',
    'git -c "credential.helper=!gh auth git-credential && ./x" fetch',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.reason).toContain('credential.helper');
  });

  it('should refuse a helper with a command substitution, whose text is only known when it runs', () => {
    const parts = readCommand('git -c "credential.helper=!gh auth git-credential $(./x)" fetch', CWD, HOME).parts;
    const git = parts.findIndex((p) => p.git !== null);
    expect(checkPushSetup(parts[git], parts.slice(0, git))?.reason).toContain('credential.helper');
  });

  it.each([
    'git -c "credential.helper=!gh auth git-credential" fetch',
    'git -c "credential.helper=!/opt/homebrew/bin/gh auth git-credential" fetch',
    'git -c "credential.helper=!/usr/local/bin/gh auth git-credential" fetch',
    'git -c "credential.helper=!/Applications/Xcode.app/Contents/Developer/usr/bin/git-credential-osxkeychain" fetch',
    'git -c credential.helper=store fetch',
    'git -c credential.helper=cache fetch',
    'git -c credential.helper=osxkeychain fetch',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: an absolute ssh program must sit in a standard bin folder (fix round 4, K7, item 39)', () => {
  it.each([
    ['GIT_SSH_COMMAND=/tmp/ssh git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH=/tmp/ssh git fetch', 'GIT_SSH'],
    ['GIT_SSH_COMMAND=/usr/bin/../../tmp/ssh git fetch', 'GIT_SSH_COMMAND'],
    ['git -c "core.sshCommand=/tmp/ssh -i k" fetch', 'core.sshCommand'],
  ])('should refuse %s', (cmd, named) => {
    expect(check(cmd)?.reason).toContain(named);
  });

  it.each([
    'GIT_SSH_COMMAND=/usr/bin/ssh git fetch',
    'GIT_SSH_COMMAND="/opt/homebrew/bin/ssh -i k" git fetch',
    'GIT_SSH=/usr/local/bin/ssh git fetch',
    'GIT_SSH_COMMAND=ssh git fetch',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a quoted ! credential helper program word (fix round 4, K7, item 40)', () => {
  it.each([`git -c "credential.helper=!'./x'" fetch`, `git -c 'credential.helper=!"sh" -c x' fetch`, `git -c 'credential.helper=!\\sh -c x' fetch`, `git -c "credential.helper=!'/tmp/gh' auth" fetch`])(
    'should refuse %s',
    (cmd) => {
      expect(check(cmd)?.reason).toContain('credential.helper');
    },
  );

  it.each([`git -c "credential.helper=!'/opt/homebrew/bin/gh' auth git-credential" fetch`, `git -c "credential.helper=!\\"gh\\" auth git-credential" fetch`])(
    'should allow %s',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe('push-setup rule: a push carrying a checked ssh command (fix round 4, K7, item 41)', () => {
  it.each([
    'GIT_SSH_COMMAND="ssh -i ~/.ssh/k" git push origin feat/x',
    'GIT_SSH=/usr/bin/ssh git push origin feat/x',
    'git -c "core.sshCommand=ssh -i k" push origin feat/x',
    'GIT_SSH_COMMAND="ssh -i k" GIT_SSH=ssh git push origin feat/x',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each([
    'GIT_SSH_COMMAND="ssh -o ProxyCommand=./p" git push origin feat/x',
    'GIT_SSH_COMMAND=/tmp/ssh git push origin feat/x',
    'GIT_SSH_COMMAND="ssh -i k" GIT_DIR=../other/.git git push origin feat/x',
    'GIT_SSH_COMMAND="ssh -i k" GIT_CONFIG_PARAMETERS=x git push origin feat/x',
    'git -c "core.sshCommand=ssh -i k" -c push.default=upstream push origin feat/x',
    'git --config-env=core.sshCommand=S push origin feat/x',
    'git -c core.sshCommand push origin feat/x',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });
});

describe('push-setup rule: a credential helper without ! that holds shell syntax (fix round 4, K8, item 12)', () => {
  it.each([
    "git -c credential.helper='store;python3 x.py' fetch",
    "git -c 'credential.helper=cache|tee x' fetch",
    "git -c 'credential.helper=store&x' fetch",
    "git -c 'credential.helper=store<x' fetch",
    "git -c 'credential.helper=store>x' fetch",
    "git -c 'credential.helper=store (x)' fetch",
    "git -c $'credential.helper=store\\nx' fetch",
  ])('should refuse %s: git runs `git credential-<value>` through a shell', (cmd) => {
    expect(check(cmd)?.reason).toContain('credential.helper');
  });

  it.each(["git -c 'credential.helper=cache --timeout=3600' fetch", 'git -c credential.helper=store fetch'])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: an ssh command may carry only allowlisted options (fix round 4, K9, item 1)', () => {
  it.each([
    ['GIT_SSH_COMMAND="ssh -I ./evil.so" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -I./evil.so" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o PKCS11Provider=./evil.so" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o SecurityKeyProvider=./evil.so" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o Include=./cfg" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o XAuthLocation=./x" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o Proxy\\Command=./p" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o ProxyJump=jump" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -J jump" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -W host:22" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -L 8080:localhost:80" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -R 8080:localhost:80" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -D 1080" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -S ./sock" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -e none" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -E ./log" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -vI ./evil.so" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -i k example.com" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -i k -- x" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -o \'PKCS11Provider ./evil.so\'" git fetch', 'GIT_SSH_COMMAND'],
    ['GIT_SSH_COMMAND="ssh -i k*" git fetch', 'GIT_SSH_COMMAND'],
    ['git -c "core.sshCommand=ssh -o Include=./cfg" fetch', 'core.sshCommand'],
  ])('should refuse %s, naming the setting', (cmd, named) => {
    expect(check(cmd)?.reason).toContain(named);
  });

  it.each([
    'GIT_SSH_COMMAND="ssh -I ./evil.so" git push origin feat/x',
    'git -c "core.sshCommand=ssh -o XAuthLocation=./x" push origin feat/x',
  ])('should refuse %s, a push carrying it', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });

  it.each([
    'GIT_SSH_COMMAND="ssh -i ~/.ssh/deploy -o IdentitiesOnly=yes" git fetch',
    'GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no" git fetch',
    'GIT_SSH_COMMAND="/usr/bin/ssh -p 2222" git fetch',
    'GIT_SSH_COMMAND="ssh -vvv -4q -T -o \'ConnectTimeout 10\'" git fetch',
    'GIT_SSH_COMMAND="ssh -o stricthostkeychecking=accept-new -o UserKnownHostsFile=/dev/null" git fetch',
    'GIT_SSH_COMMAND="ssh -l git -p2222 -ik -c aes256-ctr -m hmac-sha2-256 -b 10.0.0.1" git fetch',
    'GIT_SSH_COMMAND="ssh -o ControlMaster=auto -o ControlPath=~/.ssh/cm-%r@%h:%p -o ControlPersist=60" git fetch',
    'GIT_SSH_COMMAND="ssh -oBatchMode=yes -o LogLevel=ERROR" git push origin feat/x',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a ! credential helper must run a plain program that runs nothing it is given (fix round 4, K9, item 2)', () => {
  it.each([
    '!nohup ./x',
    '!{ ./x; }',
    '!awk -f x.awk',
    '!gawk -f x.awk',
    '!sed -n p x',
    '!xargs ./x',
    '!command ./x',
    '!builtin ./x',
    '!exec ./x',
    '!osascript x.scpt',
    '!timeout 5 ./x',
    '!nice ./x',
    '!sudo ./x',
    '!doas ./x',
    '!script -q /dev/null ./x',
    '!unbuffer ./x',
    '!flock l ./x',
    '!faketime 0 ./x',
    '!caffeinate ./x',
    '!ionice ./x',
    '!chrt 1 ./x',
    '!stdbuf -o0 ./x',
    '!/usr/bin/nohup ./x',
    '!/usr/bin/xargs ./x',
    '!Env ./x',
    '!SH -c x',
    '!LD_PRELOAD=./x.so gh auth git-credential',
    '!"gh /tmp/evil"',
    `!'"'"gh /tmp/evil"`,
    '!* x',
    '!gh auth git-credential #',
    '!gh\\ x',
  ])('should refuse the helper %s', (helper) => {
    const quoted = `'credential.helper=${helper.replace(/'/g, `'\\''`)}'`;
    expect(check(`git -c ${quoted} fetch`)?.reason).toContain('credential.helper');
  });

  it.each([
    '!gh auth git-credential',
    '!/usr/local/bin/gh auth git-credential',
    '!git-credential-manager',
    '!op plugin run -- gh',
    '!"gh" auth git-credential',
    "!'/opt/homebrew/bin/gh' auth git-credential",
    '!gh auth git-credential --hostname=github.example.com',
  ])('should allow the helper %s', (helper) => {
    const quoted = `'credential.helper=${helper.replace(/'/g, `'\\''`)}'`;
    expect(check(`git -c ${quoted} fetch`)).toBeNull();
  });
});

describe('push-setup rule: ssh -o keys that only pick algorithms, retries or agent forwarding (fix round 4, K10, item 1)', () => {
  it.each([
    'GIT_SSH_COMMAND="ssh -o ForwardAgent=no" git fetch',
    'GIT_SSH_COMMAND="ssh -o forwardagent=yes" git fetch',
    'GIT_SSH_COMMAND="ssh -o ConnectionAttempts=3" git fetch',
    'GIT_SSH_COMMAND="ssh -o HostKeyAlgorithms=ssh-ed25519" git fetch',
    'GIT_SSH_COMMAND="ssh -o PubkeyAcceptedKeyTypes=+ssh-rsa" git fetch',
    'GIT_SSH_COMMAND="ssh -o PubkeyAcceptedAlgorithms=+ssh-rsa" git fetch',
    'GIT_SSH_COMMAND="ssh -o KexAlgorithms=curve25519-sha256" git fetch',
    'GIT_SSH_COMMAND="ssh -o Ciphers=aes256-ctr" git fetch',
    'GIT_SSH_COMMAND="ssh -o MACs=hmac-sha2-256" git fetch',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each(['GIT_SSH_COMMAND="ssh -o ProxyCommand=./p" git fetch', 'GIT_SSH_COMMAND="ssh -o SecurityKeyProvider=./x.so" git fetch'])(
    'should still refuse %s',
    (cmd) => {
      expect(check(cmd)?.reason).toContain('GIT_SSH_COMMAND');
    },
  );
});

describe('push-setup rule: a ! credential helper whose program runs its own arguments (fix round 4, K10, item 2)', () => {
  function helperCheck(helper: string) {
    return check(`git -c 'credential.helper=${helper}' fetch`);
  }

  it.each([
    '!git -c user.name=x credential-osxkeychain',
    '!git --config-env=user.name=X credential-osxkeychain',
    '!git --config-env user.name=X credential-osxkeychain',
    '!/usr/bin/git -c user.name=x credential-osxkeychain',
    '!git --exec-path=./bin credential-x',
    '!git --exec-path ./bin credential-x',
    '!op run -- ./x',
    '!op run --env-file=e -- sh -c x',
    '!op run -- xargs gh',
    '!op run ./x',
    '!op run --',
    '!op plugin run -- ./x',
    '!find . -name x',
    '!watch ./x',
    '!parallel ./x ::: a',
    '!make -f m',
    '!vim -c q',
    '!vi x',
    '!nvim x',
    '!ex x',
    '!tclsh x.tcl',
    '!wish x.tcl',
    '!lua x.lua',
    '!luajit x.lua',
    '!csh x',
    '!tcsh x',
    '!pwsh x.ps1',
    '!powershell x.ps1',
    '!/usr/local/bin/PWSH x.ps1',
  ])('should refuse the helper %s', (helper) => {
    expect(helperCheck(helper)?.reason).toContain('credential.helper');
  });

  it.each([
    '!gh auth git-credential',
    '!/usr/local/bin/gh auth git-credential',
    '!git-credential-manager',
    '!op plugin run -- gh',
    '!op run -- gh auth git-credential',
    '!op run --no-masking -- /usr/local/bin/gh auth git-credential',
    '!git credential-osxkeychain',
    'store',
  ])('should allow the helper %s', (helper) => {
    expect(helperCheck(helper)).toBeNull();
  });
});

describe('push-setup rule: git config writes of a credential helper (fix part K11, item 9)', () => {
  it.each([
    "git config credential.helper '!./x'",
    "git config --local credential.helper '!sh -c x'",
    "git config --global credential.helper '!./x'",
    "git config --system credential.helper '!./x'",
    "git config --worktree credential.helper 'store;x'",
    "git config -f f credential.helper '!./x'",
    "git config --add credential.helper '!./x'",
    "git config --replace-all credential.https://github.com.helper '!./x' 'old'",
    "git config set credential.helper '!./x'",
    "git config set --append credential.helper '!./x'",
    'git config set --global credential.helper /tmp/h',
    "git config CREDENTIAL.Helper '!./x'",
    'git config credential.helper "$H"',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.reason).toMatch(/credential/i);
  });

  it.each([
    'git config credential.helper osxkeychain',
    "git config --global credential.helper '!gh auth git-credential'",
    'git config credential.helper store',
    'git config --get credential.helper',
    'git config --unset credential.helper',
    'git config set credential.helper osxkeychain',
    'git config credential.username me',
  ])('should still allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: git config options read as git parse-options reads them (fix part K12, item 4)', () => {
  it.each([
    "git config -t bool-or-str credential.helper '!sh -c x'",
    'git config -zt bool-or-str core.hooksPath .h',
    'git config -tbool-or-str core.hooksPath .h',
    'git config -ff core.hooksPath .h',
    "git config --ty bool-or-str alias.p '!sh -c x'",
    "git config --comm x core.sshCommand 'ssh -o ProxyCommand=x'",
    'git config --comment=x --type=path core.hooksPath .h',
    "git config set --val x credential.helper '!./x'",
    'git config set --comm x core.hooksPath .h',
    'git config set --ty bool-or-str core.hooksPath .h',
    'git config set -t path core.hooksPath .h',
    'git config set --no-all core.hooksPath .h',
    'git config --no-g core.hooksPath .h',
    'git config -- core.hooksPath .h',
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.reason).toContain('what git runs');
  });

  it.each([
    'git config --bo core.hooksPath .h',
    'git config --get-c core.hooksPath',
    'git config --val x core.hooksPath .h',
    'git config set --n core.hooksPath .h',
    'git config -k core.hooksPath .h',
    'git config --global=x core.hooksPath .h',
    'git config --type',
    'git config set -z core.hooksPath .h',
  ])("should refuse %s, whose options the gate can't read (an error in git)", (cmd) => {
    expect(check(cmd)?.reason).toContain("can't read");
  });

  it.each([
    'git config --type bool core.x true',
    'git config -t bool core.x true',
    'git config --get core.hooksPath',
    'git config --get-color color.diff.new',
    'git config user.name x',
    'git config core.x -1',
    'git config -l',
    'git config -lz',
    'git config --list --show-origin --show-scope',
    'git config get --all --show-names remote.origin.fetch',
    'git config list --name-only',
    'git config set --global user.name x',
    'git config set --append --comment "why" user.email a@example.com',
    'git config unset --all user.name',
    'git config --file .gitmodules submodule.x.path lib/x',
    'git config -f .gitmodules submodule.x.url ../x',
    'git config --no-includes --get user.name',
    'git config --file f set credential.helper /tmp/h',
  ])('should still allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });
});

describe('push-setup rule: a credential helper with arguments (fix part K12, item 5b: a path among them needs the user\'s decision)', () => {
  it.each(["git config credential.helper 'cache --timeout=3600'", "git config credential.helper 'store'"])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each([
    "git config credential.helper './x'",
    "git config credential.helper '/tmp/x --file y'",
    "git config credential.helper '\"./x\" y'",
    "git config credential.helper 'store --file ~/x; touch y'",
    "git config credential.helper 'store --file `./x`'",
    "git config credential.helper 'store --file .oss/tool-gates.json'",
  ])('should refuse %s', (cmd) => {
    expect(check(cmd)?.rule).toBe('protected-branch');
  });
});
