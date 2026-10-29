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
import { cleanText, redactString, redactSecrets } from '../../src/services/redaction';

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
});
