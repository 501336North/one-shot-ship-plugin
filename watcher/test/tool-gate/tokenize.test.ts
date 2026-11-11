/**
 * @behavior The tool gate reads an agent's shell command the way the shell would, so that
 *   quoted text is never mistaken for a command (`git commit -m "stop push to main"` is not
 *   a push), operators split the command into parts, redirects carry their target file,
 *   heredoc bodies are skipped, and anything it cannot read safely is reported as unreadable.
 * @business-rule A command the gate cannot read (an unterminated quote or substitution, nesting
 *   too deep, input too large) is reported as unreadable rather than guessed at. Text only known
 *   when the command runs (a substitution, a variable, `~user`) is an unknown part of its word,
 *   and the commands a substitution runs are returned with it so they are still checked. `eval` and `bash -c` scripts are returned
 *   as words; the command reader decides whether they can be read (ADR-009).
 */

import { describe, it, expect } from 'vitest';
import { dotsOf, globOf, heredocBodyOf, tokenize, UNKNOWN, type Token } from '../../src/tool-gate/tokenize.js';

const HOME = '/home/dev';

function tokensOf(cmd: string): Token[] {
  const result = tokenize(cmd, HOME);
  if (!('tokens' in result)) {
    throw new Error(`expected a readable command, got unreadable: ${result.reason}`);
  }
  return result.tokens;
}

function wordsOf(cmd: string): string[] {
  return tokensOf(cmd).flatMap((t) => (t.kind === 'word' ? [t.value] : []));
}

function isUnreadable(cmd: string): boolean {
  const result = tokenize(cmd, HOME);
  if ('unreadable' in result) {
    expect(result.reason.length).toBeGreaterThan(0);
    return true;
  }
  return false;
}

