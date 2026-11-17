/**
 * @behavior Only what steers the review gate is fingerprinted outside the repo during a review run:
 *   the `toolGates` and `models` keys of ~/.oss/config.json; the hook, env and plugin keys of
 *   ~/.claude/settings(.local).json (also under CLAUDE_CONFIG_DIR); the OSS hooks and bin (not the
 *   decrypt CLI's download leftovers); this session's repos.json; the whole `plugins` object of
 *   installed_plugins.json; the gate parts (hooks, config, watcher/dist, hooks.json, .claude-plugin) of
 *   the installed OSS plugin and of the plugin roots the gate runs from; the node the hooks run and any
 *   node, cat, mktemp or bash that PATH puts before the real one. A change to any of them voids the
 *   review; changes elsewhere (other keys, rc files, agents) do not.
 * @business-rule R-266 layer 2, user pick "Only what steers the gate": a review agent must not widen
 *   its own allowlist or swap the code that checks it, whatever route it takes; files other sessions
 *   and the user change in normal work (apiKey, models, settings, other plugins) must not void reviews.
 * @boundary printUserFiles / userChanges (watcher/src/gate-run/user-files.ts), real files in a temp HOME
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { printUserFiles, userChanges, type UserContext } from '../../src/gate-run/user-files.js';

const tempDirs: string[] = [];
function tempHome(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-user-files-')));
  tempDirs.push(dir);
  return dir;
}
function put(home: string, rel: string, text: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  fs.writeFileSync(path.join(home, rel), text);
}
const budget = (): { deadline: number } => ({ deadline: Date.now() + 30_000 });
const SID = 'sess-1';
const OSS = '.claude/plugins/cache/one-shot-ship-plugin/oss/9.9.9';

/** installed_plugins.json naming the OSS install (and another plugin) under the home. */
function installOss(home: string, extra: Record<string, unknown> = {}): void {
  put(
    home,
    '.claude/plugins/installed_plugins.json',
    JSON.stringify({
      version: 2,
      plugins: {
        'oss@one-shot-ship-plugin': [{ scope: 'user', installPath: path.join(home, OSS), version: '9.9.9', ...extra }],
        'other@mkt': [{ scope: 'user', installPath: path.join(home, '.claude/plugins/cache/mkt/other/1.0.0') }],
      },
    }),
  );
  put(home, `${OSS}/hooks/oss-tool-gate.sh`, '#!/bin/bash\n');
  put(home, `${OSS}/hooks.json`, '{}\n');
  put(home, `${OSS}/config/tool-gates.json`, '{}\n');
  put(home, `${OSS}/watcher/dist/cli/tool-gate.cjs`, 'x\n');
  put(home, `${OSS}/.claude-plugin/plugin.json`, '{}\n');
  put(home, `${OSS}/agents/a.md`, 'a\n');
  put(home, '.claude/plugins/cache/mkt/other/1.0.0/hooks/h.sh', 'a\n');
}

const changes = (home: string, before: Record<string, string>, ctx: UserContext = {}): string[] =>
  userChanges(before, printUserFiles(home, SID, budget(), ctx));

