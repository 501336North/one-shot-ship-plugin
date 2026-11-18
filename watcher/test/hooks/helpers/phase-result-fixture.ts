import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Test setup for hooks that gate `complete` on a phase result (R-257 AC-001.1): a real git repo on the
// feat/<feature>/<phase> branch, and a valid assembled result made by the shell fixture
// hooks/__tests__/lib/phase-result-fixture.sh (prf_build, prf_ship) through the real hooks.

const PLUGIN_ROOT = path.resolve(__dirname, '../../../..');

/** The node the plugin records in ~/.oss/node-path (T26/D21): this node, resolved, so outside temp folders. */
export function recordNodePath(home: string): void {
  fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'node-path'), `${fs.realpathSync(process.execPath)}\n`);
}

/** `dir` becomes a git repo with one commit, on feat/<feature>/<phase>, holding that feature's dev-docs folder. */
export function makeFeatureRepo(dir: string, feature: string, phase: 'build' | 'ship'): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  git('checkout', '-q', '-b', `feat/${feature}/${phase}`);
  fs.mkdirSync(path.join(dir, '.oss', 'dev', 'active', feature), { recursive: true });
}

const RUN_FIXTURE = [
  'set -u',
  'source "$ROOT/hooks/__tests__/lib/phase-result-fixture.sh"',
  'envrun() { (cd "$PRF_REPO" && "$@" </dev/null); }',
  // The phase was already started by the caller (as /oss:ship's wrapper does): do not start a second run.
  'if [ "$2" = started ]; then prf_notify() { :; }; fi',
  '"prf_$1"',
].join('\n');

/**
 * Assemble a valid `phase` result in `repo`, run with `env` (the same HOME, plugin root and session the
 * hook under test will see). By default the fixture starts the phase itself; `alreadyStarted` skips that.
 */
export function assemblePhaseResult(
  phase: 'build' | 'ship',
  repo: string,
  env: NodeJS.ProcessEnv,
  alreadyStarted = false,
): void {
  execFileSync('/bin/bash', ['-c', RUN_FIXTURE, 'prf', phase, alreadyStarted ? 'started' : 'fresh'], {
    env: { ...env, ROOT: PLUGIN_ROOT, SH: '/bin/bash', PRF_REPO: repo },
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 120000,
  });
}
