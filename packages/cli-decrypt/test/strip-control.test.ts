/**
 * @behavior Text that came from the server cannot drive or spoof the user's terminal.
 * @business-rule Besides C0/DEL/C1 control characters, U+2028/U+2029 and every format character (Cf:
 *   bidi overrides, zero-width, BOM, soft hyphen, U+061C, word joiner, tag characters) are removed, the
 *   same set oss_json_field strips (T45), so a message cannot reorder or hide what the user reads; the
 *   readable words are kept.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripControl } from '../src/strip-control.js';

const MAX_CP = 0x10ffff;
const isSurrogate = (cp: number): boolean => cp >= 0xd800 && cp <= 0xdfff;

/** Every maximal run [first, last] of non-surrogate code points that `inSet` holds. */
function runsOf(inSet: (cp: number) => boolean): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let cp = 0; cp <= MAX_CP + 1; cp++) {
    const member = cp <= MAX_CP && !isSurrogate(cp) && inSet(cp);
    if (member && start < 0) start = cp;
    if (!member && start >= 0 && !isSurrogate(cp)) {
      runs.push([start, cp - 1]);
      start = -1;
    }
  }
  return runs;
}

/** The literal code points and ranges a jq oss_invisible definition names (\\uXXXX, surrogate pairs too). */
function hookLiteralRuns(hookSource: string): Array<[number, number]> {
  const def = /def oss_invisible: "([^"]*)"/.exec(hookSource)?.[1] ?? '';
  const one = String.raw`\\u(d[89ab][0-9a-f]{2})\\u(d[c-f][0-9a-f]{2})|\\u([0-9a-f]{4})`;
  const cpOf = (m: RegExpExecArray, at: number): number =>
    m[at] !== undefined
      ? (String.fromCharCode(parseInt(m[at], 16), parseInt(m[at + 1], 16)).codePointAt(0) as number)
      : parseInt(m[at + 2], 16);
  const runs: Array<[number, number]> = [];
  const re = new RegExp(`(?:${one})(?:-(?:${one}))?`, 'gi');
  for (let m = re.exec(def); m !== null; m = re.exec(def)) {
    const first = cpOf(m, 1);
    runs.push([first, m[4] !== undefined || m[6] !== undefined ? cpOf(m, 4) : first]);
  }
  return runs;
}

/**
 * The parity corpus: every code point of every range either side strips (stripControl's own set, the hook's
 * literal ranges, \\p{Cf}, \\p{Default_Ignorable_Code_Point}, C0/DEL/C1), the code points just outside each
 * range's edges, and some ordinary text. Derived from the sets themselves, so it follows them when they change.
 */
function parityCorpus(hookSource: string): number[] {
  const cf = /\p{Cf}/u;
  const di = /\p{Default_Ignorable_Code_Point}/u;
  const controls = /[\u0000-\u001f\u007f-\u009f]/u;
  const runs = [
    ...runsOf(cp => stripControl(String.fromCodePoint(cp)) === ''),
    ...runsOf(cp => cf.test(String.fromCodePoint(cp))),
    ...runsOf(cp => di.test(String.fromCodePoint(cp))),
    ...runsOf(cp => controls.test(String.fromCodePoint(cp))),
    ...hookLiteralRuns(hookSource),
  ];
  const cps = new Set<number>();
  for (const [first, last] of runs) for (let cp = first - 1; cp <= last + 1; cp++) cps.add(cp);
  for (const ch of 'Plain text, accents é ñ ü, CJK 中文, emoji \u{1f600}, math \u{1d400}.') cps.add(ch.codePointAt(0) as number);
  return [...cps].filter(cp => cp >= 0 && cp <= MAX_CP && !isSurrogate(cp)).sort((a, b) => a - b);
}

/** hex code point → what of it survived, from text tagged as "[hex]<char>" per code point. */
function keptByCodePoint(text: string): Map<string, string> {
  const kept = new Map<string, string>();
  const parts = text.split(/\[([0-9a-f]+)\]/);
  for (let i = 1; i < parts.length; i += 2) kept.set(parts[i], parts[i + 1]);
  return kept;
}

function range(from: number, to: number): string {
  let out = '';
  for (let cp = from; cp <= to; cp++) out += String.fromCodePoint(cp);
  return out;
}

describe('stripControl removes invisible spoofing characters', () => {
  it('removes zero-width and directional marks U+200B–U+200F', () => {
    expect(stripControl(`a${range(0x200b, 0x200f)}b`)).toBe('ab');
  });

  it('removes bidi embeddings and overrides U+202A–U+202E', () => {
    expect(stripControl(`a${range(0x202a, 0x202e)}b`)).toBe('ab');
  });

  it('removes bidi isolates U+2066–U+2069', () => {
    expect(stripControl(`a${range(0x2066, 0x2069)}b`)).toBe('ab');
  });

  // T45: the same set oss_json_field (hooks/oss-api-curl.sh) strips since T38.
  it('removes the line and paragraph separators U+2028 and U+2029', () => {
    expect(stripControl('a\u2028b\u2029c')).toBe('abc');
  });

  it('removes every format character: BOM, soft hyphen, U+061C, word joiner and invisible tag characters', () => {
    expect(stripControl('a\ufeffb\u00adc\u061cd\u2060e\u{e0041}\u{e0042}f')).toBe('abcdef');
  });

  it('keeps visible characters next to those format characters', () => {
    const visible = '\u00ac\u00ae\u061b\u2027\u205f\ufefc';
    expect(stripControl(visible)).toBe(visible);
  });

  // One set in two languages (IRON LAW #1b): the hooks strip with oss_json_field, this CLI with stripControl.
  // Every code point of every stripped range, and the code points just outside each range edge, go through
  // both; each code point must be kept or stripped by both alike.
  it('strips exactly the code points oss_json_field (hooks/oss-api-curl.sh) strips', () => {
    const hooks = join(__dirname, '..', '..', '..', 'hooks', 'oss-api-curl.sh');
    const corpus = parityCorpus(readFileSync(hooks, 'utf8'));
    const tagged = corpus.map(cp => `[${cp.toString(16)}]${String.fromCodePoint(cp)}`).join('');
    const r = spawnSync('bash', ['-c', 'source "$1" && oss_json_field t', 'bash', hooks], {
      input: JSON.stringify({ t: tagged }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(r.status, r.stderr).toBe(0);
    const fromHooks = keptByCodePoint(r.stdout.replace(/\n$/, ''));
    const fromCli = keptByCodePoint(stripControl(tagged));
    expect(fromCli.size).toBe(corpus.length);
    expect(fromHooks.size).toBe(corpus.length);
    const differ = corpus
      .map(cp => cp.toString(16))
      .filter(hex => fromCli.get(hex) !== fromHooks.get(hex))
      .map(hex => `U+${hex.toUpperCase()} cli=${fromCli.get(hex) === '' ? 'strips' : 'keeps'}`);
    expect(differ).toEqual([]);
  }, 30_000);

  it('keeps the visible neighbours of those ranges', () => {
    // U+2029 and U+206A were neighbours before T45; U+2029 (Zp) and U+206A (Cf) are stripped now.
    // U+2065 (unassigned, default-ignorable) is stripped since #216's hook set; user, 2026-11-18: "Strip U+2065, fix row".
    const neighbours = '\u200a\u2010\u2027\u202f\u2070';
    expect(stripControl(neighbours)).toBe(neighbours);
  });
});