const word = (value: string): Token => ({ kind: 'word', value });
const op = (value: string): Token => ({ kind: 'op', value });
const redirect = (opText: string, target: string): Token => ({ kind: 'redirect', op: opText, target });
/** A word holding command or process substitutions, with the tokens of each one's script. */
const subst = (value: string, ...scripts: Token[][]): Token => ({ kind: 'word', value, scripts });

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

  it('should read >& followed by a space as one redirect onto the next word', () => {
    expect(tokensOf('echo x >& out.txt')).toEqual([word('echo'), word('x'), redirect('>', '&out.txt')]);
    expect(tokensOf('echo x >& 2')).toEqual([word('echo'), word('x'), redirect('>', '&2')]);
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

  // ADR-009 (user decision): eval and `bash -c` scripts are read by the command reader,
  // which decides whether the script is literal; the tokenizer now returns their tokens.
  it('should return the words of eval and of a nested shell -c script, for the reader to read', () => {
    expect(wordsOf('eval "$CMD"')).toEqual(['eval', UNKNOWN]);
    expect(wordsOf('X=1 eval git push')).toEqual(['X=1', 'eval', 'git', 'push']);
    expect(wordsOf('ls && eval x')).toEqual(['ls', 'eval', 'x']);
    expect(wordsOf('sh -c "git push"')).toEqual(['sh', '-c', 'git push']);
    expect(wordsOf("zsh -c 'git push'")).toEqual(['zsh', '-c', 'git push']);
    expect(wordsOf('/bin/bash -lc "git push"')).toEqual(['/bin/bash', '-lc', 'git push']);
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

describe('tokenize: bash $\'…\' (ANSI-C) and $"…" quoting', () => {
  it('should decode $\'…\' so a hidden branch name is seen as written', () => {
    expect(wordsOf("git push origin $'HEAD:main'")).toEqual(['git', 'push', 'origin', 'HEAD:main']);
  });

  it('should join $\'…\' with the parts next to it', () => {
    expect(wordsOf("echo a$'b'c")).toEqual(['echo', 'abc']);
  });

  it('should decode the simple backslash escapes', () => {
    expect(wordsOf(String.raw`echo $'\\\'\"\n\t\r\a\b\e\E\f\v\?'`)).toEqual([
      'echo', '\\\'"\n\t\r\x07\b\x1b\x1b\f\v?',
    ]);
  });

  it('should decode hex, octal, unicode and control-character escapes', () => {
    expect(wordsOf(String.raw`echo $'m\x61in'`)).toEqual(['echo', 'main']);
    expect(wordsOf(String.raw`echo $'\155ain'`)).toEqual(['echo', 'main']);
    expect(wordsOf(String.raw`echo $'\x6'`)).toEqual(['echo', '\x06']);
    expect(wordsOf(String.raw`git push origin $'main\0junk'`)).toEqual(['git', 'push', 'origin', 'main']);
    expect(wordsOf(String.raw`echo a$'b\0c'd`)).toEqual(['echo', 'abd']);
    const backslash = '\\';
    expect(wordsOf(`echo $'${backslash}u006dain'`)).toEqual(['echo', 'main']);
    expect(wordsOf(String.raw`echo $'\u6d'`)).toEqual(['echo', 'm']);
    expect(wordsOf(String.raw`echo $'\U0000006dain'`)).toEqual(['echo', 'main']);
    expect(wordsOf(String.raw`echo $'\cA'`)).toEqual(['echo', '\x01']);
    expect(wordsOf(String.raw`echo $'\c?'`)).toEqual(['echo', '\x7f']);
  });

  it('should keep an unknown escape as written, like bash', () => {
    expect(wordsOf(String.raw`echo $'\q\xZ'`)).toEqual(['echo', String.raw`\q\xZ`]);
  });

  it('should mark an unterminated $\'… quote unreadable', () => {
    expect(isUnreadable("git push origin $'main")).toBe(true);
    expect(isUnreadable(String.raw`echo $'abc\'`)).toBe(true);
  });

  it('should mark a $\'…\' escape beyond the last Unicode character unreadable', () => {
    expect(isUnreadable(String.raw`git push origin $'\UFFFFFFFF'`)).toBe(true);
  });

  it('should keep $\' as plain text inside double quotes', () => {
    expect(wordsOf(`echo "$'x'"`)).toEqual(['echo', "$'x'"]);
  });

  it('should read $"…" like an ordinary double-quoted string', () => {
    expect(wordsOf('git push origin $"main"')).toEqual(['git', 'push', 'origin', 'main']);
  });
});

describe('tokenize: command and process substitution', () => {
  it('should read $( … ) as an unknown word and return the command it runs', () => {
    expect(tokensOf('echo $(whoami)')).toEqual([word('echo'), subst(UNKNOWN, [word('whoami')])]);
  });

  it('should read a substitution inside double quotes the same way', () => {
    expect(tokensOf('git push --force origin "$(git branch --show-current)"')).toEqual([
      word('git'), word('push'), word('--force'), word('origin'),
      subst(UNKNOWN, [word('git'), word('branch'), word('--show-current')]),
    ]);
  });

  it('should read backticks, plain and inside double quotes, as a substitution', () => {
    expect(tokensOf('echo `whoami`')).toEqual([word('echo'), subst(UNKNOWN, [word('whoami')])]);
    expect(tokensOf('echo "`rm -rf x`"')).toEqual([
      word('echo'), subst(UNKNOWN, [word('rm'), word('-rf'), word('x')]),
    ]);
  });

  it('should undo the backslashes a backtick script escapes before reading it', () => {
    expect(tokensOf('echo `echo \\`date\\``')).toEqual([
      word('echo'), subst(UNKNOWN, [word('echo'), subst(UNKNOWN, [word('date')])]),
    ]);
  });

  it('should keep the known text around a substitution in the same word', () => {
    expect(tokensOf('echo a$(x)b')).toEqual([word('echo'), subst(`a${UNKNOWN}b`, [word('x')])]);
    expect(tokensOf('x=$(git push --force)')).toEqual([
      subst(`x=${UNKNOWN}`, [word('git'), word('push'), word('--force')]),
    ]);
  });

  it('should read a substitution nested in another one', () => {
    expect(tokensOf('echo $(echo "$(whoami)")')).toEqual([
      word('echo'), subst(UNKNOWN, [word('echo'), subst(UNKNOWN, [word('whoami')])]),
    ]);
  });

  it('should end a substitution at its own closing parenthesis, not one in quotes or a subshell', () => {
    expect(tokensOf(String.raw`echo $(echo ")" \)) done`)).toEqual([
      word('echo'), subst(UNKNOWN, [word('echo'), word(')'), word(')')]), word('done'),
    ]);
    expect(tokensOf('echo $( (cd x && ls) ) y')).toEqual([
      word('echo'),
      subst(UNKNOWN, [op('('), word('cd'), word('x'), op('&&'), word('ls'), op(')')]),
      word('y'),
    ]);
  });

  it('should read the operators inside a substitution as part of its script', () => {
    expect(tokensOf('echo $(cd a; git push -f)')).toEqual([
      word('echo'), subst(UNKNOWN, [word('cd'), word('a'), op(';'), word('git'), word('push'), word('-f')]),
    ]);
  });

  it('should return the substitution in a redirect target with the redirect', () => {
    expect(tokensOf('echo hi > "$(x)"')).toEqual([
      word('echo'), word('hi'), { kind: 'redirect', op: '>', target: UNKNOWN, scripts: [[word('x')]] },
    ]);
  });

  it('should read <( … ) and >( … ) as unknown words and return the commands they run', () => {
    expect(tokensOf('diff <(ls a) b')).toEqual([word('diff'), subst(UNKNOWN, [word('ls'), word('a')]), word('b')]);
    expect(tokensOf('cmd >(tee out.txt)')).toEqual([word('cmd'), subst(UNKNOWN, [word('tee'), word('out.txt')])]);
  });

  it('should read arithmetic $(( … )) as an unknown word that runs nothing', () => {
    expect(tokensOf('echo $((1 + (2 * 3)))')).toEqual([word('echo'), word(UNKNOWN)]);
  });

  it('should keep $( and backticks literal inside single quotes and when escaped', () => {
    expect(wordsOf("echo '$(rm -rf /)' \\`x\\`")).toEqual(['echo', '$(rm -rf /)', '`x`']);
  });

  it('should mark an unterminated substitution unreadable', () => {
    expect(isUnreadable('echo $(ls')).toBe(true);
    expect(isUnreadable('echo `ls')).toBe(true);
    expect(isUnreadable('echo "$(ls"')).toBe(true);
    expect(isUnreadable('diff <(ls a b')).toBe(true);
    expect(isUnreadable('echo $((1 + 2)')).toBe(true);
  });

  it('should mark arithmetic that runs a command unreadable', () => {
    expect(isUnreadable('echo $(( $(git push -f) + 1 ))')).toBe(true);
    expect(isUnreadable('echo $(( `git push -f` + 1 ))')).toBe(true);
  });

  it('should mark substitutions nested deeper than 64 unreadable', () => {
    const nested = (depth: number): string => `${'$('.repeat(depth)}ls${')'.repeat(depth)}`;
    expect(isUnreadable(`echo ${nested(64)}`)).toBe(false);
    expect(isUnreadable(`echo ${nested(65)}`)).toBe(true);
  });

  it('should not end a substitution at the ) that closes a case pattern inside it', () => {
    expect(tokensOf('echo "$(case y in a) git push --force;; esac)" done')).toEqual([
      word('echo'),
      subst(UNKNOWN, [
        word('case'), word('y'), word('in'), word('a'), op(')'),
        word('git'), word('push'), word('--force'), op(';;'), word('esac'),
      ]),
      word('done'),
    ]);
  });

  it('should read a case pattern with a leading ( and several patterns inside a substitution', () => {
    expect(tokensOf('x=$(case y in (a|b) ls;; c) pwd; esac) z')).toEqual([
      subst(`x=${UNKNOWN}`, [
        word('case'), word('y'), word('in'), op('('), word('a'), op('|'), word('b'), op(')'), word('ls'), op(';;'),
        word('c'), op(')'), word('pwd'), op(';'), word('esac'),
      ]),
      word('z'),
    ]);
  });

  it('should still end a substitution whose text only mentions case as an argument', () => {
    expect(tokensOf('echo $(echo case in a) b')).toEqual([
      word('echo'), subst(UNKNOWN, [word('echo'), word('case'), word('in'), word('a')]), word('b'),
    ]);
  });
});

describe('tokenize: heredoc bodies', () => {
  const heredoc = (target: string, ...scripts: Token[][]): Token =>
    scripts.length === 0
      ? { kind: 'redirect', op: '<<', target }
      : { kind: 'redirect', op: '<<', target, scripts };

  it('should return the commands an unquoted heredoc body substitutes, with the heredoc', () => {
    expect(tokensOf('cat <<EOF\nhello $(git push --force) and `rm -rf x`\nEOF\nls')).toEqual([
      word('cat'),
      heredoc('EOF', [word('git'), word('push'), word('--force')], [word('rm'), word('-rf'), word('x')]),
      op('\n'),
      word('ls'),
    ]);
  });

  it('should leave a heredoc body unread when any part of its delimiter is quoted, as bash does', () => {
    for (const delimiter of ["'EOF'", '"EOF"', '\\EOF', 'E"OF"']) {
      expect(tokensOf(`cat <<${delimiter}\n$(git push --force)\nEOF\nls`)).toEqual([
        word('cat'), heredoc('EOF'), op('\n'), word('ls'),
      ]);
    }
  });

  it('should keep an escaped $( or backtick in an unquoted heredoc body as text', () => {
    expect(tokensOf('cat <<EOF\n\\$(git push --force) \\`x\\`\nEOF')).toEqual([word('cat'), heredoc('EOF'), op('\n')]);
  });

  it('should read the substitutions of a tab-stripped <<- body', () => {
    expect(tokensOf('cat <<-EOF\n\t$(whoami)\n\tEOF')).toEqual([
      word('cat'), { kind: 'redirect', op: '<<-', target: 'EOF', scripts: [[word('whoami')]] }, op('\n'),
    ]);
  });

  it('should mark an unterminated substitution in an unquoted heredoc body unreadable', () => {
    expect(isUnreadable('cat <<EOF\n$(git push\nEOF')).toBe(true);
  });
});

describe('tokenize: variables and ~user', () => {
  it('should expand $HOME and ${HOME}, bare or in double quotes, to the home folder', () => {
    expect(wordsOf('rm $HOME/.claude/settings.json "${HOME}/.oss/hooks/x.sh" "$HOME"')).toEqual([
      'rm', '/home/dev/.claude/settings.json', '/home/dev/.oss/hooks/x.sh', '/home/dev',
    ]);
  });

  it("should keep '$HOME' literal in single quotes", () => {
    expect(wordsOf("echo '$HOME'")).toEqual(['echo', '$HOME']);
  });

  it('should read any other variable as unknown, never as empty', () => {
    expect(wordsOf('echo $X ${X} "$X/y" $HOMER ${X:-a} $1 "$@" $? $$')).toEqual([
      'echo', UNKNOWN, UNKNOWN, `${UNKNOWN}/y`, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN,
    ]);
  });

  it('should keep a $ that starts no variable as written', () => {
    expect(wordsOf('echo $ a$ "$"')).toEqual(['echo', '$', 'a$', '$']);
  });

  it('should mark an unterminated ${ unreadable, and one that runs a command', () => {
    expect(isUnreadable('echo ${X')).toBe(true);
    expect(isUnreadable('echo ${X:-$(git push -f)}')).toBe(true);
  });

  it("should expand ~ followed by the current user's name to the home folder", () => {
    expect(wordsOf('rm ~dev/.claude/settings.json')).toEqual(['rm', '/home/dev/.claude/settings.json']);
  });

  it("should read ~ followed by another user's name as unknown", () => {
    expect(wordsOf('rm ~bob/.ssh/x ~bob')).toEqual(['rm', `${UNKNOWN}/.ssh/x`, UNKNOWN]);
    expect(wordsOf('echo "~bob" a~bob')).toEqual(['echo', '~bob', 'a~bob']);
  });

  it('should drop NUL characters typed in the command, so the unknown marker cannot be faked', () => {
    expect(wordsOf(`echo a${UNKNOWN}b`)).toEqual(['echo', 'aDYNb']);
  });
});

describe('tokenize: brace expansion', () => {
  it('should expand a brace group into one word per choice, as bash does', () => {
    expect(wordsOf('git push origin feat/x:ma{i,}n')).toEqual(['git', 'push', 'origin', 'feat/x:main', 'feat/x:man']);
    expect(wordsOf('echo a{b,c}d{e,f}')).toEqual(['echo', 'abde', 'abdf', 'acde', 'acdf']);
  });

  it('should expand nested brace groups', () => {
    expect(wordsOf('echo a{b,c{d,e}}f')).toEqual(['echo', 'abf', 'acdf', 'acef']);
  });

  it('should leave {}, {x} and an unclosed group as written', () => {
    expect(wordsOf('echo {} {x} {a,b {}{a,b}')).toEqual(['echo', '{}', '{x}', '{a,b', '{}a', '{}b']);
  });

  it('should not expand braces in quotes or escaped', () => {
    expect(wordsOf(String.raw`echo "{a,b}" \{a,b\} {a\,b}`)).toEqual(['echo', '{a,b}', '{a,b}', '{a,b}']);
  });

  it('should expand a brace group in a redirect target into one redirect per file', () => {
    expect(tokensOf('echo x > .oss/tool-gates.{json,bak}')).toEqual([
      word('echo'), word('x'), redirect('>', '.oss/tool-gates.json'), redirect('>', '.oss/tool-gates.bak'),
    ]);
  });

  it('should expand small sequences, with a step and zero padding', () => {
    expect(wordsOf('echo {1..3} {c..a} {01..03} {1..10..4}')).toEqual([
      'echo', '1', '2', '3', 'c', 'b', 'a', '01', '02', '03', '1', '5', '9',
    ]);
  });

  it('should leave a sequence of more than 64 items as written', () => {
    expect(wordsOf('echo {1..65} {1..64}').length).toBe(2 + 64);
    expect(wordsOf('echo {1..65}')).toEqual(['echo', '{1..65}']);
  });

  it('should mark a word that expands to more than 256 words unreadable', () => {
    expect(isUnreadable(`echo ${'{a,b}'.repeat(8)}`)).toBe(false);
    expect(isUnreadable(`echo ${'{a,b}'.repeat(9)}`)).toBe(true);
  });

  it('should keep the substitutions of an expanded word, once', () => {
    expect(tokensOf('echo {a,b}$(x)')).toEqual([
      word('echo'), subst(`a${UNKNOWN}`, [word('x')]), word(`b${UNKNOWN}`),
    ]);
  });
});

describe('tokenize: limits that keep reading fast', () => {
  it('should mark a command over 1 MB unreadable', () => {
    expect(isUnreadable(`echo ${'a'.repeat(1024 * 1024)}`)).toBe(true);
  });

  it('should read long brace-heavy words quickly', () => {
    const started = Date.now();
    tokenize(`echo ${'{'.repeat(200_000)}${'a,'.repeat(100_000)}`, HOME);
    tokenize(`echo ${'{a,'.repeat(100_000)}`, HOME);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

/** The tokenizer's verdict: readable, unreadable but read on, or over a reading limit. */
function verdictOf(cmd: string): 'readable' | 'unreadable' | 'limit' {
  const result = tokenize(cmd, HOME);
  if (!('unreadable' in result)) return 'readable';
  return result.limit ? 'limit' : 'unreadable';
}

describe('tokenize: reading limits stop the read, other unreadable pieces are read past', () => {
  it('should stop at a reading limit once a call holds more than 2048 words, without building the rest', () => {
    const started = performance.now();
    expect(verdictOf(`echo ${'{1..64}{1..4} '.repeat(20_000)}`)).toBe('limit');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(verdictOf(`echo ${'w '.repeat(2047)}`)).toBe('readable');
    expect(verdictOf(`echo ${'w '.repeat(2048)}`)).toBe('limit');
  });

  it('should stop at a reading limit once the words of a call hold more than 64 KB', () => {
    expect(verdictOf(`echo ${'a'.repeat(60 * 1024)}`)).toBe('readable');
    expect(verdictOf(`echo ${'a'.repeat(65 * 1024)}`)).toBe('limit');
    expect(verdictOf(`echo ${'a'.repeat(40 * 1024)}{1,2}`)).toBe('limit');
  });

  it('should count the reading limits (size, nesting, braces) as limits', () => {
    expect(verdictOf(`echo ${'a'.repeat(1024 * 1024)}`)).toBe('limit');
    expect(verdictOf(`echo ${'$('.repeat(65)}ls${')'.repeat(65)}`)).toBe('limit');
    expect(verdictOf(`echo ${'{a,b}'.repeat(9)}`)).toBe('limit');
  });

  it('should read the commands inside ${…} and $((…)), flag them unreadable, and read on', () => {
    const result = tokenize('echo ${x:-$(git push -f)} $(( $(rm a) + 1 )); git push origin main', HOME);
    expect('unreadable' in result && !result.limit).toBe(true);
    expect(result.tokens).toEqual([
      word('echo'),
      subst(UNKNOWN, [word('git'), word('push'), word('-f')]),
      subst(UNKNOWN, [word('rm'), word('a')]),
      op(';'), word('git'), word('push'), word('origin'), word('main'),
    ]);
  });

  it('should keep the words read before an unterminated quote', () => {
    const result = tokenize('git push origin main; echo "x', HOME);
    expect('unreadable' in result && !result.limit).toBe(true);
    expect(result.tokens.slice(0, 5)).toEqual([word('git'), word('push'), word('origin'), word('main'), op(';')]);
  });
});

describe('tokenize: shell wildcards in words (unquoted * ? [ … ])', () => {
  /** Each word's text and, when it has an unquoted wildcard, its pattern (quoted wildcards escaped). */
  function globsOf(cmd: string): [string, string | undefined][] {
    return tokensOf(cmd).flatMap((t) => (t.kind === 'op' ? [] : [[t.kind === 'word' ? t.value : t.target, globOf(t)]]));
  }

  it('should mark a word with an unquoted * ? or [ … ] as a pattern', () => {
    expect(globsOf('rm .oss/* .os? .oss/tool-gate[s]')).toEqual([
      ['rm', undefined],
      ['.oss/*', '.oss/*'],
      ['.os?', '.os?'],
      ['.oss/tool-gate[s]', '.oss/tool-gate[s]'],
    ]);
  });

  it('should keep quoted or escaped wildcards literal: no pattern, or escaped inside one', () => {
    expect(globsOf(`echo '*' "a?" \\* x'*'*`)).toEqual([
      ['echo', undefined],
      ['*', undefined],
      ['a?', undefined],
      ['*', undefined],
      ['x**', 'x\\**'],
    ]);
  });

  it('should not mark a lone [ or a [ with no closing ] as a pattern', () => {
    expect(globsOf('[ -f a ] && echo [x')).toEqual([
      ['[', undefined], ['-f', undefined], ['a', undefined], [']', undefined], ['echo', undefined], ['[x', undefined],
    ]);
  });

  it('should mark a redirect target that is a pattern', () => {
    expect(globsOf('echo x > .oss/workflow-state.jso?')).toEqual([
      ['echo', undefined], ['x', undefined], ['.oss/workflow-state.jso?', '.oss/workflow-state.jso?'],
    ]);
  });

  it('should keep the pattern of each word a brace group expands to', () => {
    expect(globsOf("rm {.o*,'b*'}")).toEqual([
      ['rm', undefined], ['.o*', '.o*'], ['b*', undefined],
    ]);
  });
});

describe('tokenize: heredoc bodies', () => {
  const bodiesOf = (cmd: string): (string | undefined)[] =>
    tokensOf(cmd).flatMap((t) => (t.kind === 'redirect' ? [heredocBodyOf(t)] : []));

  it('should keep the body of a quoted and of an unquoted heredoc with its redirect', () => {
    expect(bodiesOf("python3 - <<'EOF'\nopen('x')\nprint(1)\nEOF\ncat <<EOF\nhi\nEOF")).toEqual(["open('x')\nprint(1)", 'hi']);
  });

  it('should strip leading tabs from a <<- body, and keep no body for other redirects', () => {
    expect(bodiesOf('cat <<-EOF > out\n\tx\n\tEOF')).toEqual(['x', undefined]);
  });
});

describe('tokenize: a glob qualifier or extended glob right after a pattern (fix round 4, K2)', () => {
  function lastWord(cmd: string): Token {
    const words = tokensOf(cmd).filter((t) => t.kind === 'word');
    return words[words.length - 1];
  }

  it.each([['rm -rf *(D)', '*(D)'], ['rm -rf **/*(.D)', '**/*(.D)'], ['rm -rf .o*(D)', '.o*(D)']])(
    'reads %s as one word that may match dot entries',
    (cmd, value) => {
      const token = lastWord(cmd);
      expect(token).toEqual(word(value));
      expect(dotsOf(token)).toBe(true);
      expect(globOf(token)?.endsWith('*')).toBe(true);
      expect(tokensOf(cmd).some((t) => t.kind === 'op')).toBe(false);
    },
  );

  it('reads a bash extended glob (!(x), @(a|b)) as one word that stands for any name', () => {
    const token = lastWord('rm -rf !(keep)');
    expect(token).toEqual(word('!(keep)'));
    expect(globOf(token)).toBe('*');
    expect(dotsOf(token)).toBe(false);
  });

  it.each([`rm *(e:'touch x':)`, 'rm *(+pick)', 'ls x*(e.true.)'])('cannot read %s: the qualifier runs code', (cmd) => {
    expect(isUnreadable(cmd)).toBe(true);
  });

  it.each([
    ['f() { :; }', ['f', '{', ':', '}']],
    ['arr=(a b); echo ok', ['arr=', 'a', 'b', 'echo', 'ok']],
    ['(cd src && ls *)', ['cd', 'src', '&&', 'ls', '*'].filter((w) => w !== '&&')],
  ])('leaves %s as it was (no pattern right before the parenthesis)', (cmd, words) => {
    expect(wordsOf(cmd)).toEqual(words);
  });

  it('a plain pattern is not marked as matching dot entries', () => {
    expect(dotsOf(lastWord('rm -rf *'))).toBe(false);
  });
});
