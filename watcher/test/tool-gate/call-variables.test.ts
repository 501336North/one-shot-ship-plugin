/**
 * Simple variables inside one Bash call (R-266 round 4, L).
 *
 * @behavior A call that names the plugin's own scripts through variables it sets itself
 *   (`PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"`, `X="$PLUGIN_ROOT/…"`,
 *   `node "$X"`) is read with those variables filled in, so the gate knows the script it runs.
 * @business-rule a variable is filled in only when its value is certain: set once, at the start of
 *   the call, from plain text, the home folder and a plugin folder the gate trusts; never when the
 *   call sets CLAUDE_PLUGIN_ROOT, HOME or PATH, or the value holds `$(`, a backtick, `..` or a wildcard.
 */

import { describe, it, expect } from 'vitest';
import { resolveCallVariables } from '../../src/tool-gate/call-variables.js';

const HOME = '/home/dev';
const PLUGIN = '/plugins/oss';
const ROOT_LINE = 'PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"';
const CLI_LINE = 'WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"';
const SCRIPT = `${PLUGIN}/watcher/dist/cli/update-workflow-state.js`;

function resolve(command: string, pluginRoot: string | null = PLUGIN): string {
  return resolveCallVariables(command, HOME, pluginRoot);
}

describe('resolveCallVariables: filled in', () => {
  it('fills in the plugin folder and a script under it, on separate lines', () => {
    const command = [ROOT_LINE, CLI_LINE, 'node "$WORKFLOW_STATE_CLI" clearActiveAgent'].join('\n');
    expect(resolve(command)).toContain(`node "${SCRIPT}" clearActiveAgent`);
  });

  it('fills in after `;` and `&&`, and `${NAME}` as well as `$NAME`', () => {
    const command = `${ROOT_LINE}; ${CLI_LINE} && node \${WORKFLOW_STATE_CLI} x`;
    expect(resolve(command)).toContain(`node ${SCRIPT} x`);
  });

  it('fills in plain text and the home folder', () => {
    expect(resolve('D="$HOME/notes"; ls "$D"')).toContain('ls "/home/dev/notes"');
  });
});

describe('resolveCallVariables: left alone', () => {
  it.each([
    ['a plugin folder the gate does not trust', [ROOT_LINE, CLI_LINE, 'node "$WORKFLOW_STATE_CLI"'].join('\n'), null],
    ['a call that sets CLAUDE_PLUGIN_ROOT', ['CLAUDE_PLUGIN_ROOT=/tmp/evil', ROOT_LINE, CLI_LINE, 'node "$WORKFLOW_STATE_CLI"'].join('\n'), PLUGIN],
    ['a call that sets HOME', ['export HOME=/tmp/evil', ROOT_LINE, CLI_LINE, 'node "$WORKFLOW_STATE_CLI"'].join('\n'), PLUGIN],
    ['a call that sets PATH', [ROOT_LINE, CLI_LINE, 'PATH=/tmp/evil node "$WORKFLOW_STATE_CLI"'].join('\n'), PLUGIN],
    ['a value with $( … )', 'X="$(pwd)/a.js"; node "$X"', PLUGIN],
    ['a value with a backtick', 'X="`pwd`/a.js"; node "$X"', PLUGIN],
    ['a value with ..', 'X="$HOME/../evil.js"; node "$X"', PLUGIN],
    ['a value with a wildcard', 'X="$HOME/*.js"; node "$X"', PLUGIN],
    ['a variable set again later', 'X="$HOME/a.js"; X=/tmp/b.js; node "$X"', PLUGIN],
    ['a variable set by read', 'X="$HOME/a.js"; read X; node "$X"', PLUGIN],
    ['an assignment after a command', 'cd /tmp; X="$HOME/a.js"; node "$X"', PLUGIN],
    ['a call with a heredoc', 'X="$HOME/a.js"; cat <<EOF\n$X\nEOF\nnode "$X"', PLUGIN],
  ])('leaves %s', (_why, command, pluginRoot) => {
    expect(resolve(command, pluginRoot)).toBe(command);
  });

  it('never fills in inside single quotes', () => {
    const command = `X="$HOME/a.js"; echo '$X'; node "$X"`;
    expect(resolve(command)).toBe(`X="$HOME/a.js"; echo '$X'; node "/home/dev/a.js"`);
  });
});

