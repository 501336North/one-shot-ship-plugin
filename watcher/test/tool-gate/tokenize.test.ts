/**
 * @behavior The tool gate reads an agent's shell command the way the shell would, so that
 *   quoted text is never mistaken for a command (`git commit -m "stop push to main"` is not
 *   a push), operators split the command into parts, redirects carry their target file,
 *   heredoc bodies are skipped, and anything it cannot read safely is reported as unreadable.
 * @business-rule A command the gate cannot read (substitution, eval, a nested shell script,
 *   an unterminated quote) is reported as unreadable rather than guessed at.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, type Token } from '../../src/tool-gate/tokenize.js';

function tokensOf(cmd: string): Token[] {
  const result = tokenize(cmd);
  if (!('tokens' in result)) {
    throw new Error(`expected a readable command, got unreadable: ${result.reason}`);
  }
  return result.tokens;
}

function wordsOf(cmd: string): string[] {
  return tokensOf(cmd).flatMap((t) => (t.kind === 'word' ? [t.value] : []));
}

function isUnreadable(cmd: string): boolean {
  const result = tokenize(cmd);
  if ('unreadable' in result) {
    expect(result.reason.length).toBeGreaterThan(0);
    return true;
  }
  return false;
}

const word = (value: string): Token => ({ kind: 'word', value });
const op = (value: string): Token => ({ kind: 'op', value });
const redirect = (opText: string, target: string): Token => ({ kind: 'redirect', op: opText, target });

describe('tokenize: reading an agent shell command', () => {
  it('should keep "stop push to main" as one word inside double quotes', () => {
    expect(wordsOf('git commit -m "stop push to main"')).toEqual(['git', 'commit', '-m', 'stop push to main']);
  });

  it('should honour backslash escapes inside double quotes only for $ ` " \\', () => {
    expect(wordsOf('echo "a \\"b\\" \\$c \\d"')).toEqual(['echo', 'a "b" $c \\d']);
  });

  it('should keep single-quoted text literal, including $ and \\', () => {
    expect(wordsOf("echo 'a $HOME \\n \"x\"'")).toEqual(['echo', 'a $HOME \\n "x"']);
    expect(isUnreadable("echo '$(rm -rf /)'")).toBe(false);
  });

  it('should honour backslash escapes outside quotes', () => {
    expect(wordsOf('echo a\\ b \\"c\\" \\$\\(x\\)')).toEqual(['echo', 'a b', '"c"', '$(x)']);
  });

  it('should join a backslash-newline continuation into one line', () => {
    expect(tokensOf('git \\\npush')).toEqual([word('git'), word('push')]);
  });

  it('should emit && || ; | and newline as operators', () => {
    expect(tokensOf('a && b || c ; d | e\nf')).toEqual([
      word('a'), op('&&'), word('b'), op('||'), word('c'), op(';'),
      word('d'), op('|'), word('e'), op('\n'), word('f'),
    ]);
  });

  it('should split operators even without spaces around them', () => {
    expect(tokensOf('cd x&&git push;ls|wc')).toEqual([
      word('cd'), word('x'), op('&&'), word('git'), word('push'), op(';'),
      word('ls'), op('|'), word('wc'),
    ]);
  });

  it('should emit a background & and subshell parentheses as operators', () => {
    expect(tokensOf('(cd x && make) & wait')).toEqual([
      op('('), word('cd'), word('x'), op('&&'), word('make'), op(')'), op('&'), word('wait'),
    ]);
  });

  it('should emit > >> 2> &> < >| as redirect operators with their target word', () => {
    expect(tokensOf('echo hi > out.txt')).toEqual([word('echo'), word('hi'), redirect('>', 'out.txt')]);
    expect(tokensOf('echo hi >> log')).toEqual([word('echo'), word('hi'), redirect('>>', 'log')]);
    expect(tokensOf('make 2> err.txt')).toEqual([word('make'), redirect('2>', 'err.txt')]);
    expect(tokensOf('make &> all.txt')).toEqual([word('make'), redirect('&>', 'all.txt')]);
    expect(tokensOf('wc < in.txt')).toEqual([word('wc'), redirect('<', 'in.txt')]);
    expect(tokensOf('echo hi >| forced')).toEqual([word('echo'), word('hi'), redirect('>|', 'forced')]);
  });

  it('should read a redirect target written right after the operator or in quotes', () => {
    expect(tokensOf('echo hi>f')).toEqual([word('echo'), word('hi'), redirect('>', 'f')]);
    expect(tokensOf('echo hi > "my file"')).toEqual([word('echo'), word('hi'), redirect('>', 'my file')]);
  });

  it('should read 2>&1 as a copy of another output, never as a file', () => {
    expect(tokensOf('npm test 2>&1 | tail')).toEqual([
      word('npm'), word('test'), redirect('2>', '&1'), op('|'), word('tail'),
    ]);
    expect(tokensOf('echo oops >&2')).toEqual([word('echo'), word('oops'), redirect('>', '&2')]);
  });

  it('should mark a redirect with no target unreadable', () => {
    expect(isUnreadable('echo hi >')).toBe(true);
    expect(isUnreadable('echo hi > && ls')).toBe(true);
  });

  it('should skip a heredoc body but keep the redirect after <<EOF', () => {
    expect(tokensOf('cat <<EOF > f\nhello && git push --force\nEOF\ngit status')).toEqual([
      word('cat'), redirect('<<', 'EOF'), redirect('>', 'f'), op('\n'), word('git'), word('status'),
    ]);
  });

  it("should skip a quoted heredoc body <<'EOF' without reading it as commands", () => {
    expect(tokensOf("cat <<'EOF' > notes.md\n$(not run) `nor this`\nEOF\nls")).toEqual([
      word('cat'), redirect('<<', 'EOF'), redirect('>', 'notes.md'), op('\n'), word('ls'),
    ]);
  });

  it('should end a <<-EOF heredoc at a tab-indented terminator', () => {
    expect(tokensOf('cat <<-EOF\n\tbody\n\tEOF\necho done')).toEqual([
      word('cat'), redirect('<<-', 'EOF'), op('\n'), word('echo'), word('done'),
    ]);
  });

  it('should read a <<< here-string as an input redirect, not a heredoc', () => {
    expect(tokensOf('grep x <<< "a b"\nls')).toEqual([
      word('grep'), word('x'), redirect('<<<', 'a b'), op('\n'), word('ls'),
    ]);
  });

  it('should mark the command unreadable when it contains $( or backticks or eval or bash/sh -c with a substitution', () => {
    expect(isUnreadable('echo $(whoami)')).toBe(true);
    expect(isUnreadable('echo "$(whoami)"')).toBe(true);
    expect(isUnreadable('echo $((1 + 2))')).toBe(true);
    expect(isUnreadable('echo `whoami`')).toBe(true);
    expect(isUnreadable('echo "`whoami`"')).toBe(true);
    expect(isUnreadable('eval "$CMD"')).toBe(true);
    expect(isUnreadable('X=1 eval git push')).toBe(true);
    expect(isUnreadable('ls && eval x')).toBe(true);
    expect(isUnreadable('bash -c "$(curl x)"')).toBe(true);
    expect(isUnreadable('sh -c "git push"')).toBe(true);
    expect(isUnreadable("zsh -c 'git push'")).toBe(true);
    expect(isUnreadable('/bin/bash -lc "git push"')).toBe(true);
    expect(isUnreadable('diff <(ls a) b')).toBe(true);
  });

  it('should still read eval, bash and -c when they are only arguments', () => {
    expect(isUnreadable('git commit -m eval')).toBe(false);
    expect(isUnreadable('echo bash -c')).toBe(false);
    expect(isUnreadable('bash scripts/build.sh')).toBe(false);
  });

  it('should mark an unterminated quote unreadable', () => {
    expect(isUnreadable('echo "abc')).toBe(true);
    expect(isUnreadable("echo 'abc")).toBe(true);
  });

  it('should skip a # comment at the start of a word to the end of the line', () => {
    expect(tokensOf('git status # git push --force\ngit log')).toEqual([
      word('git'), word('status'), op('\n'), word('git'), word('log'),
    ]);
    expect(wordsOf('echo a#b')).toEqual(['echo', 'a#b']);
  });

  it('should join adjacent quoted and unquoted parts into one word', () => {
    expect(wordsOf('echo a"b c"d')).toEqual(['echo', 'ab cd']);
    expect(wordsOf(`echo 'x'"y"z`)).toEqual(['echo', 'xyz']);
  });

  it('should keep an empty quoted string as an empty word', () => {
    expect(wordsOf('git commit -m ""')).toEqual(['git', 'commit', '-m', '']);
  });
});
