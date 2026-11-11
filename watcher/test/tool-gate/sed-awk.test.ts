/**
 * @behavior The gate reads what a sed or awk script does besides reading its files (fix round 4,
 *   K2): the files it writes (`w file`, `s/a/b/w file`, `print > "file"`), the commands it runs
 *   (`e cmd`, `system("cmd")`, `print | "cmd"`), and whether it runs a command it can't read
 *   (`e` alone, `s///e`, `system(x)`).
 * @business-rule US-006: sed and awk only read the files they name, but their script can still
 *   write a protected file or run a command, so the script is read like any other.
 */

import { describe, it, expect } from 'vitest';
import { awkFacts, sedFacts } from '../../src/tool-gate/sed-awk.js';

describe('sedFacts: what a sed script writes and runs', () => {
  it.each([
    [['-n', 'w .oss/tool-gates.json', 'a'], ['.oss/tool-gates.json']],
    [['s/a/b/w .oss/x.json', 'a'], ['.oss/x.json']],
    [['-e', '1W out.txt', '-e', 'p', 'a'], ['out.txt']],
    [['/x/,/y/ { s/a/b/gw log.txt\n}', 'a'], ['log.txt']],
    [['--expression=$w last.txt', 'a'], ['last.txt']],
    [['-i', '', '1w b.txt', 'a'], ['b.txt']],
  ])('sed %j writes %j', (args, writes) => {
    expect(sedFacts(args).writes).toEqual(writes);
  });

  it.each([
    [['1e cp a .oss/x'], ['cp a .oss/x']],
    [['-n', '$e rm -f .oss/workflow-state.json', 'f'], ['rm -f .oss/workflow-state.json']],
  ])('sed %j runs %j', (args, commands) => {
    expect(sedFacts(args).commands).toEqual(commands);
  });

  it.each([[['e', 'f']], [['s/.*/rm x/e', 'f']], [['1{e\n}', 'f']]])('sed %j runs a command it cannot read', (args) => {
    expect(sedFacts(args).unreadable).not.toBeNull();
  });

  it.each([
    [['-n', '1,5p', 'a']],
    [['s/a/b/g', 'a']],
    [['-E', 's|x/y|z|; /^#/d', 'a']],
    [['-n', '/start/,/end/{p;q}', 'a']],
    [['y/abc/xyz/', 'a']],
    [['$!N; s/\\n/ /; P; D', 'a']],
    [['-e', ':a', '-e', 'N;ba', 'a']],
    [['1i\\', 'a']],
    [['s/w/e/', 'a']],
  ])('sed %j only reads', (args) => {
    expect(sedFacts(args)).toEqual({ writes: [], commands: [], unreadable: null, dynamic: null });
  });
});

describe('awkFacts: what an awk script writes and runs', () => {
  it.each([
    [[`BEGIN{print "x" > ".oss/tool-gates.json"}`], ['.oss/tool-gates.json']],
    [[`{ printf "%s", $0 >> "log.txt" }`, 'f'], ['log.txt']],
  ])('awk %j writes %j', (args, writes) => {
    expect(awkFacts(args).writes).toEqual(writes);
  });

  it.each([
    [[`BEGIN{system("cp a .oss/x")}`], ['cp a .oss/x']],
    [[`{ print | "sh" }`], ['sh']],
    [[`BEGIN { "date" | getline d }`], ['date']],
  ])('awk %j runs %j', (args, commands) => {
    expect(awkFacts(args).commands).toEqual(commands);
  });

  it.each([[['{system($0)}']], [['{print > $2}']], [['{print | cmd}']]])('awk %j runs or writes what it cannot read', (args) => {
    expect(awkFacts(args).unreadable).not.toBeNull();
  });

  it.each([
    [['{print $1}', 'f']],
    [['-F:', '$3 > 100 {print $1}', 'f']],
    [['/foo|bar/ {n++} END {print n}', 'f']],
    [['{ if ($1 > 5) print ($2 > 3) }', 'f']],
    [['-v', 'x=1', '{ a = $1 / 2; print a }', 'f']],
    [['$1 || $2 {print}', 'f']],
  ])('awk %j only reads', (args) => {
    expect(awkFacts(args)).toEqual({ writes: [], commands: [], unreadable: null, dynamic: null, loads: false });
  });

  it.each([[['-l', 'inplace', '{print}', 'f']], [['--inc', 'inplace', '{print}', 'f']], [['@include "inplace"; {print}', 'f']], [['--lo=x', '1', 'f']]])(
    'awk %j loads a library (which can edit files in place)',
    (args) => {
      expect(awkFacts(args).loads).toBe(true);
    },
  );
});

describe('sed and awk scripts holding text only known when they run (fix round 4, K3)', () => {
  const UNKNOWN = '\u0000DYN\u0000';

  it.each([
    [['s/a/' + UNKNOWN + '/', 'f']],
    [['-e', UNKNOWN, 'f']],
    [['-n', `${UNKNOWN}p`, 'f']],
  ])('sed %j is dynamic, not unreadable', (args) => {
    const facts = sedFacts(args);
    expect(facts.dynamic).not.toBeNull();
    expect(facts.unreadable).toBeNull();
  });

  it('sed running a command only known when it runs is unreadable', () => {
    const facts = sedFacts([`1e ${UNKNOWN}`, 'f']);
    expect(facts.unreadable).not.toBeNull();
    expect(facts.commands).toEqual([]);
  });

  it('awk printing a field held in a shell variable is dynamic, not unreadable', () => {
    const facts = awkFacts([`{print ${UNKNOWN}}`, 'f']);
    expect(facts.dynamic).not.toBeNull();
    expect(facts.unreadable).toBeNull();
  });

  it.each([[`BEGIN{system("${UNKNOWN}")}`], [`{print | "${UNKNOWN}"}`]])('awk %j runs a command only known when it runs: unreadable', (script) => {
    const facts = awkFacts([script]);
    expect(facts.unreadable).not.toBeNull();
    expect(facts.commands).toEqual([]);
  });

  it('a script read from a file is neither', () => {
    expect(sedFacts(['-f', 's.sed', 'f'])).toMatchObject({ unreadable: null, dynamic: null });
    expect(awkFacts(['-f', 's.awk', 'f'])).toMatchObject({ unreadable: null, dynamic: null });
  });
});