/**
 * Round 5 (perf F1/F2, CR H1, sec H7, CR I3).
 * @behavior a call too large or with too many assignments is left as it is, fast; a call that could
 *   change a variable some other way, or names one the shell sets itself, is left as it is.
 * @business-rule the gate never fails open on a call's variables: any doubt leaves them unknown.
 */
describe('resolveCallVariables: round 5, size caps', () => {
  it('leaves a 50,000-character value referenced 20,000 times as it is', () => {
    const command = `X="${'a'.repeat(50_000)}"; echo${' $X'.repeat(20_000)}`;
    expect(resolve(command)).toBe(command);
  });

  it('leaves a call with 20,000 assignments as it is, within a second', () => {
    const command = `${Array.from({ length: 20_000 }, (_, i) => `A${i}="v"`).join('\n')}\necho "$A1"`;
    const started = performance.now();
    expect(resolve(command)).toBe(command);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('leaves a call with more than 64 assignments as it is', () => {
    const command = `${Array.from({ length: 65 }, (_, i) => `A${i}="v"`).join('\n')}\necho "$A1"`;
    expect(resolve(command)).toBe(command);
  });

  it('still fills in a call with 64 assignments', () => {
    const command = `${Array.from({ length: 64 }, (_, i) => `A${i}="v${i}"`).join('\n')}\necho "$A1"`;
    expect(resolve(command)).toContain('echo "v1"');
  });

  it('leaves a call whose filled-in text would grow past the cap as it is', () => {
    const command = `X="${'a'.repeat(4_000)}"; echo${' $X'.repeat(100)}`;
    expect(resolve(command)).toBe(command);
  });
});

describe('resolveCallVariables: round 5, other ways to set a variable', () => {
  it.each([
    'declare y=1', 'typeset y=1', 'export Z=1', 'local y', 'readonly y', 'read y', 'mapfile y', 'readarray y', 'printf -v X %s y', 'getopts ab X',
    'let X=1', 'unset X', 'eval true', 'source f', '. ./f', 'cd /tmp', 'pushd /tmp', 'popd', 'echo ${(e)X}', 'echo ${X::=y}', 'echo ${X:=y}',
  ])('leaves a call with `%s`', (statement) => {
    const command = `X="$HOME/a.js"; ${statement}; node "$X"`;
    expect(resolve(command)).toBe(command);
  });

  it.each(['PWD', 'OLDPWD', 'REPLY', 'MAPFILE', 'OPTARG', 'OPTIND', 'BASH_ARGV0', 'RANDOM', 'SECONDS', 'LINENO', 'UID', 'EUID', 'PPID', 'reply', 'match', 'MATCH', 'status', 'argv'])(
    'never fills in %s, which the shell sets itself',
    (name) => {
      const command = `${name}="$HOME/a.js"; node "$${name}"`;
      expect(resolve(command)).toBe(command);
    },
  );

  it("leaves a call with $'…' text", () => {
    const command = `X="$HOME/a.js"; echo $'it\\'s $X'; node "$X"`;
    expect(resolve(command)).toBe(command);
  });
});

/**
 * Round 6 (perf C2, CR M3).
 * @behavior a value that grows past the output cap (chained doubling) leaves the call as it is,
 *   quickly; zsh's own ways to set a variable leave it as it is too.
 * @business-rule the gate never fails open on a call's variables.
 */
describe('resolveCallVariables: round 6', () => {
  it('leaves a chain of doubling assignments as it is, quickly', () => {
    const names = Array.from({ length: 60 }, (_, i) => `V${i}`);
    const command = [`V0="${'a'.repeat(1_000)}"`, ...names.slice(1).map((n, i) => `${n}="$${names[i]}$${names[i]}"`), `echo "$V59"`].join('\n');
    const started = performance.now();
    expect(resolve(command)).toBe(command);
    expect(performance.now() - started).toBeLessThan(500);
  });

  // the name is built when it runs (`\x58` is X), so only the setter's own word shows it
  it.each(['print -v N y', 'set -A N a b', 'set +A N a', 'integer N=1', 'float N=1', 'private N', 'vared N', 'zparseopts -D a=N', 'sysread N', 'strftime -s N %s 0', 'zstat -A N f', 'zle -U N', 'getln N'])(
    'leaves a call with `%s`',
    (statement) => {
      const command = `X="$HOME/a.js"; ${statement.replace('N', `"$(printf '\\x58')"`)}; node "$X"`;
      expect(resolve(command)).toBe(command);
    },
  );
});