describe('the user-level files that steer the review gate (R-266 layer 2)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('~/.oss/config.json: its toolGates and models keys count, compared as canonical JSON; apiKey does not', () => {
    const home = tempHome();
    put(home, '.oss/config.json', '{"apiKey":"a","toolGates":{"b":1,"a":[1]},"models":{"default":"claude"}}');
    const before = printUserFiles(home, SID, budget());

    put(home, '.oss/config.json', '{"models":{"default":"claude"},"apiKey":"b","toolGates":{"a":[1],"b":1},"other":1}');
    expect(changes(home, before)).toEqual([]);

    put(home, '.oss/config.json', '{"apiKey":"b","toolGates":{"a":[1],"b":1},"models":{"default":"claude","agents":{"oss:code-reviewer":"ollama/x"}}}');
    expect(changes(home, before)).toEqual(['(user) ~/.oss/config.json: models']);

    put(home, '.oss/config.json', '{"apiKey":"b","toolGates":{"a":[1],"b":1,"reviewPrograms":["bash"]},"models":{"default":"claude"}}');
    expect(changes(home, before)).toEqual(['(user) ~/.oss/config.json: toolGates']);
  });

  it('a missing, an unparsable and a valid config are different states, and two unparsable contents differ', () => {
    const home = tempHome();
    const both = ['(user) ~/.oss/config.json: models', '(user) ~/.oss/config.json: toolGates'];
    const missing = printUserFiles(home, SID, budget());
    put(home, '.oss/config.json', '{"toolGates":');
    const broken = printUserFiles(home, SID, budget());
    put(home, '.oss/config.json', '{"toolGates":[');
    const brokenOther = printUserFiles(home, SID, budget());
    put(home, '.oss/config.json', '{}');
    const valid = printUserFiles(home, SID, budget());

    expect(userChanges(missing, broken)).toEqual(both);
    expect(userChanges(broken, brokenOther)).toEqual(both);
    expect(userChanges(broken, valid)).toEqual(both);
    expect(userChanges(missing, valid)).toEqual(both);
  });

  it.each(['hooks', 'disableAllHooks', 'allowManagedHooksOnly', 'env', 'enabledPlugins', 'extraKnownMarketplaces', 'pluginDirs'])(
    '~/.claude/settings.json and settings.local.json: their %s key counts',
    (key) => {
      const home = tempHome();
      put(home, '.claude/settings.json', '{"model":"opus"}');
      put(home, '.claude/settings.local.json', '{}');
      const before = printUserFiles(home, SID, budget());

      put(home, '.claude/settings.json', JSON.stringify({ model: 'opus', [key]: { x: false } }));
      put(home, '.claude/settings.local.json', JSON.stringify({ [key]: true }));
      expect(changes(home, before)).toEqual([`(user) ~/.claude/settings.json: ${key}`, `(user) ~/.claude/settings.local.json: ${key}`]);
    },
  );

  it("~/.claude/settings.json and settings.local.json: model and permissions do not count", () => {
    const home = tempHome();
    put(home, '.claude/settings.json', '{"model":"opus","hooks":{}}');
    put(home, '.claude/settings.local.json', '{}');
    const before = printUserFiles(home, SID, budget());

    put(home, '.claude/settings.json', '{"model":"sonnet","hooks":{}}');
    put(home, '.claude/settings.local.json', '{"permissions":{"allow":["Bash"]}}');
    expect(changes(home, before)).toEqual([]);
  });

  it('the same settings and installed_plugins.json rules apply under CLAUDE_CONFIG_DIR', () => {
    const home = tempHome();
    const ctx: UserContext = { configDir: path.join(home, 'alt-claude') };
    put(home, 'alt-claude/settings.json', '{"hooks":{}}');
    put(home, 'alt-claude/plugins/installed_plugins.json', '{"plugins":{}}');
    const before = printUserFiles(home, SID, budget(), ctx);

    put(home, 'alt-claude/settings.json', '{"hooks":{"Stop":[]}}');
    put(home, 'alt-claude/plugins/installed_plugins.json', '{"plugins":{"x@y":[]}}');
    expect(changes(home, before, ctx)).toEqual([
      '(user) ~/alt-claude/plugins/installed_plugins.json: plugins',
      '(user) ~/alt-claude/settings.json: hooks',
    ]);
  });

  it('the OSS hooks and bin, by content; a big file by stat; a FIFO by type, never read', () => {
    const home = tempHome();
    put(home, '.oss/hooks/oss-value.sh', '#!/bin/bash\n');
    put(home, '.oss/bin/oss-decrypt', Buffer.alloc(2 * 1024 * 1024, 1));
    execFileSync('mkfifo', [path.join(home, '.oss/hooks/pipe')]);
    const before = printUserFiles(home, SID, budget());
    put(home, '.oss/hooks/oss-value.sh', '#!/bin/bash\n');
    expect(changes(home, before)).toEqual([]);

    put(home, '.oss/hooks/new.sh', 'x\n');
    fs.appendFileSync(path.join(home, '.oss/bin/oss-decrypt'), 'x');
    expect(before['~/.oss/hooks/pipe']).toMatch(/^type:/);
    expect(changes(home, before)).toEqual(['(user) ~/.oss/bin/oss-decrypt', '(user) ~/.oss/hooks/new.sh']);
  });

  it("leaves out the decrypt CLI's download folder and its upgrade-failed stamp", () => {
    const home = tempHome();
    put(home, '.oss/bin/oss-decrypt', 'v1\n');
    const before = printUserFiles(home, SID, budget());
    put(home, '.oss/bin/.download/oss-decrypt.part', 'partial');
    put(home, '.oss/bin/.decrypt-upgrade-failed', '1');

    expect(changes(home, before)).toEqual([]);
  });

  it("covers only this session's repos.json among the check's own records", () => {
    const home = tempHome();
    const before = printUserFiles(home, SID, budget());
    put(home, `.oss/gate-state/${SID}/agent-1.snap.json`, '{}');
    put(home, '.oss/gate-state/other/repos.json', '[]');
    put(home, `.oss/gate-state/${SID}/repos.json`, '["/x"]');

    expect(changes(home, before)).toEqual([`(user) ~/.oss/gate-state/${SID}/repos.json`]);
  });

  it("covers the installed OSS plugin's gate parts, not its other folders, other plugins' files, the store or marketplaces", () => {
    const home = tempHome();
    installOss(home);
    const before = printUserFiles(home, SID, budget());

    put(home, `${OSS}/agents/a.md`, 'changed\n');
    put(home, '.claude/plugins/cache/mkt/other/1.0.0/hooks/h.sh', 'changed\n');
    put(home, '.claude/plugins/store/s.json', '2');
    put(home, '.claude/plugins/marketplaces/m/x', '2');
    expect(changes(home, before)).toEqual([]);

    for (const rel of ['hooks/oss-tool-gate.sh', 'hooks.json', 'config/tool-gates.json', 'watcher/dist/cli/tool-gate.cjs', '.claude-plugin/plugin.json']) {
      put(home, `${OSS}/${rel}`, 'changed\n');
    }
    expect(changes(home, before)).toEqual(
      ['.claude-plugin/plugin.json', 'config/tool-gates.json', 'hooks.json', 'hooks/oss-tool-gate.sh', 'watcher/dist/cli/tool-gate.cjs'].map(
        (rel) => `(user) ~/${OSS}/${rel}`,
      ),
    );
  });

  it('hashes by content only what the hooks run (hooks.json, hooks/*, config, .claude-plugin, the two CLI bundles); the rest of watcher/dist and hooks/__tests__ by stat (perf LOW 4)', () => {
    const home = tempHome();
    installOss(home);
    put(home, `${OSS}/watcher/dist/cli/gate-run.cjs`, 'g\n');
    put(home, `${OSS}/watcher/dist/cli/other.js`, 'o\n');
    put(home, `${OSS}/watcher/dist/lib/deep/x.js`, 'x\n');
    put(home, `${OSS}/hooks/oss-node.sh`, '#!/bin/bash\n');
    put(home, `${OSS}/hooks/__tests__/t.test.sh`, '#!/bin/bash\n');
    const print = printUserFiles(home, SID, budget());
    const at = (rel: string): string => print[`~/${OSS}/${rel}`] ?? 'unrecorded';

    for (const rel of ['hooks.json', 'hooks/oss-tool-gate.sh', 'hooks/oss-node.sh', 'config/tool-gates.json', '.claude-plugin/plugin.json', 'watcher/dist/cli/tool-gate.cjs', 'watcher/dist/cli/gate-run.cjs']) {
      expect(at(rel), rel).toMatch(/^sha:/);
    }
    for (const rel of ['watcher/dist/cli/other.js', 'watcher/dist/lib/deep/x.js', 'hooks/__tests__/t.test.sh']) {
      expect(at(rel), rel).toMatch(/^stat:/);
    }
  });

  it("installed_plugins.json: any change to its plugins object voids (another plugin's entry, a new plugin, the OSS path)", () => {
    const home = tempHome();
    installOss(home);
    const before = printUserFiles(home, SID, budget());
    const file = path.join(home, '.claude/plugins/installed_plugins.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; plugins: Record<string, Array<Record<string, unknown>>> };
    data.version = 3;
    fs.writeFileSync(file, JSON.stringify(data));
    expect(changes(home, before)).toEqual([]);

    data.plugins['other@mkt'][0].version = '2.0.0';
    fs.writeFileSync(file, JSON.stringify(data));
    expect(changes(home, before)).toEqual(['(user) ~/.claude/plugins/installed_plugins.json: plugins']);

    delete data.plugins['other@mkt'][0].version;
    data.plugins['new@mkt'] = [{ scope: 'user', installPath: path.join(home, 'x') }];
    fs.writeFileSync(file, JSON.stringify(data));
    expect(changes(home, before)).toEqual(['(user) ~/.claude/plugins/installed_plugins.json: plugins']);
  });

  it('also covers the gate parts of the plugin roots the gate runs from, when they differ from the install path', () => {
    const home = tempHome();
    installOss(home);
    const running = path.join(home, 'dev/oss-checkout');
    put(home, 'dev/oss-checkout/hooks/oss-tool-gate.sh', '#!/bin/bash\n');
    put(home, 'dev/oss-checkout/agents/a.md', 'a\n');
    const ctx: UserContext = { pluginRoots: [running, path.join(home, OSS)] };
    const before = printUserFiles(home, SID, budget(), ctx);

    put(home, 'dev/oss-checkout/agents/a.md', 'changed\n');
    expect(changes(home, before, ctx)).toEqual([]);

    put(home, 'dev/oss-checkout/hooks/oss-tool-gate.sh', 'exit 0\n');
    expect(changes(home, before, ctx)).toEqual(['(user) ~/dev/oss-checkout/hooks/oss-tool-gate.sh']);
  });

  it('records the node the hooks run (~/.oss/node-path and its binary) and any node, cat, mktemp or bash PATH puts before the real one', () => {
    const home = tempHome();
    put(home, 'nodebin/node', 'real node\n');
    fs.chmodSync(path.join(home, 'nodebin/node'), 0o755);
    put(home, '.oss/node-path', `${path.join(home, 'nodebin/node')}\n`);
    fs.mkdirSync(path.join(home, 'early'));
    fs.mkdirSync(path.join(home, 'late'));
    const ctx: UserContext = { pathEnv: [path.join(home, 'early'), path.join(home, 'nodebin'), path.join(home, 'late'), '/usr/bin', '/bin'].join(':') };
    const before = printUserFiles(home, SID, budget(), ctx);

    put(home, 'late/node', 'after the real one\n');
    expect(changes(home, before, ctx)).toEqual([]);

    put(home, 'early/node', 'shadow\n');
    put(home, 'early/cat', 'shadow\n');
    expect(changes(home, before, ctx)).toEqual(['(user) PATH: ~/early/cat', '(user) PATH: ~/early/node']);

    put(home, 'nodebin/node', 'swapped\n');
    put(home, '.oss/node-path', '/elsewhere/node\n');
    expect(changes(home, before, ctx)).toEqual(
      expect.arrayContaining(['(user) ~/.oss/node-path', `(user) node: ~/nodebin/node`]),
    );
  });

  it('leaves out shell rc files, git/npm/ssh config, CLAUDE.md, agents and commands (layer 1 refuses plain writes there)', () => {
    const home = tempHome();
    const before = printUserFiles(home, SID, budget());
    for (const rel of ['.zshrc', '.bashrc', '.npmrc', '.gitconfig', '.config/git/config', '.ssh/config', '.claude/CLAUDE.md', '.claude/agents/x.md', '.claude/commands/y.md']) {
      put(home, rel, 'x\n');
    }

    expect(changes(home, before)).toEqual([]);
  });

  it('fails (throws) when the time budget is spent, so the run reads unverified', () => {
    const home = tempHome();
    expect(() => printUserFiles(home, SID, { deadline: Date.now() - 1 })).toThrow();
  });
});
