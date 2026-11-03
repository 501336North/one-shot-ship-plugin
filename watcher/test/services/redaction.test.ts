/**
 * @behavior The shared secret redactor scrubs secret-shaped values out of free-text
 *           strings and nested context objects (including arrays) before they are ever
 *           written to a sink or embedded in a prompt — one implementation reused by the
 *           emitter and every consumer-side path (defense in depth).
 * @acceptance-criteria SEC-1 (arrays redacted), SEC-2 (broadened value patterns), SEC-4 (shared)
 * @business-rule A secret must never survive into workflow.log, stdout, or a queue-task prompt,
 *                regardless of how it is shaped or nested.
 * @boundary Service: watcher/src/services/redaction.ts (redactString, redactSecrets)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { cleanAndRedactWithRemoved, cleanText, collapseMasked, redactString, redactSecrets } from '../../src/services/redaction';

describe('redaction service', () => {
  describe('redactString — broadened value patterns (SEC-2)', () => {
    it('redacts sk-ant / generic sk- keys', () => {
      expect(redactString('key=sk-ant-api03-SUPERSECRETVALUE1234567890')).toContain('[REDACTED]');
      expect(redactString('sk-ant-api03-SUPERSECRETVALUE1234567890')).not.toContain('SUPERSECRET');
    });

    it('redacts an Authorization header for ANY scheme (Bearer and Basic)', () => {
      const bearer = redactString('Authorization: Bearer sk-ant-abc123deadbeef01');
      expect(bearer).toContain('[REDACTED]');
      expect(bearer).not.toContain('sk-ant-abc123deadbeef01');

      const basic = redactString('Authorization: Basic dXNlcjpwYXNzd29yZA==');
      expect(basic).toContain('[REDACTED]');
      expect(basic).not.toContain('dXNlcjpwYXNzd29yZA==');
    });

    it('redacts a bare Bearer token', () => {
      const out = redactString('sent Bearer oss_live_deadbeefcafe1234 to the API');
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain('oss_live_deadbeefcafe1234');
    });

    // Deliberate requirement change (radical-observability ship round 2, finding 12e): security over log
    // readability. An unquoted value after a secret-named key runs to the next space or quote, & included,
    // exactly as the API redacts it, so the params after a secret param are redacted with it.
    it('redacts query-string secret params and everything after them up to the next space (API behaviour)', () => {
      const url =
        'https://x.dev/cb?api_key=abcd1234efgh&access_token=zzz999&secret=hunter2&password=p4ss&foo=bar';
      const out = redactString(url);
      expect(out).not.toContain('abcd1234efgh');
      expect(out).not.toContain('zzz999');
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('p4ss');
      // The plugin's original secret-param pattern may then take the key name too: only the tail matters.
      expect(out).not.toContain('foo=bar');
      expect(out).toMatch(/^https:\/\/x\.dev\/cb\?[^&]*\[REDACTED\]$/);
    });

    it('redacts the whole unquoted value after a secret-named key, including a part after &name=', () => {
      // A secret value may itself hold "&k=": stopping there would leak the tail.
      const tail = 'Tq7Rv2Wx9' + 'Lm4Np8Ks3Zc';
      const out = redactString(`password=abc&k=${tail} done`);
      expect(out).not.toContain(tail);
      expect(out).not.toContain('&k=');
      expect(out).toMatch(/^[^&]*\[REDACTED\] done$/);
    });

    it('should redact a quoted value with spaces followed by punctuation', () => {
      // A sentence often goes on right after the closing quote: the whole phrase goes, no word of it survives.
      const word1 = 'Correct';
      const word2 = 'horse' + 'Battery';
      const leaks: string[] = [];
      for (const quote of ['"', "'"]) {
        for (const after of ['. Done', '.', '!', ':', '?', '-', '>', '—']) {
          for (const lead of ['password=', 'secret: ', 'mysql --password ']) {
            const text = `${lead}${quote}${word1} ${word2}${quote}${after}`;
            const out = redactString(text);
            if (!out.includes('[REDACTED]') || out.includes(word1) || out.includes(word2)) {
              leaks.push(`${text} -> ${out}`);
            }
          }
        }
      }
      expect(leaks, leaks.join('\n')).toEqual([]);
    });

    it('should redact the next secret field after an empty quoted one', () => {
      // An empty secret field ("password": "") must not swallow the quotes of the next field and expose its value.
      const value = 'Qwerty' + 'Uiopasdf';
      const texts = [
        `{"password": "", "token": "${value}"}`,
        `{"password":"","token":"${value}"}`,
        `{'password': '', 'token': '${value}'}`,
      ];
      for (const text of texts) {
        expect(redactString(text), text).not.toContain(value);
      }
    });

    it('redacts a JWT', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const out = redactString(`token is ${jwt} ok`);
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain(jwt);
    });

    it('redacts common vendor key prefixes (ghp_, AKIA, xoxb-, AIza)', () => {
      // Fixtures assembled from fragments so no scannable secret literal
      // appears in source (trips GitHub push protection); the redaction
      // regex still runs on the concatenated runtime value.
      const secrets = [
        'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        'AKIA' + 'IOSFODNN7' + 'EXAMPLE',
        'xoxb-' + '1234567890-' + 'abcdefghijklmno',
        'AIza' + 'SyD-EXAMPLEKEY_1234567890abcdefghij',
      ];
      for (const secret of secrets) {
        const out = redactString(`leaked ${secret} here`);
        expect(out, `${secret} must be redacted`).not.toContain(secret);
        expect(out).toContain('[REDACTED]');
      }
    });

    it('leaves ordinary text untouched', () => {
      expect(redactString('Prompt fetch failed: ECONNREFUSED')).toBe(
        'Prompt fetch failed: ECONNREFUSED',
      );
    });

    // Ship finding 12u: the ported secret-assignment pattern took only the word "Bearer" after a secret key
    // and left the token in clear, where origin/main's bare-bearer pattern had redacted it.
    it('should redact a Bearer token assigned to a secret key', () => {
      const value = 'opaq' + 'Ue7Val' + 'x3Q9' + 'w2Rz5k';
      const shapes = [
        `token=Bearer ${value}`,
        `--token=Bearer ${value}`,
        `API_KEY=Bearer ${value}`,
        `password=Bearer ${value}`,
        `token=Bearer\t${value}`,
      ];
      for (const input of shapes) {
        expect(redactString(input), input).not.toContain(value);
      }
    });

    it("should never keep text origin/main's list redacts", () => {
      // FROZEN origin/main baseline (watcher/src/services/redaction.ts SECRET_VALUE_PATTERNS, applied in
      // this order). It is the floor the branch may never fall below: do NOT edit it to make a test pass.
      const MAIN_PATTERNS: readonly RegExp[] = [
        /sk-[A-Za-z0-9_-]{12,}/g,
        /Authorization:\s*[A-Za-z]+\s+[^\s"']+/gi,
        /Bearer\s+[^\s"']+/g,
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        /(?:api[_-]?key|access[_-]?token|token|secret|password)=[^\s"'&]+/gi,
        /ghp_[A-Za-z0-9]{20,}/g,
        /AKIA[A-Z0-9]{12,}/g,
        /xox[bp]-[A-Za-z0-9-]+/g,
        /AIza[A-Za-z0-9_-]{20,}/g,
      ];
      // The readable lead main removed along with a value: a secret-param key and its =, a Bearer scheme word,
      // or an Authorization header's key and scheme. Key names are not secrets; only the value part is compared.
      const MAIN_KEY_LEAD = /^(?:Authorization:\s*[A-Za-z]+\s+|Bearer\s+|(?:api[_-]?key|access[_-]?token|token|secret|password)=)/i;
      /** main's redactString, recording each removed VALUE (>= 6 chars, the marker itself excluded). */
      const mainRedact = (input: string): { out: string; removed: string[] } => {
        const removed: string[] = [];
        let out = input;
        for (const pattern of MAIN_PATTERNS) {
          out = out.replace(pattern, (match: string) => {
            for (const piece of match.replace(MAIN_KEY_LEAD, '').split('[REDACTED]')) {
              if (piece.length >= 6) removed.push(piece);
            }
            return '[REDACTED]';
          });
        }
        return { out, removed };
      };

      const corpus: string[] = [];
      const fixture = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'api-secret-samples.json'), 'utf-8'),
      ) as { samples: { parts: string[]; clean?: boolean }[] };
      for (const { parts, clean } of fixture.samples) {
        const text = parts.join('');
        corpus.push(clean === true ? cleanText(text) : text);
      }
      const keys = ['token', 'api_key', 'API_KEY', 'password', 'secret', 'access_token'];
      const separators = (key: string): string[] => ['=', ': '].map((sep) => key + sep).concat(`--${key}=`);
      const schemes = ['Bearer ', 'Bearer\t', 'Basic ', 'Basic\t', ''];
      const body = 'q7W' + 'e9R' + 't1Y' + 'u3I' + 'o5P';
      const values = [
        'abc' + 'DEF' + '123' + 'ghi' + '456' + 'JKL',
        'sk' + '-' + body + 'zz',
        'gh' + 'p_' + body + 'AbCdEfGh',
        'AK' + 'IA' + 'Q7W9E1R3T5Y7U9I1',
        'xo' + 'xb-' + body,
        'AI' + 'za' + body + body,
        'ey' + 'J' + body + '.ey' + 'J' + body + '.' + body,
      ];
      for (const key of keys) {
        for (const lead of separators(key)) {
          for (const scheme of schemes) {
            for (const value of values) {
              for (const wrap of [(s: string) => s, (s: string) => `x ${s} y`, (s: string) => `"${s}"`]) {
                corpus.push(wrap(`${lead}${scheme}${value}`));
              }
            }
          }
        }
      }
      expect(corpus.length).toBeGreaterThan(1000);

      const leaks: string[] = [];
      for (const input of corpus) {
        const out = redactString(input);
        const main = mainRedact(input);
        // Every 6-char run of a removed value: the branch must not show it, unless main shows it too (the same
        // text also stands, unredacted, elsewhere in the input).
        for (const removed of main.removed) {
          for (let i = 0; i + 6 <= removed.length; i++) {
            const run = removed.slice(i, i + 6);
            if (out.includes(run) && !main.out.includes(run)) {
              leaks.push(`${JSON.stringify(input.slice(0, 70))} keeps ${JSON.stringify(run)}`);
              break;
            }
          }
        }
      }
      expect(leaks.slice(0, 20), `${leaks.length} leaks`).toEqual([]);
    });

    it('runs in linear time on adversarial input (no catastrophic backtracking)', () => {
      const evil = `Bearer ${'a'.repeat(50000)}`;
      const start = Date.now();
      redactString(evil);
      expect(Date.now() - start).toBeLessThan(500);
    });
  });

  describe('redactSecrets — recurses into arrays and nested objects (SEC-1)', () => {
    it('redacts string and object elements inside arrays', () => {
      const out = redactSecrets({
        data: ['Authorization: Bearer sk-ant-abc123deadbeef01', { apiKey: 'sk-ant-xyz9876543210' }],
      });
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('sk-ant-abc123deadbeef01');
      expect(serialized).not.toContain('sk-ant-xyz9876543210');
      expect(serialized).toContain('[REDACTED]');
    });

    it('redacts by secret-shaped key regardless of value shape', () => {
      const out = redactSecrets({ apiKey: 'plain-looking-key-value', token: 'whatever' });
      expect(out.apiKey).toBe('[REDACTED]');
      expect(out.token).toBe('[REDACTED]');
    });

    it('leaves non-secret primitives untouched', () => {
      const out = redactSecrets({ attempt: 2, ok: true, endpoint: '/api/v1/prompts' });
      expect(out).toEqual({ attempt: 2, ok: true, endpoint: '/api/v1/prompts' });
    });
  });

  // Shared fixture, mirrored from the API's redaction test (AgenticDevWorkflow
  // packages/api/test/decisions/redaction.test.ts): every invisible character that can split a token when
  // text is copied from chat or docs. Change both sides together.
  describe('cleanText and redaction removes every invisible character that can split a secret', () => {
    const cleanAndRedact = (text: string): string => cleanAndRedactWithRemoved(text).text;
    const INVISIBLE_CHARS: { name: string; char: string }[] = [
      { name: 'U+034F combining grapheme joiner', char: '\u034F' },
      { name: 'U+115F Hangul choseong filler', char: '\u115F' },
      { name: 'U+1160 Hangul jungseong filler', char: '\u1160' },
      { name: 'U+3164 Hangul filler', char: '\u3164' },
      { name: 'U+FFA0 halfwidth Hangul filler', char: '\uFFA0' },
      { name: 'U+2800 Braille blank', char: '\u2800' },
      { name: 'U+FE00 variation selector 1', char: '\uFE00' },
      { name: 'U+FE0F variation selector 16', char: '\uFE0F' },
      { name: 'U+E0100 variation selector 17', char: '\u{E0100}' },
      { name: 'U+E01EF variation selector 256', char: '\u{E01EF}' },
      { name: 'U+00AD soft hyphen', char: '\u00AD' },
      { name: 'U+061C Arabic letter mark', char: '\u061C' },
      { name: 'U+200B zero-width space', char: '\u200B' },
      { name: 'U+200D zero-width joiner', char: '\u200D' },
      { name: 'U+2060 word joiner', char: '\u2060' },
      { name: 'U+2064 invisible plus', char: '\u2064' },
      { name: 'U+FEFF byte order mark', char: '\uFEFF' },
      { name: 'U+202E right-to-left override', char: '\u202E' },
      { name: 'U+2069 pop directional isolate', char: '\u2069' },
      { name: 'U+E0001 language tag', char: '\u{E0001}' },
      { name: 'U+E007F cancel tag', char: '\u{E007F}' },
      { name: 'U+17B4 Khmer vowel inherent aq', char: '\u17B4' },
      { name: 'U+180B Mongolian free variation selector one', char: '\u180B' },
      { name: 'U+FFF0 reserved default-ignorable', char: '\uFFF0' },
      { name: 'U+E0000 reserved default-ignorable', char: '\u{E0000}' },
      { name: 'U+E0FFF reserved default-ignorable', char: '\u{E0FFF}' },
    ];
    // Built from parts so no token-shaped literal is committed.
    const GH_BODY = 'A1b2C3d4E5' + 'A1b2C3d4E5' + 'A1b2C3d4E5' + 'x9Y8z7';
    const GH_TOKEN = 'gh' + 'p_' + GH_BODY;

    it.each(INVISIBLE_CHARS)('should redact a GitHub token split by $name', ({ char }) => {
      const split = `${GH_TOKEN.slice(0, 10)}${char}${GH_TOKEN.slice(10)}`;

      const out = cleanAndRedact(`key ${split} here`);

      expect(out).not.toContain(GH_BODY.slice(-12));
      expect(out).toBe('key [REDACTED] here');
    });

    // Outside the shared fixture: format characters (\p{Cf}) that are NOT default-ignorable, so the
    // Default_Ignorable_Code_Point class alone would let them split a token.
    it.each([
      { name: 'U+FFF9 interlinear annotation anchor', char: '\uFFF9' },
      { name: 'U+0600 Arabic number sign', char: '\u0600' },
    ])('should redact a GitHub token split by $name, a format character that is not default-ignorable', ({ char }) => {
      const split = `${GH_TOKEN.slice(0, 10)}${char}${GH_TOKEN.slice(10)}`;

      expect(cleanAndRedact(`key ${split} here`)).toBe('key [REDACTED] here');
    });

    it('should leave plain text, emoji, tabs and newlines unchanged and remove a carriage return', () => {
      const plain = 'Plain text 123 \u{1F600} with space\ttab\nnewline';

      expect(cleanAndRedact(plain)).toBe(plain);
      expect(cleanAndRedact('line one\r\nline two')).toBe('line one\nline two');
    });
  });

  // The function's own text must be safe: callers other than the decision CLI get no second, cross-field pass.
  describe('cleanAndRedactWithRemoved masks what either the invisible-kept or the invisible-stripped view finds', () => {
    const fillers = [0x115f, 0x1160, 0x3164, 0xffa0].map((codePoint: number) => ({
      name: `U+${codePoint.toString(16).toUpperCase()}`,
      filler: String.fromCodePoint(codePoint),
    }));
    const SK_BODY = 'Zq8Wm3Kt'.repeat(3);

    it.each(fillers)('should redact "by" + $name + "pass=<value>" in its own text, with no filler left', ({ filler }) => {
      const value = 'Hx7Vq2' + 'Lm9Rt4';

      expect(cleanAndRedactWithRemoved(`by${filler}pass=${value}`).text).toBe('bypass=[REDACTED]');
    });

    it.each(fillers)('should redact a long sk- key split by $name after 24 characters, tail included', ({ filler }) => {
      const out = cleanAndRedactWithRemoved(`x sk-${SK_BODY}${filler}${'TAIL' + '9xyz'} end`).text;

      expect(out).toBe('x [REDACTED] end');
    });

    it('should not blank ordinary words with a value that is mostly fillers once the fillers are removed', () => {
      // "ab" + 4 fillers is a 6-character value in the filler-kept view but only "ab" without them: masking
      // every "ab" in the text would eat ordinary words.
      const filler = String.fromCodePoint(0x3164);

      const out = cleanAndRedactWithRemoved(`by${filler}pass=ab${filler.repeat(4)} in the lab`).text;

      expect(out).toContain(' in the lab');
    });

    const ch = (codePoint: number): string => String.fromCodePoint(codePoint);
    const KEY = 'Zq8Wm3Kt'.repeat(3);
    const HF_BODY = 'Hf8Wm3Kt'.repeat(5);
    const WEBHOOK = 'https://hooks.slack.com/services/T' + '0A1B2C3D4/B5E6F7G8H/' + 'Sl1Wf4Secret9XyAbCd';

    // A: a stripped character other than the 4 fillers must not glue a word onto the key that follows it.
    const PROJ_KEY = 'sk-proj-' + 'Ab3De5Gh7J'.repeat(3);
    it.each([
      { name: 'U+2800', input: `word${ch(0x2800)}${PROJ_KEY}`, expected: 'word[REDACTED]' },
      { name: 'lone U+D800', input: `word${ch(0xd800)}${PROJ_KEY}`, expected: 'word[REDACTED]' },
      { name: 'U+FE0F', input: `word${ch(0xfe0f)}${PROJ_KEY}`, expected: 'word[REDACTED]' },
      { name: 'U+E0020', input: `word${ch(0xe0020)}${PROJ_KEY}`, expected: 'word[REDACTED]' },
      { name: 'lone U+D800 before pass=', input: `by${ch(0xd800)}pass=${'s3cret' + 'value'}`, expected: 'bypass=[REDACTED]' },
    ])('should redact a key glued to a word by a stripped $name', ({ input, expected }) => {
      expect(cleanAndRedactWithRemoved(input).text).toBe(expected);
    });

    it('should not let a control character between two lone halves pair them into an invisible tag', () => {
      // The halves are found in the original text, before the control between them is removed.
      const token = 'gh' + 'p_' + 'A1b2C3d4E5'.repeat(3) + 'x9Y8z7';
      const out = cleanAndRedactWithRemoved(`key ${token.slice(0, 10)}${ch(0xdb40)}${ch(0x0001)}${ch(0xdc20)}${token.slice(10)} here`).text;

      expect(out).toBe('key [REDACTED] here');
      expect(out).not.toContain(ch(0xe0020));
      expect(out).not.toContain(ch(0xfffd));
    });

    it('should not let a control character between two lone halves pair them into a visible emoji that splits a token', () => {
      // A high and a low half that would form U+1F600 once the control between them is gone.
      const token = 'gh' + 'p_' + 'A1b2C3d4E5'.repeat(3) + 'x9Y8z7';
      const out = cleanAndRedactWithRemoved(`key ${token.slice(0, 10)}${ch(0xd83d)}${ch(0x0001)}${ch(0xde00)}${token.slice(10)} here`).text;

      expect(out).toBe('key [REDACTED] here');
    });

    it('should keep a U+FFFD that was already in the input', () => {
      expect(cleanAndRedactWithRemoved(`bad byte ${ch(0xfffd)} here`).text).toBe(`bad byte ${ch(0xfffd)} here`);
    });

    // Output by code point: a mask edge never splits a surrogate pair or leaves a lone half.
    const hasLoneHalf = (text: string): boolean =>
      Array.from(text).some((char: string) => char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff);

    it.each([
      { name: 'a token= value', input: `token=abc123def${ch(0x1f600)} x` },
      { name: 'a Bearer token', input: `Bearer ${PROJ_KEY}${ch(0x1f600)} x` },
      { name: 'a GitHub token', input: `${'gh' + 'p_' + 'A1b2C3d4E5'.repeat(3)}${ch(0x1f600)} x` },
    ])('should keep or mask an emoji right after $name whole, never half of it', ({ input }) => {
      const out = cleanAndRedactWithRemoved(input).text;

      expect(hasLoneHalf(out), JSON.stringify(out)).toBe(false);
      expect(out).toContain('[REDACTED]');
    });

    it.each([
      { name: 'its high half', masked: 2 },
      { name: 'its low half', masked: 3 },
    ])('should mask a whole emoji when a mask edge covers only $name', ({ masked }) => {
      const text = `ab${ch(0x1f600)}cd`;
      const mask = Array.from({ length: text.length }, (_: unknown, i: number) => i === masked);

      const out = collapseMasked(text, mask).text;

      expect(out).toBe('ab[REDACTED]cd');
      expect(hasLoneHalf(out)).toBe(false);
    });

    // B: a token-like prefix and a filler must not let an earlier pattern eat the head and leave the tail.
    it.each([
      { name: 'AIza + filler + sk-proj- key', input: `AIza${ch(0x3164)}sk-proj-${KEY} end`, secret: KEY },
      { name: 'xoxb- + filler + hf_ token', input: `xo${'xb-'}${ch(0x3164)}hf_${HF_BODY} end`, secret: HF_BODY },
      { name: 'xoxb- + filler + Slack webhook URL', input: `xo${'xb-'}${ch(0x3164)}${WEBHOOK} end`, secret: 'Sl1Wf4Secret9XyAbCd' },
    ])('should leave nothing readable of a $name', ({ input, secret }) => {
      const out = cleanAndRedactWithRemoved(input).text;

      expect(out).toContain('[REDACTED]');
      expect(out).toMatch(/ end$/);
      for (let i = 0; i + 6 <= secret.length; i++) {
        expect(out, `keeps ${secret.slice(i, i + 6)}`).not.toContain(secret.slice(i, i + 6));
      }
    });

    // C: masking is by position, so another copy of a value in ordinary text is left alone, exactly as the plain
    // redaction does. (The plugin-only secret-param pattern takes "password=" and "TOKEN=" with the value.)
    it.each([
      { input: '--token 123456 issue #123456 and 1234567', expected: '--token [REDACTED] issue #123456 and 1234567' },
      { input: 'password=example1 see examples1 and example1', expected: '[REDACTED] see examples1 and example1' },
      { input: 'TOKEN=REDACTED here', expected: '[REDACTED] here' },
      { input: 'password=s3cretvalue then s3cretvalue again', expected: '[REDACTED] then s3cretvalue again' },
    ])('should give exactly the plain redaction for "$input"', ({ input, expected }) => {
      const out = cleanAndRedactWithRemoved(input).text;

      expect(out).toBe(redactString(input));
      expect(out).toBe(expected);
    });

    // A token inside a connection-string password is masked at its full length; the 256-character cap on the
    // password must not then stop short of the @ and leave the rest of a long password readable.
    const longPassword = 'AK' + 'IA' + 'ABCDEFGH23456789' + '!P' + 'x'.repeat(240);
    it.each([
      { name: 'in plain text', password: longPassword },
      { name: 'with a zero-width space after the AWS key', password: longPassword.slice(0, 20) + ch(0x200b) + longPassword.slice(20) },
    ])('should redact the whole of a long connection-string password holding a token, $name', ({ password }) => {
      expect(cleanAndRedactWithRemoved(`postgres://u:${password}@host`).text).toBe('postgres://u:[REDACTED]@host');
    });

    // Plain text goes through the plain redaction unchanged, touching secrets included; the two-view mask is
    // only for text that holds an invisible character, where touching secrets become one marker.
    const GH_A = 'gh' + 'p_' + 'A1b2C3d4E5'.repeat(3) + 'x9Y8z7';
    const GH_B = 'gh' + 'p_' + 'Q7w8E9r0T1'.repeat(3) + 'm4N5b6';
    it('should keep two touching tokens in plain text as two markers, as before', () => {
      expect(cleanAndRedactWithRemoved(`${GH_A}${GH_B}`).text).toBe('[REDACTED][REDACTED]');
    });

    it('should merge two tokens with an invisible character between them into one marker', () => {
      expect(cleanAndRedactWithRemoved(`${GH_A}${ch(0x200b)}${GH_B}`).text).toBe('[REDACTED]');
    });

    describe('differential check against the pre-change pipeline', () => {
      // The pre-change pipeline (origin/main 91c808e), kept here only to compare against.
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      const OLD_UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
      const oldCleanAndRedact = (text: string): string => redactString(text.replace(OLD_UNSAFE_CHARS, ''));

      /** Deterministic PRNG (mulberry32), so the random corpus is the same on every run. */
      const prng = (seed: number): (() => number) => {
        let a = seed;
        return () => {
          a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      };

      const corpus = (): string[] => {
        const inputs: string[] = [];
        const fixture = JSON.parse(
          fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'api-secret-samples.json'), 'utf-8'),
        ) as { samples: { parts: string[] }[] };
        for (const { parts } of fixture.samples) inputs.push(parts.join(''));
        const body = 'q7W' + 'e9R' + 't1Y' + 'u3I' + 'o5P';
        const values = [
          'abc' + 'DEF' + '123' + 'ghi' + '456' + 'JKL',
          'sk' + '-' + body + 'zz',
          'gh' + 'p_' + body + 'AbCdEfGh',
          'AK' + 'IA' + 'Q7W9E1R3T5Y7U9I1',
          'xo' + 'xb-' + body,
          'AI' + 'za' + body + body,
          'ey' + 'J' + body + '.ey' + 'J' + body + '.' + body,
          'hf_' + HF_BODY,
          WEBHOOK,
        ];
        for (const key of ['token', 'api_key', 'API_KEY', 'password', 'secret', 'access_token', 'DB_PASS', 'bypass']) {
          for (const lead of [`${key}=`, `${key}: `, `--${key}=`, `--${key} `, `"${key}": "`]) {
            for (const scheme of ['Bearer ', 'Basic ', '']) {
              for (const value of values) {
                inputs.push(`${lead}${scheme}${value}`, `x ${lead}${scheme}${value} y`, `${lead}${scheme}${value}${value}`);
              }
            }
          }
        }
        const pieces = [
          'INFO', 'ERROR', 'request', 'id=42', 'token=', 'Bearer ', 'password: ', '--token ', 'issue #123456', '123456',
          'api_key=', 'secret', 'bypass=enabled', 'Authorization: ', 'TOKEN=REDACTED', '[REDACTED]', 'task-runner-v2',
          'redis://:', '@host:6379', ...values, ' ', ' ', ' ', '\t', '\n', ',', '"', "'", '=', ':', '&', '.', '/', '-', '',
        ];
        const random = prng(20261102);
        for (let n = 0; n < 400; n++) {
          let line = '';
          const count = 3 + Math.floor(random() * 10);
          for (let i = 0; i < count; i++) line += pieces[Math.floor(random() * pieces.length)];
          inputs.push(line);
        }
        // Only text with no invisible character: there the new pipeline must change nothing.
        return inputs.filter((text: string) => cleanText(text) === text);
      };

      it('should give byte-identical output to the pre-change pipeline for every text with no invisible character', () => {
        const inputs = corpus();
        expect(inputs.length).toBeGreaterThan(1500);

        const differences: string[] = [];
        for (const input of inputs) {
          const before = oldCleanAndRedact(input);
          const after = cleanAndRedactWithRemoved(input).text;
          if (after !== before) differences.push(`${JSON.stringify(input)}\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`);
        }

        expect(differences.slice(0, 10), `${differences.length} differences`).toEqual([]);
      });

      it('should be byte-identical to the pre-change pipeline on 3000 fixed-seed fuzz strings with no invisible character', () => {
        // Printable ASCII, TAB and LF, plus secret-shaped fragments so that matches, near-misses and touching
        // secrets are common. The seed is fixed, so every run checks the same strings.
        const fragments = [
          'token=', 'password=', 'secret: ', 'Bearer ', 'Basic ', 'Authorization: Bearer ', '--token ', 'api_key=',
          'sk-', 'sk-proj-', 'gh' + 'p_', 'AK' + 'IA', 'xo' + 'xb-', 'AI' + 'za', 'hf_', 'ey' + 'J', 'whsec_',
          'https://hooks.slack.com/services/', 'postgres://user:', '@db:5432', 'Ab3De5Gh7J', 'q7We9Rt1Yu3Io5P', '123456',
        ];
        const random = prng(424242);
        const differences: string[] = [];
        let checked = 0;
        for (let n = 0; n < 3000; n++) {
          let input = '';
          const length = 5 + Math.floor(random() * 60);
          while (input.length < length) {
            const roll = random();
            if (roll < 0.25) input += fragments[Math.floor(random() * fragments.length)];
            else if (roll < 0.3) input += random() < 0.5 ? '\t' : '\n';
            else input += String.fromCharCode(32 + Math.floor(random() * 95));
          }
          if (cleanText(input) !== input) continue;
          checked++;
          const before = oldCleanAndRedact(input);
          const after = cleanAndRedactWithRemoved(input).text;
          if (after !== before) differences.push(`${JSON.stringify(input)}\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`);
        }

        expect(checked).toBe(3000);
        expect(differences.slice(0, 10), `${differences.length} differences`).toEqual([]);
      });
    });
  });
});
