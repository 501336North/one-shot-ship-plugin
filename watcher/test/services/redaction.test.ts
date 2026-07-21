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
import { redactString, redactSecrets } from '../../src/services/redaction';

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

    it('redacts query-string secret params (api_key, token, secret, password, access_token)', () => {
      const url =
        'https://x.dev/cb?api_key=abcd1234efgh&access_token=zzz999&secret=hunter2&password=p4ss&foo=bar';
      const out = redactString(url);
      expect(out).not.toContain('abcd1234efgh');
      expect(out).not.toContain('zzz999');
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('p4ss');
      // non-secret params survive
      expect(out).toContain('foo=bar');
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
